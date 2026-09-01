import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { DATA_TABLEBASE_CACHE, VAULT_CONFIG } from './paths.ts';

/**
 * Exact endgame verdicts — what the engine's number stops being able to
 * say once the pieces run out.
 *
 * A search reports a score; a tablebase reports the truth. Under seven
 * pieces the two disagree in the way that matters: Stockfish hedges a
 * fortress at +1.2 and plays a book draw as if it were winning, where
 * the table knows the result and how far away it is.
 *
 * Answers come through a `TablebaseProbe` rather than out of `fetch`
 * here, because the source is the part expected to change. Two sources
 * exist already and are the same code: Lichess's public server (7
 * pieces, no token, and the only way to have the tables without
 * carrying 150 GB of them) and whatever `tablebaseUrl` in this vault's
 * config names — lila-tablebase is open source, so a vault with its own
 * copy of the tables runs the same server over them and is answered by
 * its own machine. The day this app reads `.rtbz` files in process, that
 * prober takes the same interface and the route, the cache and the
 * client do not move.
 *
 * Each source keeps its OWN corner of the cache, because they do not
 * hold the same tables: a five-piece server at home must not be able to
 * answer "nothing here" into the slot where the seven-piece one has
 * already said "win".
 *
 * Every answer is cached on disk FOREVER. The explorer's cache has a TTL
 * because game statistics drift daily; a tablebase result is a fact
 * about a position, so an entry can only be wrong if it was written
 * wrong. That is the offline story too: an endgame looked at once is
 * answerable on a plane.
 */

/** Syzygy stops here, and so does Lichess's server. */
export const MAX_PIECES = 7;

/**
 * A verdict from the side to move's point of view.
 *
 * `cursed-win` is a win the fifty-move rule turns into a draw, and
 * `blessed-loss` is its mirror — distinctions the tables make, kept
 * rather than flattened because they are exactly where the engine's
 * number and the truth part company. `maybe-win`/`maybe-loss` are what
 * the server says when the DTZ it holds is not precise enough to be sure
 * under that rule.
 */
export type Category =
  | 'win'
  | 'cursed-win'
  | 'maybe-win'
  | 'draw'
  | 'blessed-loss'
  | 'maybe-loss'
  | 'loss'
  | 'unknown';

