import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renameRetrying, writeAtomic } from './atomic.ts';
import { DATA_PUZZLES, REPO_ROOT, VAULT } from './paths.ts';
import { reviewDueAt, type ReviewAttempt } from '../shared/review.ts';

/**
 * Puzzle trainer backed by the local Lichess dump (data/puzzles.sqlite,
 * built in the app or by `npm run build:puzzles`). Single-user by design: no rating
 * system (lanph3re's call) — difficulty is an explicit range filter, progress
 * is counters, and every attempt lands in an append-only history.jsonl
 * that drives two rules:
 *
 *  - fresh training never re-serves an attempted puzzle (6.1 M is plenty);
 *  - puzzles whose latest attempt failed form the review pool.
 */

/**
 * Did this `.building` file get to the end of a build?
 *
 * `source` is the last of the four meta rows the builder writes, so its
 * presence means every row before it landed; the two probe reads catch a
 * file whose tables are gross rubble. What none of this can see is a build
 * killed inside the closing VACUUM — the builder runs with the journal off,
 * so there is no rollback and no marker either. That rewrite is short
 * beside the two minutes in front of it and usually leaves a file SQLite
 * refuses to open at all, which lands here as unfinished; the residual risk
 * of adopting a torn one is the price of not deleting the 2.6 GB a
 * perfectly good build left behind.
 */
function isFinishedPuzzleBuild(path: string): boolean {
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'source'").get();
      const puzzles = (
        db.prepare("SELECT value FROM meta WHERE key = 'puzzles'").get() as
          | { value: string }
          | undefined
      )?.value;
      if (!meta || !(Number(puzzles) > 0)) return false;
      db.prepare('SELECT COUNT(*) AS n FROM theme_counts').get();
      db.prepare('SELECT id FROM puzzles LIMIT 1').get();
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false; // truncated, headerless, or missing the tables it needs
  }
}

/**
 * Deal with what a killed puzzle build leaves in the data directory.
 *
 * The build writes `puzzles.sqlite.building` and renames it into place at
 * the end (here rather than in the child on Windows, where the server's own
 * read handle blocks the rename-over), and downloads the dump to a `.part`
 * file first. Quitting the desktop app kills the server, and the server is
 * the only supervisor the builder has — so an interrupted build leaves
 * either of those sitting there for ever. Nothing lists them and no page
 * can delete them: 2.6 GB and 304 MB respectively, invisible.
 *
 * Startup is the one moment when they are known to be dead, since no build
 * can be running yet. The `.part` always goes — a download is never resumed,
 * the builder re-fetches from zero. The `.building` file goes unless it is
 * a build that finished in the instant before the server died, which is a
 * whole database that only missed its rename and is renamed in instead.
 *
 * The dump ITSELF (`lichess_db_puzzle.csv.zst`) is deliberately left alone:
 * a build deletes only a dump it downloaded, because one the user put there
 * is theirs, and this cannot tell the two apart. It also saves the next
 * build the download.
 */
export function sweepUnfinishedPuzzleBuild(dbPath: string = DATA_PUZZLES): void {
  rmSync(resolve(dirname(dbPath), 'lichess_db_puzzle.csv.zst.part'), { force: true });

  const building = `${dbPath}.building`;
  if (!existsSync(building)) return;
  if (isFinishedPuzzleBuild(building)) {
    try {
      renameRetrying(building, dbPath);
      console.log('puzzles: swapped in the database an interrupted build had finished');
    } catch (error) {
      // Leave it: it is a whole database, and the next start tries again.
      console.warn(`puzzles: could not swap in the built database (${(error as Error).message})`);
    }
    return;
  }
  rmSync(building, { force: true });
  console.log('puzzles: discarded a part-built database — the build that wrote it never finished');
}

/**
 * How many counted attempts a theme needs before this vault is willing to
 * call it a weakness. Under five, one unlucky pin is a 0% record.
 */
const WEAK_THEME_MIN = 5;

