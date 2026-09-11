/**
 * The tablebase's answer, and the shaping of one from upstream's words.
 *
 * Its own module so the native prober can import the contract without
 * importing the route: tablebase.ts imports the prober, and the prober
 * importing tablebase.ts back was the one cycle in server/. It worked
 * only because both uses were at call time.
 */

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