export interface TablebaseMove {
  uci: string;
  san: string;
  /**
   * The verdict for the side that PLAYS this move, not for the side to
   * move in the position it reaches. Upstream reports the latter, which
   * makes a winning move read `loss`; every consumer would have to
   * invert it, so it is inverted once, here.
   */
  category: Category;
  /** Distance to zeroing from the position after the move, in plies.
      Unsigned: the sign upstream carries is the point of view this has
      already flipped. Null where the source does not know. */
  dtz: number | null;
  /** Distance to mate, same convention. Only the small tables have it. */
  dtm: number | null;
  /** The move resets the fifty-move counter — a capture or a pawn move. */
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

export interface TablebaseAnswer {
  category: Category;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  /** Best first — see rankMoves. */
  moves: TablebaseMove[];
}

/** Where an exact verdict comes from. */
export interface TablebaseProbe {
  /** What answered. Names the cache's subdirectory, so two sources that
      disagree about a position cannot overwrite each other. */
  readonly source: string;
  /** Throws where the source could not be reached, exactly as fetch
      does; null where it was reached and holds nothing for the
      position. */
  probe(fen: string): Promise<TablebaseAnswer | null>;
}

const INVERSE: Record<Category, Category> = {
  win: 'loss',
  'cursed-win': 'blessed-loss',
  'maybe-win': 'maybe-loss',
  draw: 'draw',
  'blessed-loss': 'cursed-win',
  'maybe-loss': 'maybe-win',
  loss: 'win',
  unknown: 'unknown',
};

const CATEGORIES = new Set(Object.keys(INVERSE));

const asCategory = (raw: unknown): Category =>
  typeof raw === 'string' && CATEGORIES.has(raw) ? (raw as Category) : 'unknown';

/** How good a move is, best first. Ties break on distance below. */
const RANK: Record<Category, number> = {
  win: 0,
  'maybe-win': 1,
  'cursed-win': 2,
  draw: 3,
  'blessed-loss': 4,
  'maybe-loss': 5,
  loss: 6,
  unknown: 7,
};

const LOSING = new Set<Category>(['loss', 'maybe-loss', 'blessed-loss']);

/**
 * Order the moves the way a player reads them: winning first, then the
 * wins the fifty-move rule spoils, then draws, then the losses.
 *
 * Within a winning move, shortest first — the point of a table is to
 * finish. Within a losing one, LONGEST first: nothing saves the game, so
 * the best move is the one that gives the opponent the most chances to
 * go wrong. Distance is DTM where the source has it and DTZ otherwise,
 * which is the only measure both can express; a zeroing move breaks a
 * remaining tie, since resetting the counter is what progress in a won
 * ending looks like.
 */
export function rankMoves(moves: TablebaseMove[]): TablebaseMove[] {
  const distance = (m: TablebaseMove): number => m.dtm ?? m.dtz ?? 0;
  return [...moves].sort((a, b) => {
    if (RANK[a.category] !== RANK[b.category]) return RANK[a.category] - RANK[b.category];
    if (distance(a) !== distance(b)) {
      return LOSING.has(a.category) ? distance(b) - distance(a) : distance(a) - distance(b);
    }
    return Number(b.zeroing) - Number(a.zeroing);
  });
}

/** What Lichess's tablebase server sends back. */
export interface LichessTablebaseResponse {
  category?: string;
  dtz?: number | null;
  dtm?: number | null;
  checkmate?: boolean;
  stalemate?: boolean;
  moves?: {
    uci?: string;
    san?: string;
    category?: string;
    dtz?: number | null;
    dtm?: number | null;
    zeroing?: boolean;
    checkmate?: boolean;
    stalemate?: boolean;
  }[];
}

const magnitude = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.abs(n) : null;

/** Reshape one upstream answer into the contract above. */
export function normalizeTablebase(body: LichessTablebaseResponse): TablebaseAnswer {
  const moves: TablebaseMove[] = [];
  for (const m of body.moves ?? []) {
    // A move with no uci is one nothing can be played from, and one with
    // no san is one nothing can be shown for. Neither has ever arrived;
    // both are dropped rather than rendered as a blank row.
    if (typeof m.uci !== 'string' || typeof m.san !== 'string') continue;
    moves.push({
      uci: m.uci,
      san: m.san,
      category: INVERSE[asCategory(m.category)],
      dtz: magnitude(m.dtz),
      dtm: magnitude(m.dtm),
      zeroing: m.zeroing === true,
      checkmate: m.checkmate === true,
      stalemate: m.stalemate === true,
    });
  }
  return {
    category: asCategory(body.category),
    dtz: magnitude(body.dtz),
    dtm: magnitude(body.dtm),
    checkmate: body.checkmate === true,
    stalemate: body.stalemate === true,
    moves: rankMoves(moves),
  };
}

/** Where the answers come from unless this vault says otherwise. */
export const DEFAULT_TABLEBASE = 'https://tablebase.lichess.ovh/standard';

/**
 * A configured endpoint, or null.
 *
 * Deliberately no check that the host is reachable, or public, or
 * anywhere in particular: the whole point of the setting is a server on
 * localhost or on the LAN, so an SSRF-style block on private addresses
 * would forbid exactly the case it exists for. What IS enforced is the
 * scheme — http or https, so a `file:` URL in a hand-edited config
 * cannot turn a position lookup into a file read — and a length, so the
 * cache path derived from it stays a path.
 *
 * Shared with the settings route, which validates what it is given with
 * this and nothing else: two definitions of "a usable URL" would mean a
 * value the settings page accepts and the prober silently ignores.
 */
export function normaliseTablebaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '' || text.length > 300) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // The query is the FEN this appends; anything already there would be
    // dropped, so it is refused rather than half-honoured.
    if (url.search !== '') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * What names this endpoint's corner of the cache.
 *
 * The default keeps the name it has always had, so an upgrade does not
 * strand a cache full of answers. Anything else is named for its host
 * and port, which is the part that decides WHICH tables answered — two
 * endpoints differing only in path are the same machine's, and sharing
 * a folder is right for them. Sanitised because this becomes a
 * directory name: lowercased by the URL parser already, with the colon
 * of a port and anything else unexpected reduced to a dash.
 */
export function cacheSource(url: string): string {
  if (url === DEFAULT_TABLEBASE) return 'lichess';
  try {
    return new URL(url).host.replace(/[^a-z0-9.-]/g, '-') || 'custom';
  } catch {
    return 'custom';
  }
}

/**
 * A Syzygy server speaking lila-tablebase's protocol.
 *
 * That is one implementation for both cases the app supports, because
 * they are one case: tablebase.lichess.ovh RUNS lila-tablebase, and it
 * is open source, so somebody who wants their own tables runs the same
 * server over their own files and points this at it. No token either
 * way — unlike the opening explorer, this protocol answers anonymous
 * requests.
 */
