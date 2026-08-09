import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA } from './paths.ts';

/**
 * Reference games (data/refgames.sqlite, built by `npm run build:refgames`
 * from PGN collections in vault/sources) — elite games browsable from the
 * Games tab. Read-only; a rebuild renames the file, restart to pick it up.
 */

const DB_PATH = resolve(DATA, 'refgames.sqlite');
const PAGE = 50;

interface RefGameRow {
  id: number;
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: string;
  date: string | null;
  event: string | null;
  eco: string | null;
  opening: string | null;
}

export function refGamesApi(dbPath: string = DB_PATH): Hono {
  let handle: InstanceType<typeof Database> | null = null;
  const db = (): InstanceType<typeof Database> | null => {
    if (handle) return handle;
    if (!existsSync(dbPath)) return null;
    handle = new Database(dbPath, { readonly: true, fileMustExist: true });
    return handle;
  };

  const api = new Hono();

  api.get('/refgames', (c) => {
    const d = db();
    if (!d) return c.json({ ready: false as const });
    const meta = Object.fromEntries(
      (d.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map(
        (r) => [r.key, r.value],
      ),
    );
    return c.json({
      ready: true as const,
      games: Number(meta.games ?? 0),
      sources: meta.sources ?? '',
    });
  });

  api.get('/refgames/search', (c) => {
    const d = db();
    if (!d) return c.json({ error: 'No reference games. Run: npm run build:refgames' }, 503);
    const q = (c.req.query('q') ?? '').trim();
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);

    // One box searches everything a game is findable by: players, the
    // opening name, and the ECO code (prefix match, so "B9" finds B90-B99).
    const where = q ? 'WHERE white LIKE ? OR black LIKE ? OR opening LIKE ? OR eco LIKE ?' : '';
    const args = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `${q}%`] : [];
    const total = (
      d.prepare(`SELECT COUNT(*) AS n FROM games ${where}`).get(...args) as { n: number }
    ).n;
    const rows = d
      .prepare(
        `SELECT id, white, black, white_elo, black_elo, result, date, event, eco, opening
         FROM games ${where} ORDER BY id DESC LIMIT ${PAGE} OFFSET ?`,
      )
      .all(...args, offset) as RefGameRow[];
    return c.json({ total, rows });
  });

  // Match a book's top-game reference (metadata only) to a full game
  // here, so the explorer can open it on the board.
  api.get('/refgames/find', (c) => {
    const d = db();
    if (!d) return c.json({ error: 'no reference games database' }, 503);
    const { white, black, date, result } = c.req.query();
    if (!white || !black) return c.json({ error: 'expected white & black' }, 400);
    const row = d
      .prepare(
        `SELECT id FROM games
         WHERE white = ? AND black = ? AND (? IS NULL OR date = ?) AND (? IS NULL OR result = ?)
         LIMIT 1`,
      )
      .get(white, black, date ?? null, date ?? null, result ?? null, result ?? null) as
      | { id: number }
      | undefined;
    if (!row) return c.json({ error: 'not indexed' }, 404);
    return c.json({ id: row.id });
  });

  api.get('/refgames/:id/pgn', (c) => {
    const d = db();
    if (!d) return c.json({ error: 'no reference games database' }, 503);
    const row = d
      .prepare('SELECT * FROM games WHERE id = ?')
      .get(Number(c.req.param('id'))) as (RefGameRow & { moves: string }) | undefined;
    if (!row) return c.json({ error: 'unknown game' }, 404);

    const header = (key: string, value: string | null): string =>
      value ? `[${key} "${value.replace(/"/g, '')}"]\n` : '';
    const pgn =
      header('Event', row.event) +
      header('White', row.white) +
      header('Black', row.black) +
      header('WhiteElo', row.white_elo ? String(row.white_elo) : null) +
      header('BlackElo', row.black_elo ? String(row.black_elo) : null) +
      header('Date', row.date) +
      header('ECO', row.eco) +
      header('Opening', row.opening) +
      header('Result', row.result) +
      `\n${row.moves} ${row.result}\n`;
    return c.json({ pgn });
  });

  return api;
}
