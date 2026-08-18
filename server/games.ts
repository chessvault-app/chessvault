import { Hono } from 'hono';
import { sanitizeSegment } from '../shared/vaultNames.ts';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeAtomic } from './atomic.ts';
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
import { pathUser, userSideOf } from '../shared/gameIndex.ts';
import { openingsIndex, type Opening } from './openings.ts';
import { VAULT_CONFIG, VAULT_GAMES } from './paths.ts';

/**
 * The Games section is a curated COLLECTION: one PGN file per kept game in
 * vault/games/collection/, each annotatable exactly like a study chapter.
 *
 * chess.com history is *browsed*, not bulk-imported: the archive month list
 * comes from the public API, a month's games are cached on first view as
 * vault/games/chesscom/<user>/<YYYY-MM>.pgn (so browsing stays offline
 * afterwards), and individual games are promoted into the collection.
 */

// Leading char must be alphanumeric so a username can never be `..` (which
// would steer the resolved path one level up out of the provider subdir).
const USER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
// chess.com asks bots to identify themselves; a UA with contact beats a 403.
const FETCH_HEADERS = { 'User-Agent': 'chess-vault (personal offline study app)' };

/**
 * An upstream that answered, and said no.
 *
 * The status matters to the caller: a 404 from a player endpoint means
 * there is no such player, which is a fact worth passing on, while
 * anything else — a timeout, a refusal, a rewrite — means the network and
 * the cached months still browse. A plain Error made those the same
 * thing, and "no such player" came out as "offline".
 */