export function syzygyServer(
  url: string = DEFAULT_TABLEBASE,
  fetcher: typeof fetch = fetch,
): TablebaseProbe {
  return {
    source: cacheSource(url),
    async probe(fen: string): Promise<TablebaseAnswer | null> {
      const res = await fetcher(`${url}?fen=${encodeURIComponent(fen)}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`tablebase answered ${res.status}`);
      const answer = normalizeTablebase((await res.json()) as LichessTablebaseResponse);
      // Measured, not assumed: asked about a position past its tables the
      // server answers 200 with every legal move and `category: unknown`
      // throughout. That is this source saying it holds nothing, so it is
      // reported as nothing rather than as a screen of shrugs.
      return answer.category === 'unknown' ? null : answer;
    },
  };
}

/** The endpoint this vault is pointed at, read per request so that
    saving one in Settings takes effect without a restart — the same
    thing the explorer proxy does with its token. */
function configuredUrl(configPath: string): string {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { tablebaseUrl?: unknown };
    return normaliseTablebaseUrl(config.tablebaseUrl) ?? DEFAULT_TABLEBASE;
  } catch {
    return DEFAULT_TABLEBASE;
  }
}

/**
 * The position as both the cache key and the upstream question, or null
 * where no table can hold it.
 *
 * Not an EPD, which is what the explorer keys on: the halfmove clock is
 * part of a tablebase answer, because a win a hundred plies away from
 * the last capture is a draw by the fifty-move rule and the same
 * position with a fresh counter is a win. The fullmove number is not
 * part of it, so it is flattened to 1 and two positions differing only
 * there share one entry.
 *
 * Castling rights rule a position out: Syzygy tables are built without
 * them, so a position that can still castle is one no table describes.
 */
export function tablebaseFen(fen: string): string | null {
  try {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    if (pos.board.occupied.size() > MAX_PIECES) return null;
    if (pos.castles.castlingRights.nonEmpty()) return null;
    const setup = pos.toSetup();
    setup.fullmoves = 1;
    return makeFen(setup);
  } catch {
    return null;
  }
}

/** Exported for the tests, which have no network to fill the cache with. */
export function cachePath(dir: string, source: string, fen: string): string {
  const key = createHash('sha256').update(fen).digest('hex').slice(0, 32);
  return resolve(dir, source, `${key}.json`);
}

export function tablebaseApi(
  cacheDir: string = DATA_TABLEBASE_CACHE,
  /**
   * The prober, or how to pick one. A function is the normal case — the
   * endpoint is a vault setting, so it is read per request rather than
   * frozen at boot — and the tests pass a fixed prober instead.
   */
  probeSource: TablebaseProbe | (() => TablebaseProbe) = () =>
    syzygyServer(configuredUrl(VAULT_CONFIG)),
): Hono {
  const api = new Hono();
  const proberFor = (): TablebaseProbe =>
    typeof probeSource === 'function' ? probeSource() : probeSource;

  api.get('/tablebase', async (c) => {
    const prober = proberFor();
    const fen = c.req.query('fen');
    if (!fen) return c.json({ error: 'missing ?fen=' }, 400);

    const key = tablebaseFen(fen);
    if (!key) {
      // Legal and simply too big, or not a position at all — either way
      // the answer is that there is nothing here, not that the caller
      // erred by asking. The client gates on the piece count itself, so
      // this is what a direct caller of the API gets.
      return c.json({ available: false });
    }

    const path = cachePath(cacheDir, prober.source, key);
    try {
      return c.body(readFileSync(path, 'utf-8'), 200, { 'content-type': 'application/json' });
    } catch {
      // Not cached yet; ask.
    }

    try {
      const answer = await prober.probe(key);
      const body = JSON.stringify(
        answer ? { available: true, source: prober.source, ...answer } : { available: false },
      );
      mkdirSync(resolve(cacheDir, prober.source), { recursive: true });
      writeFileSync(path, body);
      return c.body(body, 200, { 'content-type': 'application/json' });
    } catch {
      return c.json(
        {
          error: 'The tablebase is unreachable and this position is not cached',
          // An outage, not a fault: the pane colours it amber and says so
          // in one line rather than taking the explorer away.
          offline: true,
        },
        502,
      );
    }
  });

  /**
   * Throw the cached answers away.
   *
   * Needed because the cache deliberately never expires, which is right
   * for a fact and wrong for a source that has LEARNED something: point
   * this vault at a server holding the five-piece tables, look at a
   * six-piece ending, and "no table holds this" is on disk for good —
   * adding the six-piece tables to that same server afterwards changes
   * nothing, because nothing asks it again. This is the way to ask
   * again, and it is in the app because a shell is not an answer
   * (CLAUDE.md).
   *
   * Everything, not just the endpoint in use: the other two reasons to
   * press it are wanting the disk back and not wanting a record of which
   * endings were studied, and neither is about one server. What it costs
   * is one request per position the next time each is looked at.
   */
  api.delete('/tablebase/cache', (c) => {
    let forgotten = 0;
    for (const source of readdirSafe(cacheDir)) {
      for (const file of readdirSafe(resolve(cacheDir, source))) {
        if (file.endsWith('.json')) forgotten += 1;
      }
    }
    // force: an already-absent cache is the state this asks for, not an
    // error; recursive: the per-source directories go with it.
    rmSync(cacheDir, { recursive: true, force: true });
    return c.json({ ok: true, forgotten });
  });

  return api;
}

const readdirSafe = (path: string): string[] => {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
};
