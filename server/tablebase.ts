import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import { DATA } from './paths.ts';

/**
 * Proxy for the Lichess Syzygy tablebase (tablebase.lichess.ovh).
 *
 * Everything about this cache is simpler than the explorer's because the
 * data cannot change: a tablebase verdict is a proof, so entries never
 * expire and a hit never needs revalidating. No token either — the
 * endpoint is public.
 *
 * The halfmove clock is part of the cache key on purpose: with the
 * 50-move rule in play the same piece arrangement can be a win at clock 0
 * and a draw at clock 80, and the API's category says so.
 */

const TB_HOST = 'https://tablebase.lichess.ovh';
const CACHE_DIR = resolve(DATA, 'tablebase-cache');
/** Syzygy covers up to 7 men; more is not an error, just not answerable. */
const MAX_MEN = 7;
/** Lines one request will build, however many the caller asks for. */
const MAX_LINES = 5;

export interface TbMove {
  uci: string;
  san: string;
  /** Category from the point of view of the side to move AFTER this move. */
  category: string;
  dtz: number | null;
  dtm: number | null;
  /** The move IS mate. Measured: such a move reports dtm null, not 0. */
  checkmate: boolean;
}

export interface TbResult {
  /** win / draw / loss / cursed-win / blessed-loss / maybe-* / unknown, side-to-move POV. */
  category: string;
  dtz: number | null;
  /** Distance to mate in plies, when the 5-man DTM tables cover it. */
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  /** Every legal move, best first (the API's own order). */
  moves: TbMove[];
}

interface UpstreamMove {
  uci: string;
  san: string;
  category: string;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
}

interface Upstream {
  category: string;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficient_material: boolean;
  moves: UpstreamMove[];
}

/** Slim the upstream payload to what the client renders. */
function normalize(body: Upstream): TbResult {
  return {
    category: body.category,
    dtz: body.dtz,
    dtm: body.dtm,
    checkmate: body.checkmate,
    stalemate: body.stalemate,
    insufficientMaterial: body.insufficient_material,
    moves: (body.moves ?? []).map((m) => ({
      uci: m.uci,
      san: m.san,
      category: m.category,
      dtz: m.dtz,
      dtm: m.dtm,
      checkmate: m.checkmate ?? false,
    })),
  };
}

/**
 * Plies one line may run to.
 *
 * A PV row shows a single line of text and only opens up on hover, so
 * twenty plies is already more than it can display - and on a cold ending
 * every ply past it is another upstream request. The first draft capped at
 * 40 and spent them: walking two lines of one position rate-limited the
 * API, and the position asked for next came back unreachable.
 */
const PLY_CAP = 20;
/**
 * Upstream lookups a single /lines request may spend. Cached positions are
 * free and do not count: an ending costs this once, and every position it
 * walked through is a permanent hit afterwards.
 */
const LOOKUP_BUDGET = 60;

/** What is left to spend, and whether upstream has told us to stop. */
interface Budget {
  left: number;
  halted: boolean;
}

const cachePath = (dir: string, fen: string): string => {
  // Position + halfmove clock is the whole identity; the fullmove number
  // is display-only and would only fragment the cache.
  const fields = fen.trim().split(/\s+/);
  const key = createHash('sha256')
    // v2 carries each move's `checkmate`. A v1 entry cannot be upgraded in
    // place: without that flag a mating move and a move into 7-man
    // territory are indistinguishable, so old files are left behind rather
    // than half-trusted. They are a cache; deleting the directory is free.
    .update('v2')
    .update(`${fields.slice(0, 4).join(' ')}\n${fields[4] ?? '0'}`)
    .digest('hex')
    .slice(0, 32);
  return resolve(dir, `${key}.json`);
};

