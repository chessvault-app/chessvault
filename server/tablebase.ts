import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { DATA_TABLEBASE_CACHE } from './paths.ts';

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
 * here, because the source is the part expected to change: today it is
 * Lichess's public Syzygy server (7 pieces, no token, and the only way
 * to have the tables without carrying 150 GB of them), and the day this
 * app probes local .rtbz files that prober implements the same interface
 * — the route, the cache and the client do not move.
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

const LICHESS_TABLEBASE = 'https://tablebase.lichess.ovh/standard';

/**
 * The public Syzygy server. No token — unlike the opening explorer, this
 * one answers anonymous requests, so nothing here reads config.json.
 */
export function lichessTablebase(fetcher: typeof fetch = fetch): TablebaseProbe {
  return {
    source: 'lichess',
    async probe(fen: string): Promise<TablebaseAnswer | null> {
      const res = await fetcher(`${LICHESS_TABLEBASE}?fen=${encodeURIComponent(fen)}`, {
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
  prober: TablebaseProbe = lichessTablebase(),
): Hono {
  const api = new Hono();

  api.get('/tablebase', async (c) => {
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

  return api;
}
