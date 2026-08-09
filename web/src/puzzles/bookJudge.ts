import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { hashSetup } from '@shared/zobrist';

/**
 * Judgment for book puzzles, where the solver enters BOTH sides' moves and
 * the book recorded exactly one line. Fairness tiers (lanph3re's design):
 *
 *  1. any checkmate completes the puzzle;
 *  2. wildcard defender plies ("K~" in books): any legal move is accepted;
 *  3. transpositions: a move is right if its RESULTING position is one the
 *     book line passes through. This is sound against unsound move orders
 *     (lanph3re's concern): acceptance is per-move, so every position on the
 *     actual board is author-verified — a wrong-order move necessarily
 *     produces an off-book position and is rejected before a cooperative
 *     defence could launder it. The script cursor REBASES to the matched
 *     depth so deep jumps stay aligned.
 *  4. what the book text can't settle — an off-book move at the final ply,
 *     or a scripted move made unreachable by a wildcard divergence — gets
 *     an 'engine' verdict; the caller adjudicates decisiveness (the engine
 *     evaluates the position AFTER the move, i.e. against best defence).
 */

export interface BookSolution {
  fen: string;
  uci: string[];
  /** Ply indices where any legal move is accepted (defender don't-cares). */
  wildcards?: number[];
}

export interface PlayedMove {
  uci: string;
  san: string;
  /** FEN after this move. */
  fen: string;
}

export type BookVerdict =
  | { kind: 'correct'; move: PlayedMove; cursor: number }
  | { kind: 'complete'; move: PlayedMove; cursor: number }
  | { kind: 'wrong'; move: PlayedMove }
  | { kind: 'engine'; move: PlayedMove; cursor: number };

/** Zobrist hashes of every position along the scripted line (0..n plies).
    Cached per solution object: grading calls judgeBookMove once per entered
    ply, and replaying the whole script each time made grading O(n^2). */
const hashCache = new WeakMap<BookSolution, bigint[]>();
function scriptedHashes(solution: BookSolution): bigint[] {
  const hit = hashCache.get(solution);
  if (hit) return hit;
  const pos = Chess.fromSetup(parseFen(solution.fen).unwrap()).unwrap();
  const hashes = [hashSetup(pos.toSetup())];
  for (const uci of solution.uci) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break; // divergence-proof
    pos.play(move);
    hashes.push(hashSetup(pos.toSetup()));
  }
  hashCache.set(solution, hashes);
  return hashes;
}

/**
 * Judge the next entered move.
 *
 * `currentFen` is the position actually on the board and `cursor` is how
 * deep into the script the solver notionally is (they differ from the
 * script only after wildcard divergences). Returned cursors point at the
 * NEXT expected scripted ply.
 */
export function judgeBookMove(
  solution: BookSolution,
  currentFen: string,
  cursor: number,
  orig: string,
  dest: string,
  promotion?: string,
): BookVerdict {
  const pos = Chess.fromSetup(parseFen(currentFen).unwrap()).unwrap();
  const uci = orig + dest + (promotion ?? '');
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) {
    return { kind: 'wrong', move: { uci, san: '?', fen: currentFen } };
  }

  const san = makeSanAndPlay(pos, move);
  const after: PlayedMove = { uci, san, fen: makeFen(pos.toSetup()) };
  const total = solution.uci.length;
  const isLast = cursor >= total - 1;

  // Any mate completes the puzzle, book move or not.
  if (pos.isCheckmate()) return { kind: 'complete', move: after, cursor: total };

  // Wildcard ply: the book says this move doesn't matter.
  if (solution.wildcards?.includes(cursor)) {
    return { kind: isLast ? 'complete' : 'correct', move: after, cursor: cursor + 1 };
  }

  // The scripted move is always right — stated explicitly (not only via
  // the hash compare below) because after a wildcard divergence the same
  // scripted move reaches a DIFFERENT position, yet the author asserted
  // the continuation is universal.
  if (uci === solution.uci[cursor]) {
    return { kind: isLast ? 'complete' : 'correct', move: after, cursor: cursor + 1 };
  }

  // Transposition — deliberately narrow (lanph3re's concern about move orders
  // that dodge the line): only a SAME-depth match (identical resulting
  // position, identical remaining script — no intermediate position ever
  // existed where the defender could have deviated) or a direct hit on
  // the FINAL position. Deeper mid-line jumps would skip solver tasks and
  // fall through to the engine/wrong paths instead.
  const hashes = scriptedHashes(solution);
  const reached = hashSetup(pos.toSetup());
  if (hashes[cursor + 1] === reached) {
    return { kind: isLast ? 'complete' : 'correct', move: after, cursor: cursor + 1 };
  }
  if (hashes.length === total + 1 && hashes[total] === reached) {
    return { kind: 'complete', move: after, cursor: total };
  }

  // Off the book. The final ply — and any ply whose scripted answer no
  // longer applies (wildcard divergence made it illegal) — goes to the
  // engine; everything else is wrong.
  const scripted = solution.uci[cursor];
  const scriptedMove = scripted ? parseUci(scripted) : undefined;
  const scriptedLegal =
    scriptedMove !== undefined &&
    Chess.fromSetup(parseFen(currentFen).unwrap()).unwrap().isLegal(scriptedMove);
  if (isLast || !scriptedLegal) return { kind: 'engine', move: after, cursor: total };
  return { kind: 'wrong', move: after };
}