class UpstreamError extends Error {
  constructor(
    readonly status: number,
    host: string,
  ) {
    super(`${host} replied ${status}`);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new UpstreamError(res.status, new URL(url).host);
  return (await res.json()) as T;
}

interface GameSummary {
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
  // The index is fetched ONCE per game, not once per ply — openingForKey
  // stats the openings file on every call.
  const index = openingsIndex();
  for (const data of game.moves.mainline()) {
    const move = parseSan(pos, data.san);
    if (!move) break;
    pos.play(move);
    ply += 1;
    if (ply <= 40 && index) {
      const entry = index[hashSetup(pos.toSetup()).toString(16)];
      if (entry) opening = { eco: entry[0], name: entry[1] };
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
  const user = pathUser(rel);

  const games: GameSummary[] = [];
  const parser = new PgnParser((game, err) => {
    if (err) return;
    const h = (key: string): string | undefined => game.headers.get(key);
    const white = h('White') ?? '?';
    const black = h('Black') ?? '?';
    const userSide = userSideOf(white, black, h('VaultSide'), user);
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

// Cached by mtime like the summaries above, and for the same reason:
// /games/pgn is hit once per game OPENED, so browsing through a 300-game
// month used to re-read and re-parse the same 1–2 MB file on every click
// while the summary cache sat beside it. Callers must not mutate the
// returned games.
const gamesCache = new Map<string, { mtimeMs: number; games: Game<PgnNodeData>[] }>();

function parseGames(path: string): Game<PgnNodeData>[] {
  const mtimeMs = statSync(path).mtimeMs;
  const cached = gamesCache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.games;
  const games: Game<PgnNodeData>[] = [];
  const parser = new PgnParser((game, err) => {
    if (!err) games.push(game);
  });
  parser.parse(readFileSync(path, 'utf-8'));
  gamesCache.set(path, { mtimeMs, games });
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

/**
 * What is known about a cached month besides its games.
 *
 * Kept beside them as a dotfile, so the month listing — which counts
 * `.pgn` — never sees it.
 */
interface CacheMeta {
  months: Record<string, { lastModified?: string; fetchedAt?: number }>;
}

function metaPath(dir: string, provider: string, user: string): string {
  return resolve(dir, provider, user.toLowerCase(), '.cache.json');
}

function readCacheMeta(dir: string, provider: string, user: string): CacheMeta {
  try {
    const parsed = JSON.parse(readFileSync(metaPath(dir, provider, user), 'utf-8')) as CacheMeta;
    return { months: parsed.months ?? {} };
  } catch {
    return { months: {} };
  }
}

function writeCacheMeta(dir: string, provider: string, user: string, meta: CacheMeta): void {
  mkdirSync(resolve(dir, provider, user.toLowerCase()), { recursive: true });
  writeAtomic(metaPath(dir, provider, user), `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * Fetch one month from chess.com into the on-disk cache.
 *
 * Conditionally, once we have it. The month anyone looks at most is the
 * one they are still playing in — and that was the single month the cache
 * did nothing for: it was refetched whole on every visit, because it might
 * have grown since. chess.com dates its archives and honours
 * `If-Modified-Since`, so the usual answer is now 304 and a couple of
 * headers: the games are already here, and nothing is downloaded, written
 * or re-parsed until the player has actually played.
 */
async function cacheMonth(dir: string, user: string, month: string): Promise<void> {
  const [year, mm] = month.split('-');
  const path = monthPath(dir, user, month);
  const meta = readCacheMeta(dir, 'chesscom', user);
  const known = existsSync(path) ? meta.months[month]?.lastModified : undefined;

  const res = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/${year}/${mm}`,
    {
      headers: { ...FETCH_HEADERS, ...(known ? { 'If-Modified-Since': known } : {}) },
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (res.status === 304) {
    meta.months[month] = { ...meta.months[month], fetchedAt: Date.now() };
    writeCacheMeta(dir, 'chesscom', user, meta);
    return;
  }
  if (!res.ok) throw new Error(`chess.com replied ${res.status}`);

  const body = (await res.json()) as { games: { pgn?: string }[] };
  const pgns = body.games.map((g) => g.pgn).filter((p): p is string => Boolean(p));
  mkdirSync(resolve(dir, 'chesscom', user.toLowerCase()), { recursive: true });
  // Atomically: a month truncated mid-write would then be KEPT — the meta
  // remembers Last-Modified, so the next visit 304s and trusts the file.
  writeAtomic(path, pgns.length > 0 ? `${pgns.join('\n\n')}\n` : '');
  meta.months[month] = {
    lastModified: res.headers.get('last-modified') ?? undefined,
    fetchedAt: Date.now(),
  };
  writeCacheMeta(dir, 'chesscom', user, meta);
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
  writeAtomic(bookmarksPath(dir), `${JSON.stringify({ keys: [...keys].sort() }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------

export function gamesApi(dir: string = VAULT_GAMES, configPath: string = VAULT_CONFIG): Hono {
  const collectionDir = resolve(dir, 'collection');
  mkdirSync(collectionDir, { recursive: true });
  const api = new Hono();

  /** The handle the vault owner claimed for a provider, lowercased —
      read per request so a profile edit needs no restart. */
  const profileUser = (provider: 'chesscom' | 'lichess'): string | null => {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        profile?: { chesscom?: string; lichess?: string };
      };
      return config.profile?.[provider]?.trim().toLowerCase() || null;
    } catch {
      return null;
    }
  };

  /**
   * Heal VaultSide across the kept games, once per boot.
   *
   * Old files carry two historic wrongs: only chess.com collects were
   * ever stamped, so your own Lichess games sit here with no side —
   * and stamping trusted the archive path alone, so games kept from
   * ANYONE's archive wear that player's seat as if it were yours. The
   * profile defines whose vault this is, so each game is re-derived
   * from it: a player matching a profile handle sets the side, and a
   * stamp on a game that provably came from an online archive (its
   * Site or Link says so) but matches nobody is removed. Anything
   * else keeps its stamp — a hand-imported game states its side
   * outright, and that word is not ours to take back. With no profile
   * there is nothing to derive from, and nothing is touched.
   *
   * Runs at boot and again whenever config.json has changed since —
   * checked on each collection listing, so claiming your username in
   * Settings makes the Games page honest without a restart.
   */
  let healedForMtime = -2;
  const healVaultSides = (): void => {
    let mtime = -1;
    try {
      mtime = statSync(configPath).mtimeMs;
    } catch {
      // No config yet: nothing to derive from.
    }
    if (mtime === healedForMtime) return;
    healedForMtime = mtime;
    const handles = (['chesscom', 'lichess'] as const)
      .map(profileUser)
      .filter((h): h is string => h !== null);
    if (handles.length === 0) return;
    for (const f of readdirSync(collectionDir)) {
      if (!f.endsWith('.pgn')) continue;
      const path = resolve(collectionDir, f);
      try {
        let dirty = false;
        const healed = parseGames(path).map((source) => {
          const headers = new Map(source.headers);
          const white = (headers.get('White') ?? '').toLowerCase();
          const black = (headers.get('Black') ?? '').toLowerCase();
          const mine = handles.includes(white) ? 'white' : handles.includes(black) ? 'black' : null;
          const current = headers.get('VaultSide');
          const site = headers.get('Site') ?? '';
          const fromArchive =
            site === 'Chess.com' || site.startsWith('https://lichess.org') || headers.has('Link');
          if (mine !== null && current !== mine) headers.set('VaultSide', mine);
          else if (mine === null && current && fromArchive) headers.delete('VaultSide');
          else return source;
          dirty = true;
          return { ...source, headers };
        });
        if (dirty) writeAtomic(path, healed.map((g) => makePgn(g)).join('\n'));
      } catch {
        // A file that cannot be parsed is not one to rewrite.
      }
    }
  };
  healVaultSides();

  /** The collection: one game per file, newest date first. */
  api.get('/games', (c) => {
    // A profile edit since the last look re-derives the stamps first,
    // so the sides this list reports are the profile's own truth.
    healVaultSides();
    const games = readdirSync(collectionDir)
      .filter((f) => f.endsWith('.pgn'))
      .flatMap((f) => parseFileSummaries(dir, resolve(collectionDir, f)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file));
    return c.json({ total: games.length, games });
  });

  /** Months available for a user: remote archive list merged with the cache. */
  /**
   * The newest month's games, alongside the list that names it.
   *
   * Browsing an archive was two round trips before a single game
   * appeared: the list says which months exist, and only then can a month
   * be asked for. The second request is not optional — it names a month
   * only the first can supply — so the only place to remove it is here,
   * where the two are one machine apart instead of a phone's link apart.
   *
   * Asked for through the app's own month route rather than by repeating
   * it. That route is where the caching lives — a disk copy, chess.com's
   * if-modified-since, lichess's incremental since-window, and the rule
   * that the current month is never trusted as final — and a second
   * implementation of any of that would be a second thing to keep true.
   * A sub-request costs one Request object and cannot drift.
   *
   * Best-effort by construction: a month that fails to load answers null
   * and the client asks for it the old way. Nothing here is allowed to
   * cost the list itself.
   */
  const newestMonth = async (
    base: 'archive' | 'lichess',
    user: string,
    month: string | undefined,
  ): Promise<{ month: string; games: unknown[] } | null> => {
    if (!month) return null;
    try {
      const res = await api.request(
        `/games/${base}/month?user=${encodeURIComponent(user)}&month=${month}`,
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { games?: unknown[] };
      return Array.isArray(body.games) ? { month, games: body.games } : null;
    } catch {
      return null;
    }
  };

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
    let noSuchPlayer = false;
    try {
      const body = await fetchJson<{ archives: string[] }>(
        `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`,
      );
      remote = body.archives.map((url) => url.split('/').slice(-2).join('-'));
    } catch (error) {
      // A 404 is an answer, not a failure to get one. Folding it into
      // "offline" is what made a misspelt handle look like a working
      // search of an empty archive: no error, no months, and a panel
      // showing the same "nothing browsed yet" prompt it shows before you
      // have typed anything.
      if (error instanceof UpstreamError && error.status === 404) noSuchPlayer = true;
      else offline = true; // cached months still browse fine
    }
    if (noSuchPlayer && cachedMonths.size === 0) {
      return c.json({ error: `chess.com has no player called "${user}"` }, 404);
    }

    // How many games this player has EVER played — the archive list says
    // which months exist but not what they hold, and only fetched months
    // are counted locally. The stats endpoint's per-mode win/loss/draw
    // records sum to the lifetime figure; a mode with no `record` (tactics,
    // puzzle rush) is not a game. Best-effort: null when unreachable.
    let total: number | null = null;
    if (!offline) {
      try {
        const stats = await fetchJson<Record<string, { record?: { win?: number; loss?: number; draw?: number } }>>(
          `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/stats`,
        );
        total = Object.values(stats).reduce((sum, mode) => {
          const r = mode?.record;
          return r ? sum + (r.win ?? 0) + (r.loss ?? 0) + (r.draw ?? 0) : sum;
        }, 0);
      } catch {
        /* the months still browse; the label falls back to cached counts */
      }
    }

    const all = [...new Set([...remote, ...cachedMonths.keys()])].sort().reverse();
    return c.json({
      offline,
      total,
      newest: await newestMonth('archive', user, all[0]),
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
  /**
   * Add games from an archive file to the collection.
   *
   * One game (`index`), several (`indexes`), or the lot (`all`). The file is
   * parsed ONCE regardless — it is a whole month, and parsing it per game
   * turned adding fifty games into fifty parses of the same text.
   */
  api.post('/games/collect', async (c) => {
    const body = await c.req
      .json<{ file?: string; index?: number; indexes?: number[]; all?: boolean }>()
      .catch(() => null);
    if (!body?.file) return c.json({ error: 'need file' }, 400);

    const path = safeResolve(dir, body.file);
    if (!path || !existsSync(path)) return c.json({ error: 'no such file' }, 404);

    const games = parseGames(path);

    let wanted: number[];
    if (body.all) wanted = games.map((_, i) => i);
    else if (Array.isArray(body.indexes)) wanted = body.indexes;
    else if (Number.isInteger(body.index)) wanted = [body.index!];
    else return c.json({ error: 'need index, indexes or all' }, 400);

    if (!wanted.length) return c.json({ error: 'no games chosen' }, 400);
    if (wanted.some((i) => !Number.isInteger(i) || i < 0 || i >= games.length)) {
      return c.json({ error: 'index out of range' }, 400);
    }

    // Which side the vault OWNER played. The path only names whose
    // archive this is; the profile says who the owner is. The two must
    // agree before a side is stamped — anyone else's archive (the
    // browser searches any handle) is kept as reference games, or the
    // collection's "mine" filters would claim games that are not. Used
    // to stamp from the path alone, and only for chess.com paths, so a
    // Lichess game of your own carried no side at all.
    const archiveUser = pathUser(body.file);
    const provider = body.file.startsWith('lichess/') ? ('lichess' as const) : ('chesscom' as const);
    const owner = archiveUser !== null && archiveUser === profileUser(provider) ? archiveUser : null;

    const ids: string[] = [];
    for (const index of wanted) {
      // Copied headers: parseGames now serves a shared cached object, and
      // stamping VaultSide onto it would leak into every later export of
      // the same archive game.
      const source = games[index]!;
      const game = { ...source, headers: new Map(source.headers) };
      const white = (game.headers.get('White') ?? '').toLowerCase();
      const black = (game.headers.get('Black') ?? '').toLowerCase();
      if (owner === white) game.headers.set('VaultSide', 'white');
      else if (owner === black) game.headers.set('VaultSide', 'black');
      ids.push(addToCollection(game));
    }

    return c.json({ id: ids[0], ids, added: ids.length });
  });

  /** The default document name for a game: "White vs Black YYYY-MM-DD". */
  function collectionBaseName(game: Game<PgnNodeData>): string {
    const date = (game.headers.get('UTCDate') ?? game.headers.get('Date') ?? '').replaceAll('.', '-');
    // sanitizeSegment, not a strip-to-ASCII: player names are names, and
    // dropping every non-Latin character left "  vs   2026-01-01" for two
    // Korean players. The browser rebuilds this exact string to tell an
    // auto name from a chosen one, so both call the shared rule.
    return sanitizeSegment(
      `${game.headers.get('White') ?? '?'} vs ${game.headers.get('Black') ?? '?'} ${date}`,
      'Game',
    );
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
    // Collected via array: TS cannot narrow a closure-assigned variable.
    const parsed: Game<PgnNodeData>[] = [];
    const parser = new PgnParser((g, err) => {
      if (!err && parsed.length === 0) parsed.push(g);
    });
    parser.parse(body.pgn);
    const game = parsed[0];
    if (!game) return c.json({ error: 'that PGN could not be read' }, 400);
    // A result the moves themselves prove (mate, stalemate) fills in when
    // the paste carries none. Resignations are NOT in the moves — those
    // still need the token or the picker.
    const declared = game.headers.get('Result');
    if (!declared || declared === '*') {
      const pos = Chess.default();
      let legal = true;
      for (const data of game.moves.mainline()) {
        const move = parseSan(pos, data.san);
        if (!move) {
          legal = false;
          break;
        }
        pos.play(move);
      }
      if (legal) {
        if (pos.isCheckmate()) game.headers.set('Result', pos.turn === 'white' ? '0-1' : '1-0');
        else if (pos.isStalemate() || pos.isInsufficientMaterial()) game.headers.set('Result', '1/2-1/2');
      }
    }
    // Same players + same date = same game: a reference game must not pile
    // up copies (unlike /collect, whose client already dedupes by key).
    if (existsSync(resolve(collectionDir, `${collectionBaseName(game)}.pgn`))) {
      return c.json({ error: 'already in the collection' }, 409);
    }
    return c.json({ id: addToCollection(game) });
  });

  // --- Lichess archive: the public API needs no auth. Months derive from
  // the account's creation date; a fetched month caches exactly like a
  // chess.com month, at vault/games/lichess/<user>/<YYYY-MM>.pgn.
  api.get('/games/lichess/months', async (c) => {
    const user = c.req.query('user')?.trim().toLowerCase();
    if (!user || !USER_RE.test(user)) return c.json({ error: 'invalid username' }, 400);
    const userDir = resolve(dir, 'lichess', user);
    const cachedMonths = new Map<string, number>();
    if (existsSync(userDir)) {
      for (const file of readdirSync(userDir)) {
        if (file.endsWith('.pgn')) {
          cachedMonths.set(file.slice(0, -4), parseFileSummaries(dir, resolve(userDir, file)).length);
        }
      }
    }
    try {
      const profile = await fetchJson<{ createdAt: number; count?: { all?: number } }>(
        `https://lichess.org/api/user/${encodeURIComponent(user)}`,
      );
      const first = new Date(profile.createdAt);
      const months: { month: string; cached: boolean; games: number | null }[] = [];
      const now = new Date();
      let y = now.getUTCFullYear();
      let m = now.getUTCMonth();
      while (months.length < 240) {
        const month = `${y}-${String(m + 1).padStart(2, '0')}`;
        months.push({ month, cached: cachedMonths.has(month), games: cachedMonths.get(month) ?? null });
        if (y === first.getUTCFullYear() && m === first.getUTCMonth()) break;
        m -= 1;
        if (m < 0) {
          m = 11;
          y -= 1;
        }
      }
      // The profile already carries the lifetime figure — count.all.
      return c.json({
        offline: false,
        total: profile.count?.all ?? null,
        newest: await newestMonth('lichess', user, months[0]?.month),
        months,
      });
    } catch (error) {
      // Same distinction as the chess.com side: lichess answering 404 is
      // lichess telling you the handle does not exist.
      if (error instanceof UpstreamError && error.status === 404 && cachedMonths.size === 0) {
        return c.json({ error: `lichess has no player called "${user}"` }, 404);
      }
      if (cachedMonths.size === 0) return c.json({ error: 'lichess unreachable and nothing cached yet' }, 502);
      const months = [...cachedMonths.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([month, games]) => ({ month, cached: true, games }));
      return c.json({
        offline: true,
        total: null,
        newest: await newestMonth('lichess', user, months[0]?.month),
        months,
      });
    }
  });

  api.get('/games/lichess/month', async (c) => {
    const user = c.req.query('user')?.trim().toLowerCase();
    const month = c.req.query('month') ?? '';
    if (!user || !USER_RE.test(user)) return c.json({ error: 'invalid username' }, 400);
    if (!MONTH_RE.test(month)) return c.json({ error: 'invalid month' }, 400);
    const path = resolve(dir, 'lichess', user, `${month}.pgn`);
    const cached = existsSync(path);
    const meta = readCacheMeta(dir, 'lichess', user);
    const [y, m] = month.split('-').map(Number) as [number, number];
    const monthStart = Date.UTC(y, m - 1, 1);
    const until = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
    // A month that has ended cannot gain games; the one being played in
    // can, and it is the one anybody looks at. Cached, it used to be
    // frozen — a game finished five minutes ago was simply not there
    // until the file was deleted by hand.
    const live = Date.now() < until;

    if (!cached || live) {
      // Everything, first time round; only what has happened since the
      // last look, after that. `since` is what makes a repeat visit to
      // this month one small response instead of three hundred games.
      const since = cached ? (meta.months[month]?.fetchedAt ?? monthStart) : monthStart;
      try {
        const res = await fetch(
          `https://lichess.org/api/games/user/${encodeURIComponent(user)}?since=${since}&until=${until}&max=300&moves=true&tags=true`,
          {
            headers: { ...FETCH_HEADERS, Accept: 'application/x-chess-pgn' },
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!res.ok) {
          if (!cached) return c.json({ error: `lichess replied ${res.status}` }, 502);
        } else {
          const fetched = await res.text();
          mkdirSync(resolve(dir, 'lichess', user), { recursive: true });
          if (!cached) {
            writeFileSync(path, fetched);
          } else if (fetched.trim()) {
            // Newest first, as lichess sends them — so new games go on
            // the front. `since` is a boundary rather than a cursor, so
            // the game that straddles it comes back twice; its own URL,
            // which is already in the file, is what says so.
            const have = readFileSync(path, 'utf-8');
            const fresh = fetched
              .split(/\n\n(?=\[Event )/)
              .filter((game) => {
                const site = /\[Site "([^"]+)"\]/.exec(game)?.[1];
                return game.trim() && (!site || !have.includes(site));
              });
            if (fresh.length) writeFileSync(path, `${fresh.join('\n\n')}\n\n${have}`);
          }
          meta.months[month] = { fetchedAt: Date.now() };
          writeCacheMeta(dir, 'lichess', user, meta);
        }
      } catch {
        // Offline with a copy on disk is still a browsable month.
        if (!cached) return c.json({ error: 'lichess unreachable' }, 502);
      }
    }
    return c.json({ games: parseFileSummaries(dir, path) });
  });

  /**
   * What browsing has left on disk, per player.
   *
   * Every month anyone looks at is kept as a PGN file so it browses
   * offline afterwards, and nothing has ever removed one. Browse a dozen
   * players out of curiosity and the vault quietly holds a dozen players'
   * whole histories — none of which is in the collection, and none of
   * which the app admitted to storing. Bytes and months, cheap to
   * produce: a size is a stat per file, whereas a game count would be a
   * parse of every one of them.
   */
  api.get('/games/cache', (c) => {
    const users: { provider: string; user: string; months: number; bytes: number }[] = [];
    for (const provider of ['chesscom', 'lichess'] as const) {
      const providerDir = resolve(dir, provider);
      if (!existsSync(providerDir)) continue;
      for (const user of readdirSync(providerDir)) {
        const userDir = resolve(providerDir, user);
        if (!statSync(userDir).isDirectory()) continue;
        const files = readdirSync(userDir).filter((f) => f.endsWith('.pgn'));
        if (!files.length) continue;
        users.push({
          provider,
          user,
          months: files.length,
          bytes: files.reduce((sum, f) => sum + statSync(resolve(userDir, f)).size, 0),
        });
      }
    }
    users.sort((a, b) => b.bytes - a.bytes || a.user.localeCompare(b.user));
    return c.json({ bytes: users.reduce((sum, u) => sum + u.bytes, 0), users });
  });

  /**
   * Drop the whole browsing cache.
   *
   * All of it, not one player at a time: this is housekeeping, and a list
   * of players each with its own button asked whose history to keep — a
   * question nobody has, about data that costs one fetch to get back.
   *
   * Safe by construction: it only ever removes months that can be fetched
   * again, and the collection is a different directory altogether — a
   * game someone kept was COPIED into it, so clearing the cache cannot
   * take anything that was chosen.
   */
  api.delete('/games/cache', (c) => {
    let bytes = 0;
    for (const provider of ['chesscom', 'lichess']) {
      const providerDir = resolve(dir, provider);
      if (!existsSync(providerDir)) continue;
      for (const user of readdirSync(providerDir)) {
        const userDir = resolve(providerDir, user);
        if (!statSync(userDir).isDirectory()) continue;
        for (const f of readdirSync(userDir)) {
          if (f.endsWith('.pgn')) bytes += statSync(resolve(userDir, f)).size;
        }
        rmSync(userDir, { recursive: true, force: true });
      }
    }
    return c.json({ bytes });
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
