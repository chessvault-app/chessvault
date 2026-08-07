import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_PUZZLES, VAULT } from './paths.ts';

/**
 * Puzzle trainer backed by the local Lichess dump (data/puzzles.sqlite,
 * built by `npm run build:puzzles`). Single-user by design: no rating
 * system (lanph3re's call) — difficulty is an explicit range filter, progress
 * is counters, and every attempt lands in an append-only history.jsonl
 * that drives two rules:
 *
 *  - fresh training never re-serves an attempted puzzle (6.1 M is plenty);
 *  - puzzles whose latest attempt failed form the review pool.
 */

export interface PuzzleRow {
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
}

const DEFAULT_STATE: UserState = { attempts: 0, wins: 0, streak: 0 };

/**
 * A random puzzle in the rating range, optionally within a theme.
 * Count + random offset over the covering index; a handful of retries
 * dodges already-attempted puzzles, and if everything drawn is attempted
 * (tiny pools) the last draw is served anyway — a repeat beats a dead end.
 */
function pickPuzzle(
  db: InstanceType<typeof Database>,
  min: number,
  max: number,
  theme: string | null,
  exclude: Set<string>,
): PuzzleRow | null {
  const where = theme
    ? 'FROM themes WHERE theme = ? AND rating BETWEEN ? AND ?'
    : 'FROM puzzles WHERE rating BETWEEN ? AND ?';
  const args = theme ? [theme, min, max] : [min, max];
  const count = (db.prepare(`SELECT COUNT(*) AS n ${where}`).get(...args) as { n: number }).n;
  if (count === 0) return null;

  const byId = db.prepare(
    'SELECT id, fen, moves, rating, popularity, plays, themes, game_url, opening_tags FROM puzzles WHERE id = ?',
  );
  let fallback: string | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const offset = Math.floor(Math.random() * count);
    const id = (
      db.prepare(`SELECT id ${where} LIMIT 1 OFFSET ?`).get(...args, offset) as { id: string }
    ).id;
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
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  const writeState = (state: UserState): void => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  };

  const historyLines = (): string[] => {
    try {
      return readFileSync(historyPath, 'utf-8').trimEnd().split('\n');
    } catch {
      return [];
    }
  };

  /** Every puzzle ever attempted — fresh training never repeats one. */
  const attemptedIds = (): Set<string> =>
    new Set(historyLines().map((l) => (JSON.parse(l) as { id: string }).id));

  /**
   * Puzzles whose LATEST attempt was a loss: solving one cleanly (in any
   * mode) removes it from the pool, failing re-adds it.
   */
  const failedPool = (): string[] => {
    const latest = new Map<string, boolean>();
    for (const line of historyLines()) {
      const entry = JSON.parse(line) as { id: string; win: boolean };
      latest.set(entry.id, entry.win);
    }
    return [...latest].filter(([, win]) => !win).map(([id]) => id);
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
    if (!db) return c.json({ ready: false as const, user });
    const meta = Object.fromEntries(
      (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map(
        (r) => [r.key, r.value],
      ),
    );
    return c.json({
      ready: true as const,
      puzzles: Number(meta.puzzles ?? 0),
      themes: themeCounts(db),
      failed: failedPool().length,
      user,
    });
  });

  api.get('/puzzles/next', (c) => {
    const db = puzzleDb();
    if (!db) {
      return c.json(
        { error: 'No puzzle database. Run: npm run build:puzzles (see HANDOFF.md)' },
        503,
      );
    }

    // Practice mode: re-serve puzzles whose latest attempt failed.
    if (c.req.query('mode') === 'failed') {
      const pool = failedPool();
      const last = historyLines().at(-1);
      const lastId = last ? (JSON.parse(last) as { id: string }).id : null;
      const candidates = pool.length > 1 ? pool.filter((id) => id !== lastId) : pool;
      if (candidates.length === 0) {
        return c.json({ error: 'No failed puzzles to review — nothing to fix.' }, 404);
      }
      const id = candidates[Math.floor(Math.random() * candidates.length)]!;
      const puzzle = db
        .prepare(
          'SELECT id, fen, moves, rating, popularity, plays, themes, game_url, opening_tags FROM puzzles WHERE id = ?',
        )
        .get(id) as PuzzleRow | undefined;
      if (!puzzle) return c.json({ error: `unknown puzzle: ${id}` }, 404);
      return c.json({ puzzle });
    }

    const theme = c.req.query('theme') || null;
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
    const state = readState();
    const next: UserState = counted
      ? {
          attempts: state.attempts + 1,
          wins: state.wins + (body.win ? 1 : 0),
          streak: body.win ? state.streak + 1 : 0,
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
    return c.json({ user: next });
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
    const lines = historyLines();
    return c.json({
      attempts: lines
        .slice(-limit)
        .reverse()
        .map((l) => JSON.parse(l)),
    });
  });

  return Object.assign(api, { closeDb });
}
