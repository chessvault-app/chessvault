import { Hono } from 'hono';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import {
  PgnParser,
  makePgn,
  parseComment,
  type Game,
  type PgnNodeData,
} from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { hashSetup } from '../shared/zobrist.ts';
import { openingForKey, type Opening } from './openings.ts';
import { VAULT_GAMES } from './paths.ts';

/**
 * The Games section is a curated COLLECTION: one PGN file per kept game in
 * vault/games/collection/, each annotatable exactly like a study chapter.
 *
 * chess.com history is *browsed*, not bulk-imported: the archive month list
 * comes from the public API, a month's games are cached on first view as
 * vault/games/chesscom/<user>/<YYYY-MM>.pgn (so browsing stays offline
 * afterwards), and individual games are promoted into the collection.
 */

const USER_RE = /^[A-Za-z0-9_.-]{1,60}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
// chess.com asks bots to identify themselves; a UA with contact beats a 403.
const FETCH_HEADERS = { 'User-Agent': 'chess-vault (personal offline study app)' };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`chess.com replied ${res.status}`);
  return (await res.json()) as T;
}

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
  opening: Opening | null;
  finalFen: string | null;
  /** Which side the vault's owner played, when it can be determined. */
  userSide: 'white' | 'black' | null;
  /** True when the game carries comments, NAGs or variations. */
  annotated: boolean;
}

