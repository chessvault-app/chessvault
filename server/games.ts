import { Hono } from 'hono';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { PgnParser, makePgn, type Game, type PgnNodeData } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { hashSetup } from '../shared/zobrist.ts';
import { openingForKey, type Opening } from './openings.ts';
import { VAULT_GAMES } from './paths.ts';

/**
 * Imported games live as plain PGN in vault/games/, one file per
 * chess.com month: vault/games/chesscom/<user>/<YYYY-MM>.pgn. Imports are
 * incremental — a month already on disk is never refetched, except the
 * current (still growing) one. The chess.com public API needs no auth.
 */

const USER_RE = /^[A-Za-z0-9_.-]{1,60}$/;
// chess.com asks bots to identify themselves; a UA with contact beats a 403.
const FETCH_HEADERS = { 'User-Agent': 'chess-vault (personal offline study app)' };

interface ImportJob {
  user: string;
  running: boolean;
  monthsDone: number;
  monthsTotal: number;
  games: number;
  error: string | null;
  startedAt: number;
}

let job: ImportJob | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`chess.com replied ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function runImport(user: string, dir: string): Promise<void> {
  const current: ImportJob = {
    user,
    running: true,
    monthsDone: 0,
    monthsTotal: 0,
    games: 0,
    error: null,
    startedAt: Date.now(),
  };
  job = current;
  try {
    const { archives } = await fetchJson<{ archives: string[] }>(
      `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`,
    );
    current.monthsTotal = archives.length;
    const userDir = resolve(dir, 'chesscom', user.toLowerCase());
    mkdirSync(userDir, { recursive: true });

    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    for (const url of archives) {
      const [year, month] = url.split('/').slice(-2);
      const key = `${year}-${month}`;
      const path = resolve(userDir, `${key}.pgn`);
      if (existsSync(path) && key !== currentMonth) {
        current.monthsDone += 1;
        continue; // already imported and closed — months never change
      }
      const body = await fetchJson<{ games: { pgn?: string }[] }>(url);
      const pgns = body.games.map((g) => g.pgn).filter((p): p is string => Boolean(p));
      if (pgns.length > 0) writeFileSync(path, `${pgns.join('\n\n')}\n`);
      current.games += pgns.length;
      current.monthsDone += 1;
    }
  } catch (error) {
    current.error = (error as Error).message;
  } finally {
    current.running = false;
  }
}

// ---------------------------------------------------------------------------
// Listing. Header-level metadata parsed per file and cached by mtime, so the
// games table stays fast without a database — these are still plain files.

export interface GameSummary {
  file: string;
  index: number;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: string;
  date: string;
  timeControl: string | null;
  eco: string | null;
  link: string | null;
  /** Deepest named position on the mainline, from the offline openings db. */
  opening: Opening | null;
  /** Position after the last mainline move — for hover previews. */
  finalFen: string | null;
}

/**
 * Replay the mainline once to get the final position and the deepest opening
 * name. Skips non-standard games; tolerates broken SAN by stopping there.
 */
function replaySummary(game: Game<PgnNodeData>): { opening: Opening | null; finalFen: string | null } {
  const variant = (game.headers.get('Variant') ?? 'standard').toLowerCase();
  if (!['standard', 'chess', 'classical', 'normal'].includes(variant) || game.headers.has('FEN')) {
    return { opening: null, finalFen: null };
  }
  const pos = Chess.default();
  let opening: Opening | null = null;
  let ply = 0;
  for (const data of game.moves.mainline()) {
    const move = parseSan(pos, data.san);
    if (!move) break;
    pos.play(move);
    ply += 1;
    if (ply <= 40) {
      const named = openingForKey(hashSetup(pos.toSetup()).toString(16));
      if (named) opening = named;
    }
  }
  return { opening, finalFen: makeFen(pos.toSetup()) };
}

const listCache = new Map<string, { mtimeMs: number; games: GameSummary[] }>();

function parseFileSummaries(dir: string, path: string): GameSummary[] {
  const stat = statSync(path);
  const rel = relative(dir, path);
  const cached = listCache.get(rel);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.games;

  const games: GameSummary[] = [];
  const parser = new PgnParser((game, err) => {
    if (err) return;
    const h = (key: string): string | undefined => game.headers.get(key);
    games.push({
      file: rel,
      index: games.length,
      white: h('White') ?? '?',
      black: h('Black') ?? '?',
      whiteElo: Number(h('WhiteElo')) || 0,
      blackElo: Number(h('BlackElo')) || 0,
      result: h('Result') ?? '*',
      date: h('UTCDate') ?? h('Date') ?? '????.??.??',
      timeControl: h('TimeControl') ?? null,
      eco: h('ECO') ?? null,
      link: h('Link') ?? (h('Site')?.startsWith('http') ? h('Site')! : null),
      ...replaySummary(game),
    });
  });
  parser.parse(readFileSync(path, 'utf-8'));
  listCache.set(rel, { mtimeMs: stat.mtimeMs, games });
  return games;
}

function walkPgnFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.pgn'))
    .map((f) => resolve(root, f));
}

/** Resolve a client-supplied relative file safely inside the games dir. */
function safeResolve(dir: string, rel: string): string | null {
  const abs = resolve(dir, rel);
  return abs.startsWith(dir + sep) && abs.endsWith('.pgn') ? abs : null;
}

// ---------------------------------------------------------------------------
// Bookmarks: starred games, stored as a plain JSON file in the vault so they
// are versioned and survive re-imports (month files are append-only, so a
// `file#index` key stays stable).