/** One history.jsonl line; attempts carry more fields than the two rules read. */
type Attempt = { id: string; win: boolean; counted?: boolean } & Record<string, unknown>;

interface PuzzleRow {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  popularity: number;
  plays: number;
  themes: string;
  game_url: string | null;
  opening_tags: string | null;
}

interface UserState {
  attempts: number;
  wins: number;
  streak: number;
  /**
   * The adaptive picker's skill estimate — a plain Elo against the
   * puzzles' own ratings. It exists to CHOOSE puzzles, never to be
   * shown: the house rule (difficulty is a word, a rating is not a
   * verdict) still stands, so this never leaves state.json — every
   * response strips it via publicState. Absent until the first adaptive
   * pick or counted attempt seeds it from the whole attempt history.
   */
  skill?: number;
  /** Counted attempts folded into `skill` — sets the K step. */
  skillAttempts?: number;
}

const DEFAULT_STATE: UserState = { attempts: 0, wins: 0, streak: 0 };

/** What the API answers with: the counters, never the skill estimate. */
const publicState = (s: UserState): { attempts: number; wins: number; streak: number } => ({
  attempts: s.attempts,
  wins: s.wins,
  streak: s.streak,
});

/** Everyone starts mid-pool; the clamp keeps a bad streak from walking
    the estimate off the edge of the rating range. */
const SKILL_START = 1500;
const clampSkill = (v: number): number => Math.min(3000, Math.max(600, v));

/** One Elo step: a fast K while the estimate is finding its level, a
    settled one after. */
const skillStep = (skill: number, folded: number, puzzleRating: number, win: boolean): number => {
  const k = folded < 30 ? 40 : 20;
  const expected = 1 / (1 + 10 ** ((puzzleRating - skill) / 400));
  return clampSkill(skill + k * ((win ? 1 : 0) - expected));
};

/**
 * COUNT(*) over the rating index walks every matching row — measured at
 * ~158 ms across the full 6.1M-puzzle table, paid on EVERY "next puzzle".
 * The database is opened read-only and is never rewritten in-process (a
 * rebuild renames a fresh file over it and needs a restart, see the handle
 * comment below), so the count for a given filter cannot change: cache it
 * for the process lifetime, exactly like themesCache.
 */
const countCache = new Map<string, number>();

/**
 * Per-rating row counts for one filter, with a running total, so a random
 * offset can be resolved to a rating without walking the index.
 * `total === 0` means the filter matches nothing.
 */
interface Buckets {
  ratings: number[];
  /** cum[i] = rows at ratings[0..i] inclusive; cum.at(-1) is the total. */
  cum: number[];
  total: number;
}

/**
 * Small enough to list rather than sample. 256 ids is one cheap query, and
 * the puzzle pools that get this narrow are exactly the ones where random
 * draws keep landing on puzzles already attempted.
 */
const SMALL_POOL = 256;

/** Filter -> buckets, or null when the database predates the count tables. */
const bucketCache = new Map<string, Buckets | null>();

