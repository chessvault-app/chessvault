import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_PUZZLES, VAULT } from './paths.ts';

/**
 * Puzzle trainer backed by the local Lichess dump (data/puzzles.sqlite,
 * built by `npm run build:puzzles`). The user's training state is vault
 * data: a rating in state.json and an append-only history.jsonl.
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
  rating: number;
  attempts: number;
  wins: number;
  streak: number;
}

const DEFAULT_STATE: UserState = { rating: 1500, attempts: 0, wins: 0, streak: 0 };

/**
 * Plain Elo against the puzzle's rating, K=32. The puzzle's own rating never
 * moves. Deliberately simple — one user, no need for Glicko's deviation
 * bookkeeping on top of a fixed puzzle pool.
 */
export function eloDelta(user: number, puzzle: number, win: boolean): number {
  const expected = 1 / (1 + 10 ** ((puzzle - user) / 400));
  return Math.round(32 * ((win ? 1 : 0) - expected));
}

/**
 * A random puzzle whose rating lies within a window around `center`,
 * optionally within a theme. Selection is count + random offset over the
 * covering index, so it stays fast on millions of rows; the window widens
 * until it finds candidates.
 */
function pickPuzzle(
  db: InstanceType<typeof Database>,
  center: number,
  theme: string | null,
  exclude: Set<string>,
): PuzzleRow | null {
  for (let window = 100; window <= 1600; window *= 2) {
    const min = center - window;
    const max = center + window;
    const where = theme
      ? 'FROM themes WHERE theme = ? AND rating BETWEEN ? AND ?'
      : 'FROM puzzles WHERE rating BETWEEN ? AND ?';
    const args = theme ? [theme, min, max] : [min, max];
    const count = (db.prepare(`SELECT COUNT(*) AS n ${where}`).get(...args) as { n: number }).n;
    if (count === 0) continue;

    // A handful of tries dodges recently-seen puzzles without a NOT IN over
    // an unbounded history.
    for (let attempt = 0; attempt < 8; attempt++) {
      const offset = Math.floor(Math.random() * count);
      const id = (
        db.prepare(`SELECT id ${where} LIMIT 1 OFFSET ?`).get(...args, offset) as { id: string }
      ).id;
      if (exclude.has(id)) continue;
      return db
        .prepare(
          'SELECT id, fen, moves, rating, popularity, plays, themes, game_url, opening_tags FROM puzzles WHERE id = ?',
        )
        .get(id) as PuzzleRow;
    }
  }
  return null;
}

export function puzzlesApi(
  dbPath: string = DATA_PUZZLES,
  stateDir: string = resolve(VAULT, 'puzzles'),
): Hono {
  const statePath = resolve(stateDir, 'state.json');
  const historyPath = resolve(stateDir, 'history.jsonl');

  const readState = (): UserState => {
    try {
      return { ...DEFAULT_STATE, ...(JSON.parse(readFileSync(statePath, 'utf-8')) as UserState) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  const writeState = (state: UserState): void => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  };

  /** Ids of the most recent attempts, to avoid immediate repeats. */
  const recentIds = (limit: number): Set<string> => {
    try {
      const lines = readFileSync(historyPath, 'utf-8').trimEnd().split('\n');
      return new Set(lines.slice(-limit).map((l) => (JSON.parse(l) as { id: string }).id));
    } catch {
      return new Set();
    }
  };

  /**
   * Puzzles whose LATEST attempt was a loss: solving one cleanly (in any
   * mode) removes it from the pool, failing re-adds it.
   */
  const failedPool = (): string[] => {
    try {
      const lines = readFileSync(historyPath, 'utf-8').trimEnd().split('\n');
      const latest = new Map<string, boolean>();
      for (const line of lines) {
        const entry = JSON.parse(line) as { id: string; win: boolean };
        latest.set(entry.id, entry.win);
      }
      return [...latest].filter(([, win]) => !win).map(([id]) => id);
    } catch {
      return [];
    }
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
            .prepare('SELECT theme, COUNT(*) AS count FROM themes GROUP BY theme ORDER BY count DESC')
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
      const avoid = recentIds(1);
      const candidates = pool.length > 1 ? pool.filter((id) => !avoid.has(id)) : pool;
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
    const user = readState();
    const center = Number(c.req.query('rating') || user.rating);
    const puzzle = pickPuzzle(db, center, theme, recentIds(200));
    if (!puzzle) return c.json({ error: 'No puzzle matches that filter.' }, 404);
    return c.json({ puzzle });
  });

  api.post('/puzzles/attempt', async (c) => {
    const body = (await c.req.json()) as { id?: string; win?: boolean; rated?: boolean };
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

    // Practice attempts (reviewing failed puzzles) never move the rating or
    // the counters — the solver has seen the answer — but they DO update
    // the failed pool through the history.
    const rated = body.rated !== false;
    const state = readState();
    const delta = rated ? eloDelta(state.rating, row.rating, body.win) : 0;
    const next: UserState = rated
      ? {
          rating: state.rating + delta,
          attempts: state.attempts + 1,
          wins: state.wins + (body.win ? 1 : 0),
          streak: body.win ? state.streak + 1 : 0,
        }
      : state;
    if (rated) writeState(next);
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(
      historyPath,
      `${JSON.stringify({
        id: body.id,
        win: body.win,
        rated,
        puzzleRating: row.rating,
        before: state.rating,
        after: next.rating,
        at: new Date().toISOString(),
      })}\n`,
    );
    return c.json({ user: next, delta });
  });

  api.get('/puzzles/history', (c) => {
    const limit = Math.min(Number(c.req.query('limit') || 50), 500);
    try {
      const lines = readFileSync(historyPath, 'utf-8').trimEnd().split('\n');
      return c.json({ attempts: lines.slice(-limit).reverse().map((l) => JSON.parse(l)) });
    } catch {
      return c.json({ attempts: [] });
    }
  });

  return api;
}