function replaySummary(game: Game<PgnNodeData>): {
  opening: Opening | null;
  finalFen: string | null;
  annotated: boolean;
} {
  let annotated = false;
  for (const node of game.moves.mainlineNodes()) {
    if (node.children.length > 1) annotated = true;
    if (node.data.nags?.length) annotated = true;
    if (node.data.comments?.some((c) => parseComment(c).text.trim().length > 0)) annotated = true;
    if (annotated) break;
  }

  const variant = (game.headers.get('Variant') ?? 'standard').toLowerCase();
  if (!['standard', 'chess', 'classical', 'normal'].includes(variant) || game.headers.has('FEN')) {
    return { opening: null, finalFen: null, annotated };
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
  return { opening, finalFen: makeFen(pos.toSetup()), annotated };
}

// Summaries parsed per file and cached by mtime — plain files stay fast
// without a database.
const listCache = new Map<string, { mtimeMs: number; games: GameSummary[] }>();

function parseFileSummaries(dir: string, path: string): GameSummary[] {
  const stat = statSync(path);
  const rel = relative(dir, path).split(sep).join('/');
  const cached = listCache.get(rel);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.games;

  // Archive files live at chesscom/<user>/<month>.pgn — the path names the
  // player, which is what lets every row know which side they played.
  const pathUser = rel.startsWith('chesscom/') ? (rel.split('/')[1]?.toLowerCase() ?? null) : null;

  const games: GameSummary[] = [];
  const parser = new PgnParser((game, err) => {
    if (err) return;
    const h = (key: string): string | undefined => game.headers.get(key);
    const white = h('White') ?? '?';
    const black = h('Black') ?? '?';
    const vaultSide = h('VaultSide');
    const userSide =
      vaultSide === 'white' || vaultSide === 'black'
        ? vaultSide
        : pathUser && white.toLowerCase() === pathUser
          ? 'white'
          : pathUser && black.toLowerCase() === pathUser
            ? 'black'
            : null;
    games.push({
      file: rel,
      index: games.length,
      white,
      black,
      whiteElo: Number(h('WhiteElo')) || 0,
      blackElo: Number(h('BlackElo')) || 0,
      result: h('Result') ?? '*',
      date: h('UTCDate') ?? h('Date') ?? '????.??.??',
      timeControl: h('TimeControl') ?? null,
      eco: h('ECO') ?? null,
      link: h('Link') ?? (h('Site')?.startsWith('http') ? h('Site')! : null),
      userSide,
      ...replaySummary(game),
    });
  });
  parser.parse(readFileSync(path, 'utf-8'));
  listCache.set(rel, { mtimeMs: stat.mtimeMs, games });
  return games;
}

function parseGames(path: string): Game<PgnNodeData>[] {
  const games: Game<PgnNodeData>[] = [];
  const parser = new PgnParser((game, err) => {
    if (!err) games.push(game);
  });
  parser.parse(readFileSync(path, 'utf-8'));
  return games;
}

/** Resolve a client-supplied relative file safely inside the games dir. */
function safeResolve(dir: string, rel: string): string | null {
  const abs = resolve(dir, rel);
  return abs.startsWith(dir + sep) && abs.endsWith('.pgn') ? abs : null;
}

function monthPath(dir: string, user: string, month: string): string {
  return resolve(dir, 'chesscom', user.toLowerCase(), `${month}.pgn`);
}

/** Fetch one month from chess.com into the on-disk cache. */
async function cacheMonth(dir: string, user: string, month: string): Promise<void> {
  const [year, mm] = month.split('-');
  const body = await fetchJson<{ games: { pgn?: string }[] }>(
    `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/${year}/${mm}`,
  );
  const pgns = body.games.map((g) => g.pgn).filter((p): p is string => Boolean(p));
  mkdirSync(resolve(dir, 'chesscom', user.toLowerCase()), { recursive: true });
  writeFileSync(monthPath(dir, user, month), pgns.length > 0 ? `${pgns.join('\n\n')}\n` : '');
}

// ---------------------------------------------------------------------------
// Bookmarks: starred collection games, stored as plain JSON in the vault.

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

// ---------------------------------------------------------------------------

export function gamesApi(dir: string = VAULT_GAMES): Hono {
  const collectionDir = resolve(dir, 'collection');
  mkdirSync(collectionDir, { recursive: true });
  const api = new Hono();

  /** The collection: one game per file, newest date first. */
  api.get('/games', (c) => {
    const games = readdirSync(collectionDir)
      .filter((f) => f.endsWith('.pgn'))
      .flatMap((f) => parseFileSummaries(dir, resolve(collectionDir, f)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file));
    return c.json({ total: games.length, games });
  });

  /** Months available for a user: remote archive list merged with the cache. */
  api.get('/games/archive/months', async (c) => {
    const user = c.req.query('user')?.trim();
    if (!user || !USER_RE.test(user)) return c.json({ error: 'invalid username' }, 400);

    const cachedMonths = new Map<string, number>();
    const userDir = resolve(dir, 'chesscom', user.toLowerCase());
    if (existsSync(userDir)) {
      for (const f of readdirSync(userDir).filter((f) => f.endsWith('.pgn'))) {
        const month = f.slice(0, -'.pgn'.length);
        cachedMonths.set(month, parseFileSummaries(dir, resolve(userDir, f)).length);
      }
    }

    let remote: string[] = [];
    let offline = false;
    try {
      const body = await fetchJson<{ archives: string[] }>(
        `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`,
      );
      remote = body.archives.map((url) => url.split('/').slice(-2).join('-'));
    } catch {
      offline = true; // cached months still browse fine
    }

    const all = [...new Set([...remote, ...cachedMonths.keys()])].sort().reverse();
    return c.json({
      offline,
      months: all.map((month) => ({
        month,
        cached: cachedMonths.has(month),
        games: cachedMonths.get(month) ?? null,
      })),
    });
  });

  /** One month's games, cached on disk the first time it is viewed. */
  api.get('/games/archive/month', async (c) => {
    const user = c.req.query('user')?.trim();
    const month = c.req.query('month')?.trim();
    if (!user || !USER_RE.test(user)) return c.json({ error: 'invalid username' }, 400);
    if (!month || !MONTH_RE.test(month)) return c.json({ error: 'invalid month' }, 400);

    const path = monthPath(dir, user, month);
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    // The current month keeps growing; refetch it when we can.
    if (!existsSync(path) || month === currentMonth) {
      try {
        await cacheMonth(dir, user, month);
      } catch (error) {
        if (!existsSync(path)) {
          return c.json({ error: `could not fetch that month (${(error as Error).message})` }, 502);
        }
        // offline with a stale cache — serve what we have
      }
    }
    return c.json({ month, games: parseFileSummaries(dir, path) });
  });

  /** Promote one archived game into the collection. */
  api.post('/games/collect', async (c) => {
    const body = await c.req
      .json<{ file?: string; index?: number }>()
      .catch(() => null);
    if (!body?.file || !Number.isInteger(body.index) || body.index! < 0) {
      return c.json({ error: 'need file and index' }, 400);
    }
    const path = safeResolve(dir, body.file);
    if (!path || !existsSync(path)) return c.json({ error: 'no such file' }, 404);

    const game = parseGames(path)[body.index!];
    if (!game) return c.json({ error: 'no such game' }, 404);

    // Record which side the vault owner played, for board orientation.
    const pathUser = body.file.startsWith('chesscom/')
      ? (body.file.split('/')[1]?.toLowerCase() ?? null)
      : null;
    const white = (game.headers.get('White') ?? '').toLowerCase();
    const black = (game.headers.get('Black') ?? '').toLowerCase();
    if (pathUser === white) game.headers.set('VaultSide', 'white');
    else if (pathUser === black) game.headers.set('VaultSide', 'black');

    return c.json({ id: addToCollection(game) });
  });

  /** The default document name for a game: "White vs Black YYYY-MM-DD". */
  function collectionBaseName(game: Game<PgnNodeData>): string {
    const date = (game.headers.get('UTCDate') ?? game.headers.get('Date') ?? '').replaceAll('.', '-');
    return `${game.headers.get('White') ?? '?'} vs ${game.headers.get('Black') ?? '?'} ${date}`
      .replace(/[^A-Za-z0-9 _.-]/g, '')
      .trim();
  }

  /** Write a parsed game into the collection under a readable, unique name. */
  function addToCollection(game: Game<PgnNodeData>): string {
    const base = collectionBaseName(game);
    let name = base;
    for (let n = 2; existsSync(resolve(collectionDir, `${name}.pgn`)); n += 1) {
      name = `${base} (${n})`;
    }
    writeFileSync(resolve(collectionDir, `${name}.pgn`), makePgn(game));
    return name;
  }

  // Any PGN — an elite reference game, a paste — promoted into the
  // collection as its own annotatable document.
  api.post('/games/collect-pgn', async (c) => {
    const body = await c.req.json<{ pgn?: string }>().catch(() => null);
    if (!body?.pgn) return c.json({ error: 'need pgn' }, 400);
    let game: Game<PgnNodeData> | null = null;
    const parser = new PgnParser((g, err) => {
      if (!err && !game) game = g;
    });
    parser.parse(body.pgn);
    if (!game) return c.json({ error: 'that PGN could not be read' }, 400);
    // Same players + same date = same game: a reference game must not pile
    // up copies (unlike /collect, whose client already dedupes by key).
    if (existsSync(resolve(collectionDir, `${collectionBaseName(game)}.pgn`))) {
      return c.json({ error: 'already in the collection' }, 409);
    }
    return c.json({ id: addToCollection(game) });
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
    const game = parseGames(path)[index];
    if (!game) return c.json({ error: 'no such game' }, 404);
    return c.json({ pgn: makePgn(game) });
  });

  return api;
}