/** One position, from the cache if it is there. Proofs don't age. */
async function probe(
  dir: string,
  fen: string,
  fetcher: typeof fetch,
  budget: Budget,
): Promise<TbResult | null> {
  const path = cachePath(dir, fen);
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as TbResult;
  } catch {
    // Not cached yet.
  }
  if (budget.halted || budget.left-- <= 0) return null;
  try {
    const res = await fetcher(`${TB_HOST}/standard?fen=${encodeURIComponent(fen)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    // Being throttled is not this position's failure, it is the next
    // twenty's: stop asking, and let the caller keep what it already has.
    if (res.status === 429) budget.halted = true;
    if (!res.ok) return null;
    const body = normalize((await res.json()) as Upstream);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(body));
    return body;
  } catch {
    return null;
  }
}

const baseCategory = (category: string): string => category.replace('maybe-', '');

/**
 * Plies to mate after a move, or null where there is no mate to measure.
 *
 * The checkmating move is the whole reason this is not just `abs(dtm)`.
 * Measured against the API: `Qc8# cat=loss dtz=-1 dtm=null` — mate reports
 * NO dtm, while dtm 0 turns up on DRAWN moves instead. Reading null as
 * "no mate here" therefore threw away the one move that ends the game, and
 * the walk could never finish: it maneuvered until it hit the ply cap, on
 * a mate in eight.
 */
function pliesAfter(move: TbMove): number | null {
  if (move.checkmate) return 0;
  const category = baseCategory(move.category);
  if (category !== 'win' && category !== 'loss') return null;
  if (move.dtm === null || move.dtm === 0) return null;
  return Math.abs(move.dtm);
}

/**
 * Mate in N for the side to move at the PARENT, read off one of its moves.
 *
 * Two inversions live here and both are load-bearing. A move's category is
 * the verdict on whoever moves AFTER it, so the winning move is the one
 * labelled `loss`. And its dtm counts from that later position, so the
 * parent is one ply further out: measured against the API, a root at
 * dtm 27 has its best move at dtm -26, and ceil((26+1)/2) is the 14 the
 * root itself reports.
 *
 * Null whenever there is no mate to measure - a draw, or dtm 0, which the
 * API really does return on drawn moves beside siblings that say null.
 */
function mateAfter(move: TbMove): number | null {
  const plies = pliesAfter(move);
  if (plies === null) return null;
  const moves = Math.ceil((plies + 1) / 2);
  const category = baseCategory(move.category);
  if (category === 'loss') return moves;
  if (category === 'win') return -moves;
  return null;
}

/**
 * What the side to move should play, following DTM rather than DTZ.
 *
 * Compared in PLIES, not in the mate count shown on screen: rounding to
 * moves first makes 26 and 27 plies the same number, and a walk that
 * cannot tell them apart stops converging - the first version shuffled a
 * rook for forty plies on a mate in fourteen.
 */
function bestChild(moves: TbMove[]): TbMove | null {
  const winning = moves.filter((m) => baseCategory(m.category) === 'loss' && pliesAfter(m) !== null);
  if (winning.length > 0) {
    // Mate soonest.
    return winning.reduce((a, b) => (pliesAfter(a)! <= pliesAfter(b)! ? a : b));
  }
  const losing = moves.filter((m) => baseCategory(m.category) === 'win' && pliesAfter(m) !== null);
  if (losing.length > 0) {
    // Lost anyway: last as long as possible.
    return losing.reduce((a, b) => (pliesAfter(a)! >= pliesAfter(b)! ? a : b));
  }
  return null;
}

function applyUci(fen: string, uci: string): string | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const position = Chess.fromSetup(setup.unwrap());
  if (position.isErr) return null;
  const move = parseUci(uci);
  if (!move) return null;
  const pos = position.unwrap();
  if (!pos.isLegal(move)) return null;
  pos.play(move);
  return makeFen(pos.toSetup());
}

/**
 * Follow the mate from one first move, a ply at a time. There is no way to
 * ask for a line: the tablebase answers about one position, so a line is
 * that answer applied and asked again.
 */
async function walkLine(
  dir: string,
  fen: string,
  first: TbMove,
  fetcher: typeof fetch,
  budget: Budget,
): Promise<string[]> {
  const uci = [first.uci];
  let position = applyUci(fen, first.uci);
  while (position && uci.length < PLY_CAP) {
    const result = await probe(dir, position, fetcher, budget);
    if (!result || result.checkmate || result.stalemate) break;
    const next = bestChild(result.moves);
    if (!next) break;
    uci.push(next.uci);
    position = applyUci(position, next.uci);
  }
  return uci;
}

export function tablebaseApi(fetcher: typeof fetch = fetch, cacheDir: string = CACHE_DIR): Hono {
  const api = new Hono();

  /** Validate and canonicalise before anything leaves this process. */
  const check = (fen: string | undefined): { fen: string } | { error: string } => {
    if (!fen) return { error: 'missing ?fen=' };
    const setup = parseFen(fen);
    if (setup.isErr) return { error: 'invalid FEN' };
    const parsed = setup.unwrap();
    if (Chess.fromSetup(parsed).isErr) return { error: 'invalid position' };
    if (parsed.board.occupied.size() > MAX_MEN) {
      return { error: 'tablebases cover at most 7 men' };
    }
    // Syzygy has no castling: a position that still may castle has no entry.
    if (parsed.castlingRights.nonEmpty()) {
      return { error: 'tablebases assume no castling rights' };
    }
    return { fen };
  };

  const unreachable = {
    error: 'tablebase unreachable and this position is not cached',
    offline: true,
  };

  api.get('/tablebase', async (c) => {
    const checked = check(c.req.query('fen'));
    if ('error' in checked) return c.json(checked, 400);
    const result = await probe(cacheDir, checked.fen, fetcher, { left: 1, halted: false });
    return result ? c.json(result) : c.json(unreachable, 502);
  });

  /**
   * The same proof, shaped like an engine's answer: a mate score and a
   * line, per move, best first.
   *
   * Only moves that share the ROOT's verdict are offered. Ranking every
   * move that has a DTM sounded right and was not: in a won position whose
   * other moves draw, the draws have no DTM to be ranked by, so the
   * runner-up came out as a move that LOSES - presented as the second best
   * thing to play, above the drawing move it is worse than. A won position
   * offers its winning moves and nothing else, and where that leaves one
   * line, one line is the truth.
   *
   * Positions with no DTM at all - 7-man wins, and every draw - return no
   * lines, and the caller keeps the engine's own, which is the better
   * answer there anyway.
   */
  api.get('/tablebase/lines', async (c) => {
    const checked = check(c.req.query('fen'));
    if ('error' in checked) return c.json(checked, 400);
    const asked = Number(c.req.query('lines') ?? '1');
    const want = Math.min(Math.max(Number.isFinite(asked) ? asked : 1, 1), MAX_LINES);

    const budget: Budget = { left: LOOKUP_BUDGET, halted: false };
    const root = await probe(cacheDir, checked.fen, fetcher, budget);
    if (!root) return c.json(unreachable, 502);

    const verdict = baseCategory(root.category);
    if (verdict !== 'win' && verdict !== 'loss') return c.json({ lines: [] });
    const sign = verdict === 'win' ? 1 : -1;

    const ranked = root.moves
      .map((move) => ({ move, mate: mateAfter(move) }))
      .filter((entry): entry is { move: TbMove; mate: number } => entry.mate !== null)
      .filter((entry) => Math.sign(entry.mate) === sign)
      // Winning: soonest mate first. Losing: longest resistance first,
      // which is the most negative. Both are ascending by the number.
      .sort((a, b) => a.mate - b.mate)
      .slice(0, want);

    // Sequentially, not in parallel: two lines at once is what tripped the
    // rate limiter, and the second line mostly walks positions the first
    // has already put in the cache.
    const lines = [];
    for (const [i, { move, mate }] of ranked.entries()) {
      const uci = await walkLine(cacheDir, checked.fen, move, fetcher, budget);
      lines.push({
        multipv: i + 1,
        // A proof has no depth; the line's own length is the honest number
        // to put where the engine puts one, and it is exact.
        depth: uci.length,
        mate,
        moves: uci,
      });
    }

    return c.json({ lines });
  });

  return api;
}