function bookmarksPath(dir: string): string {
  return resolve(dir, 'bookmarks.json');
}

function readBookmarks(dir: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(bookmarksPath(dir), 'utf-8')) as { keys?: string[] };
    return new Set(parsed.keys ?? []);
  } catch {
    return new Set();
  }
}

function writeBookmarks(dir: string, keys: Set<string>): void {
  writeFileSync(bookmarksPath(dir), `${JSON.stringify({ keys: [...keys].sort() }, null, 2)}\n`);
}

export function gamesApi(dir: string = VAULT_GAMES): Hono {
  mkdirSync(dir, { recursive: true });
  const api = new Hono();

  api.post('/games/import/chesscom', async (c) => {
    if (job?.running) return c.json({ error: 'an import is already running' }, 409);
    const body = await c.req.json<{ username?: string }>().catch(() => null);
    const user = body?.username?.trim();
    if (!user || !USER_RE.test(user)) return c.json({ error: 'invalid username' }, 400);
    void runImport(user, dir);
    return c.json({ started: true, user });
  });

  api.get('/games/import/status', (c) =>
    c.json(
      job
        ? {
            running: job.running,
            user: job.user,
            monthsDone: job.monthsDone,
            monthsTotal: job.monthsTotal,
            games: job.games,
            error: job.error,
            seconds: (Date.now() - job.startedAt) / 1000,
          }
        : { running: false },
    ),
  );

  api.get('/games', (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 200, 1000);
    const offset = Number(c.req.query('offset')) || 0;
    const all = walkPgnFiles(dir)
      .flatMap((path) => parseFileSummaries(dir, path))
      .sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index);
    return c.json({ total: all.length, games: all.slice(offset, offset + limit) });
  });

  api.get('/games/bookmarks', (c) => c.json({ keys: [...readBookmarks(dir)] }));

  api.post('/games/bookmarks/toggle', async (c) => {
    const body = await c.req.json<{ file?: string; index?: number }>().catch(() => null);
    if (!body?.file || !Number.isInteger(body.index) || body.index! < 0) {
      return c.json({ error: 'need file and index' }, 400);
    }
    if (!safeResolve(dir, body.file)) return c.json({ error: 'invalid file' }, 400);
    const key = `${body.file}#${body.index}`;
    const keys = readBookmarks(dir);
    const bookmarked = !keys.has(key);
    if (bookmarked) keys.add(key);
    else keys.delete(key);
    writeBookmarks(dir, keys);
    return c.json({ key, bookmarked });
  });

  api.get('/games/pgn', (c) => {
    const file = c.req.query('file');
    const index = Number(c.req.query('index'));
    if (!file || !Number.isInteger(index) || index < 0) {
      return c.json({ error: 'need ?file= and ?index=' }, 400);
    }
    const path = safeResolve(dir, file);
    if (!path || !existsSync(path)) return c.json({ error: 'no such file' }, 404);

    const games: Game<PgnNodeData>[] = [];
    const parser = new PgnParser((game, err) => {
      if (!err) games.push(game);
    });
    parser.parse(readFileSync(path, 'utf-8'));
    const game = games[index];
    if (!game) return c.json({ error: 'no such game' }, 404);
    return c.json({ pgn: makePgn(game) });
  });

  return api;
}