const hasTable = (db: InstanceType<typeof Database>, name: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

/**
 * `LIMIT 1 OFFSET n` cannot jump: SQLite walks and discards n index entries
 * first, so a mid-table draw over 6.1 M puzzles burned ~90 ms doing nothing
 * else. Databases built since this comment carry per-rating row counts
 * (`rating_counts` / `theme_rating_counts`, see scripts/build-puzzles.ts),
 * which turn one huge offset into a rating lookup plus a tiny offset inside
 * that rating — a couple of thousand rows at most.
 *
 * The distribution is unchanged: the buckets ARE the order the old query
 * walked (both indexes lead with `rating`), so picking a uniform offset over
 * the total and mapping it through the cumulative sums lands on exactly the
 * row the walk would have reached.
 *
 * Returns null for databases without the tables — the caller falls back.
 */
function loadBuckets(
  db: InstanceType<typeof Database>,
  min: number,
  max: number,
  theme: string | null,
  cacheKey: string,
): Buckets | null {
  const cached = bucketCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const table = theme ? 'theme_rating_counts' : 'rating_counts';
  let buckets: Buckets | null = null;
  if (hasTable(db, table)) {
    const rows = (
      theme
        ? db
            .prepare(
              'SELECT rating, n FROM theme_rating_counts WHERE theme = ? AND rating BETWEEN ? AND ? ORDER BY rating',
            )
            .all(theme, min, max)
        : db
            .prepare('SELECT rating, n FROM rating_counts WHERE rating BETWEEN ? AND ? ORDER BY rating')
            .all(min, max)
    ) as { rating: number; n: number }[];
    const ratings: number[] = [];
    const cum: number[] = [];
    let total = 0;
    for (const row of rows) {
      total += row.n;
      ratings.push(row.rating);
      cum.push(total);
    }
    buckets = { ratings, cum, total };
  }
  bucketCache.set(cacheKey, buckets);
  return buckets;
}

/** Index of the first bucket whose cumulative count exceeds `target`. */
function bucketOf(cum: number[], target: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! > target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * A random puzzle in the rating range, optionally within a theme.
 * A handful of retries dodges already-attempted puzzles, and if everything
 * drawn is attempted (tiny pools) the last draw is served anyway — a repeat
 * beats a dead end.
 */
function pickPuzzle(
  db: InstanceType<typeof Database>,
  min: number,
  max: number,
  theme: string | null,
  exclude: Set<string>,
): PuzzleRow | null {
  // Keyed by file as well as filter: tests open several databases in one
  // process, and a count from one of them must never answer for another.
  const cacheKey = `${db.name}|${theme ?? ''}|${min}|${max}`;
  const buckets = loadBuckets(db, min, max, theme, cacheKey);

  let drawId: () => string;
  if (buckets) {
    if (buckets.total === 0) return null;
    const byBucket = db.prepare(
      theme
        ? 'SELECT id FROM themes WHERE theme = ? AND rating = ? LIMIT 1 OFFSET ?'
        : 'SELECT id FROM puzzles WHERE rating = ? LIMIT 1 OFFSET ?',
    );
    drawId = () => {
      const target = Math.floor(Math.random() * buckets.total);
      const i = bucketOf(buckets.cum, target);
      const offset = target - (i > 0 ? buckets.cum[i - 1]! : 0);
      const rating = buckets.ratings[i]!;
      const row = theme ? byBucket.get(theme, rating, offset) : byBucket.get(rating, offset);
      return (row as { id: string }).id;
    };
  } else {
    const where = theme
      ? 'FROM themes WHERE theme = ? AND rating BETWEEN ? AND ?'
      : 'FROM puzzles WHERE rating BETWEEN ? AND ?';
    const args = theme ? [theme, min, max] : [min, max];
    let count = countCache.get(cacheKey);
    if (count === undefined) {
      count = (db.prepare(`SELECT COUNT(*) AS n ${where}`).get(...args) as { n: number }).n;
      countCache.set(cacheKey, count);
    }
    if (count === 0) return null;
    const byOffset = db.prepare(`SELECT id ${where} LIMIT 1 OFFSET ?`);
    drawId = () =>
      (byOffset.get(...args, Math.floor(Math.random() * count!)) as { id: string }).id;
  }

  const byId = db.prepare(
    'SELECT id, fen, moves, rating, popularity, plays, themes, game_url, opening_tags FROM puzzles WHERE id = ?',
  );

  // A narrow filter — a rare theme in a tight rating band — can leave a
  // pool of a handful. Drawing at random then hoping to miss the attempted
  // ones re-serves a solved puzzle surprisingly often there: with three
  // puzzles and two of them attempted, twelve draws all miss the fresh one
  // about once in every 130 requests. Small pools are cheap to enumerate,
  // so enumerate them and pick from what is actually left.
  const total = buckets ? buckets.total : (countCache.get(cacheKey) ?? 0);
  if (total > 0 && total <= SMALL_POOL) {
    const where = theme
      ? 'FROM themes WHERE theme = ? AND rating BETWEEN ? AND ?'
      : 'FROM puzzles WHERE rating BETWEEN ? AND ?';
    const args = theme ? [theme, min, max] : [min, max];
    const ids = (db.prepare(`SELECT id ${where}`).all(...args) as { id: string }[]).map((r) => r.id);
    const fresh = ids.filter((id) => !exclude.has(id));
    // Everything attempted: a repeat beats a dead end.
    const pool = fresh.length > 0 ? fresh : ids;
    if (pool.length === 0) return null;
    return byId.get(pool[Math.floor(Math.random() * pool.length)]!) as PuzzleRow;
  }

  let fallback: string | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const id = drawId();
    if (!exclude.has(id)) return byId.get(id) as PuzzleRow;
    fallback = id;
  }
  return fallback ? (byId.get(fallback) as PuzzleRow) : null;
}

export function puzzlesApi(
  dbPath: string = DATA_PUZZLES,
  stateDir: string = resolve(VAULT, 'puzzles'),
): Hono & { closeDb: () => void } {
  const statePath = resolve(stateDir, 'state.json');
  const historyPath = resolve(stateDir, 'history.jsonl');

  const readState = (): UserState => {
    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf-8')) as Partial<UserState>;
      return {
        attempts: raw.attempts ?? 0,
        wins: raw.wins ?? 0,
        streak: raw.streak ?? 0,
        ...(typeof raw.skill === 'number' && { skill: raw.skill }),
        ...(typeof raw.skillAttempts === 'number' && { skillAttempts: raw.skillAttempts }),
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  const writeState = (state: UserState): void => {
    mkdirSync(stateDir, { recursive: true });
    writeAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
  };

  /**
   * The attempt log, parsed with damage tolerated. appendFileSync can
   * leave a partial last line behind a crash or a full disk, and one such
   * line must not 500 every trainer route until someone edits the file by
   * hand — recovery would need a shell, which the house rules call a bug.
   * A line that does not parse (or parses to something without an id) is
   * dropped: one attempt forgotten beats the whole trainer down.
   */
  const historyEntries = (): Attempt[] => {
    let raw: string;
    try {
      raw = readFileSync(historyPath, 'utf-8');
    } catch {
      return [];
    }
    return raw
      .trimEnd()
      .split('\n')
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as Attempt;
          return typeof entry?.id === 'string' ? [entry] : [];
        } catch {
          return [];
        }
      });
  };

  /** Every puzzle ever attempted — fresh training never repeats one. */
  const attemptedIds = (): Set<string> => new Set(historyEntries().map((e) => e.id));

  /**
   * The theme this vault is worst at, or null when there is nothing
   * honest to say about it yet.
   *
   * Two rules keep it from being noise. A theme is only judged once it
   * has WEAK_THEME_MIN counted attempts, and it is only reported when it
   * is losing MORE often than the vault does overall — a theme you are
   * better at than your own average is not a weakness whatever its rate,
   * and naming one would send you to practise your best tactic.
   *
   * Attempts carry no themes of their own (history.jsonl is a log of ids
   * and outcomes), so the themes come from the puzzle database by id. One
   * query per 500 ids rather than one per attempt: SQLite's parameter
   * limit is what the chunk is for, and it is the same walk the review
   * pool already does over this file.
   *
   * Read from `puzzles`, whose id is the primary key, and NOT from the
   * `themes` table, which looks like the natural place and is a trap:
   * its only index is (theme, rating), so a lookup BY ID scans all 27.6
   * million rows of it. That is what the first cut of this did, and it
   * put 2.7 seconds into /api/puzzles/meta — a request the hub, the
   * dashboard and the themes page all wait on. The same answer off the
   * primary key is a few milliseconds; puzzles.themes is the same list,
   * space-separated.
   */
  const weakestTheme = (
    db: InstanceType<typeof Database>,
  ): { theme: string; attempts: number; wins: number } | null => {
    const attempts = historyEntries().filter((e) => e.counted !== false);
    if (attempts.length === 0) return null;
    const ids = [...new Set(attempts.map((e) => e.id))];
    const themesById = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      const rows = db
        .prepare(
          `SELECT id, themes FROM puzzles WHERE id IN (${slice.map(() => '?').join(',')})`,
        )
        .all(...slice) as { id: string; themes: string }[];
      for (const row of rows) {
        themesById.set(row.id, row.themes.split(' ').filter(Boolean));
      }
    }
    const tally = new Map<string, { attempts: number; wins: number }>();
    let wins = 0;
    for (const entry of attempts) {
      if (entry.win) wins += 1;
      for (const theme of themesById.get(entry.id) ?? []) {
        const seen = tally.get(theme) ?? { attempts: 0, wins: 0 };
        seen.attempts += 1;
        if (entry.win) seen.wins += 1;
        tally.set(theme, seen);
      }
    }
    const overall = wins / attempts.length;
    let worst: { theme: string; attempts: number; wins: number } | null = null;
    for (const [theme, seen] of tally) {
      if (seen.attempts < WEAK_THEME_MIN) continue;
      const rate = seen.wins / seen.attempts;
      if (rate >= overall) continue;
      if (!worst || rate < worst.wins / worst.attempts) worst = { theme, ...seen };
    }
    return worst;
  };

  /**
   * Puzzles whose LATEST attempt was a loss: solving one cleanly (in any
   * mode) removes it from the pool, failing re-adds it. Only puzzles with
   * at least one COUNTED attempt are eligible — an uncounted replay can
   * re-add a trained puzzle but never introduce a new one, which keeps
   * the dashboard invariant attempts >= review pool.
   */
  const failedPool = (entries = historyEntries()): string[] => {
    const latest = new Map<string, boolean>();
    const trained = new Set<string>();
    for (const entry of entries) {
      latest.set(entry.id, entry.win);
      if (entry.counted !== false) trained.add(entry.id);
    }
    return [...latest].filter(([id, win]) => !win && trained.has(id)).map(([id]) => id);
  };

  /**
   * The review rotation, scheduled: every puzzle with a fail on record
   * that has not yet climbed off the ladder (shared/review.ts), with the
   * date it is next due, most overdue first. Eligibility is the failed
   * pool's own rule — at least one COUNTED attempt — so an uncounted
   * replay can advance or reset a trained puzzle's ladder but never put a
   * new puzzle into rotation. The whole thing is derived from the history
   * log, like the pool: nothing new is stored, and wiping the history
   * wipes the schedule with it.
   */
  const reviewQueue = (entries = historyEntries()): { id: string; due: string }[] => {
    const byId = new Map<string, ReviewAttempt[]>();
    const trained = new Set<string>();
    for (const entry of entries) {
      const attempts = byId.get(entry.id) ?? [];
      const at = (entry as { at?: unknown }).at;
      attempts.push({ win: entry.win, ...(typeof at === 'string' ? { at } : {}) });
      byId.set(entry.id, attempts);
      if (entry.counted !== false) trained.add(entry.id);
    }
    const queue: { id: string; due: string }[] = [];
    for (const [id, attempts] of byId) {
      if (!trained.has(id)) continue;
      const due = reviewDueAt(attempts);
      if (due !== null) queue.push({ id, due });
    }
    return queue.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  };

  /**
   * The state with a live skill estimate, seeding it on first need by
   * replaying every counted attempt in the history — each line carries
   * the puzzle's rating, so the whole record folds in without touching
   * the database. Old lines that predate the rating field are skipped
   * rather than guessed at. The seeded value is persisted so the replay
   * happens once, not per request.
   */
  const ensureSkill = (state: UserState): UserState & { skill: number; skillAttempts: number } => {
    if (typeof state.skill === 'number') {
      return { ...state, skill: state.skill, skillAttempts: state.skillAttempts ?? 0 };
    }
    let skill = SKILL_START;
    let folded = 0;
    for (const entry of historyEntries()) {
      if (entry.counted === false) continue;
      const rating = (entry as { puzzleRating?: unknown }).puzzleRating;
      if (typeof rating !== 'number') continue;
      skill = skillStep(skill, folded, rating, entry.win);
      folded += 1;
    }
    const seeded = { ...state, skill, skillAttempts: folded };
    writeState(seeded);
    return seeded;
  };

  // Lazily opened read-only handle for the process lifetime. A rebuild
  // renames a fresh file over it; restart the server to pick that up.
  let handle: InstanceType<typeof Database> | null = null;
  const puzzleDb = (): InstanceType<typeof Database> | null => {
    if (handle) return handle;
    if (!existsSync(dbPath)) return null;
    handle = new Database(dbPath, { readonly: true, fileMustExist: true });
    return handle;
  };

  // Windows can't delete an open database file, so tests need this.
  const closeDb = (): void => {
    handle?.close();
    handle = null;
  };

  const api = new Hono();

  /**
   * Building the puzzle database, from inside the app.
   *
   * This is the one dataset the app could not make for itself, and the
   * answer used to be two shell commands — which an installed desktop app
   * cannot offer: there is no repository, no npm, and on Windows and macOS
   * no `zstd` either. The build is a child process for the same reason the
   * book build is: it holds a write transaction over millions of rows for
   * minutes, and better-sqlite3 is synchronous, so in-process it would stop
   * the server answering anything at all.
   *
   * The child reports one JSON event per line; this keeps the last one, so
   * the UI can draw a bar without the server parsing a log.
   */
  interface BuildProgress {
    phase: 'downloading' | 'building' | 'indexing' | 'done';
    bytes?: number;
    total?: number;
    rows?: number;
    puzzles?: number;
    seconds?: number;
  }
  let build: {
    startedAt: number;
    running: boolean;
    progress: BuildProgress;
    error: string | null;
  } | null = null;

  const startBuild = (): void => {
    const current = {
      startedAt: Date.now(),
      running: true,
      progress: { phase: 'downloading', bytes: 0, total: 0 } as BuildProgress,
      error: null as string | null,
    };
    build = current;

    // A packaged build has no scripts/ and no tsx, so it ships the builder
    // as a bundle beside the server; the repo runs the source directly.
    const bundled = resolve(REPO_ROOT, 'server', 'build-puzzles.mjs');
    const args = existsSync(bundled)
      ? [bundled, '--progress-json']
      : ['--import', 'tsx', 'scripts/build-puzzles.ts', '--progress-json'];
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let pending = '';
    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
          current.progress = JSON.parse(line) as BuildProgress;
        } catch {
          // A partial or unexpected line is not worth failing a build over.
        }
      }
    });
    // Kept only to explain a failure: the last stderr line is what the user
    // is shown when the child dies, and it beats "exit code 1".
    let lastError = '';
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) lastError = text.split('\n').pop() ?? text;
    });

    child.on('error', (error) => {
      current.running = false;
      current.error = error.message;
    });
    child.on('close', (code) => {
      current.running = false;
      if (code !== 0) {
        current.error = lastError || `the build stopped unexpectedly (exit ${code})`;
        return;
      }
      // Windows: our own read handle blocks the child's rename-over, so it
      // leaves the fresh file beside the target and we swap it in here.
      closeDb();
      const building = `${dbPath}.building`;
      if (existsSync(building)) {
        // Before the rename, not after. The handle is opened once and kept
        // for the life of the process, so a rebuild left it serving the
        // file that had just been replaced — and on Windows an open file
        // cannot be renamed over at all, which turned the swap itself into
        // the error below. Closed here, reopened by the next request that
        // wants it, which is what the line after this always claimed.
        closeDb();
        try {
          renameRetrying(building, dbPath);
        } catch (error) {
          current.error = `the database was built but could not be swapped in (${(error as Error).message})`;
          return;
        }
      }
      // The next request opens the new file; nothing has to be restarted.
      themesCache = null;
    });
  };

  api.get('/puzzles/build', (c) =>
    c.json(
      build
        ? {
            running: build.running,
            seconds: (Date.now() - build.startedAt) / 1000,
            error: build.error,
            ...build.progress,
          }
        : { running: false },
    ),
  );

  api.post('/puzzles/build', (c) => {
    if (build?.running) return c.json({ error: 'a build is already running' }, 409);
    startBuild();
    return c.json({ running: true });
  });

  // Theme counts never change while the process lives (a rebuild replaces
  // the file and the server restarts), so compute once and keep. Newer
  // databases carry a precomputed theme_counts table; older ones pay one
  // ~1 s GROUP BY on first request instead of on every request.
  let themesCache: { theme: string; count: number }[] | null = null;
  const themeCounts = (db: InstanceType<typeof Database>): { theme: string; count: number }[] => {
    if (themesCache) return themesCache;
    const hasTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'theme_counts'")
      .get();
    themesCache = (
      hasTable
        ? db.prepare('SELECT theme, count FROM theme_counts ORDER BY count DESC').all()
        : db
            .prepare(
              'SELECT theme, COUNT(*) AS count FROM themes GROUP BY theme ORDER BY count DESC',
            )
            .all()
    ) as { theme: string; count: number }[];
    return themesCache;
  };

  api.get('/puzzles/meta', (c) => {
    const db = puzzleDb();
    const user = readState();
    if (!db) return c.json({ ready: false as const, user: publicState(user) });
    const meta = Object.fromEntries(
      (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map(
        (r) => [r.key, r.value],
      ),
    );
    // One read of the log serves the pool and the schedule both.
    const entries = historyEntries();
    const queue = reviewQueue(entries);
    const now = new Date().toISOString();
    return c.json({
      ready: true as const,
      puzzles: Number(meta.puzzles ?? 0),
      themes: themeCounts(db),
      failed: failedPool(entries).length,
      // What the ladder says: how many are due now, and when the next
      // one lands if nothing is. Both derived, like the pool.
      due: queue.filter((q) => q.due <= now).length,
      nextDue: queue.find((q) => q.due > now)?.due ?? null,
      weakTheme: weakestTheme(db),
      user: publicState(user),
    });
  });

  api.get('/puzzles/next', (c) => {
    const db = puzzleDb();
    if (!db) {
      return c.json(
        { error: 'No puzzle database yet — build it from the Puzzles page.' },
        503,
      );
    }

    // Review mode: due puzzles first, then the plain failed pool.
    if (c.req.query('mode') === 'failed') {
      // One read of the history log serves the queue, the pool and the last id.
      const entries = historyEntries();
      const lastId = entries.at(-1)?.id ?? null;
      const now = new Date().toISOString();
      // The ladder decides what a session should look at again: everything
      // whose date has come, most overdue first. The failed pool is the
      // fallback — a puzzle failed five minutes ago is not DUE until
      // tomorrow, but someone who wants to fix it now must still be able
      // to, which is also exactly what this mode always served.
      const due = reviewQueue(entries)
        .filter((q) => q.due <= now)
        .map((q) => q.id);
      const dueCandidates = due.length > 1 ? due.filter((id) => id !== lastId) : due;
      let id = dueCandidates[0];
      if (id === undefined) {
        const pool = failedPool(entries);
        const candidates = pool.length > 1 ? pool.filter((p) => p !== lastId) : pool;
        if (candidates.length === 0) {
          return c.json({ error: 'No failed puzzles to review — nothing to fix.' }, 404);
        }
        id = candidates[Math.floor(Math.random() * candidates.length)]!;
      }
      const puzzle = db
        .prepare(
          'SELECT id, fen, moves, rating, popularity, plays, themes, game_url, opening_tags FROM puzzles WHERE id = ?',
        )
        .get(id) as PuzzleRow | undefined;
      if (!puzzle) return c.json({ error: `unknown puzzle: ${id}` }, 404);
      return c.json({ puzzle });
    }

    const theme = c.req.query('theme') || null;

    // Adaptive: a window around the skill estimate, aimed slightly above
    // it — training lives at the edge of what is comfortable. The centre
    // is quantised so the bucket cache re-uses entries instead of growing
    // one per Elo point, and the window widens if the pool (a rare theme,
    // an extreme estimate) comes up empty.
    if (c.req.query('adaptive')) {
      const { skill } = ensureSkill(readState());
      const centre = Math.round(skill / 50) * 50;
      const attempted = attemptedIds();
      for (const spread of [
        [centre - 100, centre + 200],
        [centre - 300, centre + 400],
        [0, 9999],
      ] as const) {
        const puzzle = pickPuzzle(db, spread[0], spread[1], theme, attempted);
        if (puzzle) return c.json({ puzzle });
      }
      return c.json({ error: 'No puzzle matches that filter.' }, 404);
    }

    const min = Number(c.req.query('min')) || 0;
    const max = Number(c.req.query('max')) || 9999;
    const puzzle = pickPuzzle(db, min, max, theme, attemptedIds());
    if (!puzzle) return c.json({ error: 'No puzzle matches that filter.' }, 404);
    return c.json({ puzzle });
  });

  // A specific puzzle, for targeted replays from the dashboard.
  api.get('/puzzles/by-id/:id', (c) => {
    const db = puzzleDb();
    if (!db) return c.json({ error: 'no puzzle database' }, 503);
    const puzzle = db
      .prepare(
        'SELECT id, fen, moves, rating, popularity, plays, themes, game_url, opening_tags FROM puzzles WHERE id = ?',
      )
      .get(c.req.param('id')) as PuzzleRow | undefined;
    if (!puzzle) return c.json({ error: `unknown puzzle: ${c.req.param('id')}` }, 404);
    return c.json({ puzzle });
  });

  api.post('/puzzles/attempt', async (c) => {
    const body = (await c.req.json()) as { id?: string; win?: boolean; counted?: boolean };
    if (typeof body.id !== 'string' || typeof body.win !== 'boolean') {
      return c.json({ error: 'expected { id, win }' }, 400);
    }
    const db = puzzleDb();
    const row = db
      ? (db.prepare('SELECT rating FROM puzzles WHERE id = ?').get(body.id) as
          | { rating: number }
          | undefined)
      : undefined;
    if (!row) return c.json({ error: `unknown puzzle: ${body.id}` }, 404);

    // Review attempts don't move the counters — the solver has seen the
    // answer — but they DO update the failed pool through the history.
    const counted = body.counted !== false;
    // Seeded BEFORE this attempt is appended, so the replay and the live
    // update never fold the same attempt twice.
    const state = counted ? ensureSkill(readState()) : readState();
    const next: UserState = counted
      ? {
          attempts: state.attempts + 1,
          wins: state.wins + (body.win ? 1 : 0),
          streak: body.win ? state.streak + 1 : 0,
          skill: skillStep(state.skill!, state.skillAttempts!, row.rating, body.win),
          skillAttempts: state.skillAttempts! + 1,
        }
      : state;
    if (counted) writeState(next);
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(
      historyPath,
      `${JSON.stringify({
        id: body.id,
        win: body.win,
        counted,
        puzzleRating: row.rating,
        at: new Date().toISOString(),
      })}\n`,
    );
    return c.json({ user: publicState(next) });
  });

  // Wipe counters, history, and with it the failed pool — everything the
  // trainer knows about past attempts. Puzzle data itself is untouched.
  api.post('/puzzles/reset', (c) => {
    rmSync(statePath, { force: true });
    rmSync(historyPath, { force: true });
    return c.json({ ok: true, user: { ...DEFAULT_STATE } });
  });

  api.get('/puzzles/history', (c) => {
    const limit = Math.min(Number(c.req.query('limit') || 50), 500);
    return c.json({ attempts: historyEntries().slice(-limit).reverse() });
  });

  return Object.assign(api, { closeDb });
}
