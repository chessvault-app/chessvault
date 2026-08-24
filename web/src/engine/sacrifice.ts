import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import type { Color, Role, Square } from 'chessops/types';

/**
 * Sacrifice detection for brilliancies, from the position rather than the
 * game record.
 *
 * The first version counted material two plies later, which answers "did
 * the opponent take something" — the wrong question from both sides. Any
 * quiet move followed by the opponent grabbing a DEFENDED piece read as a
 * sacrifice (the recapture lands one ply outside the window), and a
 * genuine offer the opponent declined read as nothing at all. A sacrifice
 * is a property of the position the mover created, not of what the
 * opponent chose to do about it.
 *
 * So the question asked here is: after the move, if both sides cash in
 * every capture worth taking — smallest details honoured: recaptures,
 * counter-captures, stopping while ahead — who ends up with what? That is
 * a material-only quiescence search (captures, plus every legal evasion
 * while in check, stand pat otherwise), the same shape en-croissant's
 * game report uses for its `is_sacrifice`. It settles the defended-piece
 * case (the ladder includes the recapture) and the declined-offer case
 * (the ladder takes what the opponent did not) in one mechanism, where
 * one-square static exchange evaluation would need per-case patches.
 *
 * Whether giving the material away was SOUND is not this module's
 * question — the engine's verdict on the move answers that in
 * judgeLine. This only establishes that material was genuinely offered.
 */

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const ROLES: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

/** Getting mated outweighs any pile of material. */
const MATE = 100;

/**
 * Capture ladders remove a piece per rung so they end on their own; the
 * cap only exists for check-evasion chains, which can move without
 * capturing.
 */
const MAX_PLIES = 32;

/** Static material balance, from `side`'s point of view. */
const material = (pos: Chess, side: Color): number => {
  let bal = 0;
  for (const role of ROLES) {
    bal += VALUE[role] * (pos.board.pieces(side, role).size() - pos.board.pieces(side === 'white' ? 'black' : 'white', role).size());
  }
  return bal;
};

/**
 * Material balance for the side to move once every capture worth playing
 * has been played — negamax with stand pat, captures only, all evasions
 * while in check. Alpha-beta over victims-first ordering keeps the tree
 * trivial; there is no positional term anywhere, this is piece counting.
 */
const settled = (pos: Chess, alpha: number, beta: number, depth: number): number => {
  const stm = pos.turn;
  const inCheck = pos.isCheck();
  const stand = material(pos, stm);
  if (depth <= 0) return stand;
  if (!inCheck) {
    // Nobody is forced to keep capturing: stopping here is always on offer.
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
  }

  const moves: { from: Square; to: Square; victim: number }[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const target = pos.board.get(to);
      // Own piece on the target square is chessops spelling castling as
      // king-takes-rook — never a capture. En passant's victim is a pawn
      // that is not on the target square.
      const capture =
        (target !== undefined && target.color !== stm) ||
        (pos.board.get(from)?.role === 'pawn' && to === pos.epSquare);
      if (!inCheck && !capture) continue;
      moves.push({ from, to, victim: target && target.color !== stm ? VALUE[target.role] : capture ? 1 : 0 });
    }
  }
  if (moves.length === 0) return inCheck ? -MATE : stand;
  moves.sort((a, b) => b.victim - a.victim);

  let best = inCheck ? -Infinity : stand;
  for (const { from, to } of moves) {
    const child = pos.clone();
    child.play({
      from,
      to,
      // Material-only search: a pawn reaching the last rank always queens.
      promotion: pos.board.get(from)?.role === 'pawn' && (to >= 56 || to <= 7) ? 'queen' : undefined,
    });
    const score = -settled(child, -beta, -alpha, depth - 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
};

const parse = (fen: string): Chess | null => {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.unwrap());
  return pos.isErr ? null : pos.unwrap();
};

/**
 * Per-move sacrifice flags for a line of positions (`fens[i]` is where
 * move `i` was played from, so n+1 positions yield n flags).
 *
 * A move is a sacrifice when both hold:
 *
 * - **Offered**: settling every capture from the position AFTER the move
 *   leaves the mover at least two pawns' worth below the material they
 *   simply OWNED before it. Two points is the smallest gap that reads as
 *   an investment — an exchange sacrifice clears it, an even trade or a
 *   defended piece cannot, and a pure pawn sacrifice deliberately does
 *   not (flagging every gambit-ish pawn would drown the mark).
 *
 * - **Created by this move**: passing instead (the same position with
 *   the turn handed over) would NOT already lose as much. A piece left
 *   en prise for several quiet moves is one sacrifice on the move that
 *   offered it, not a new one every ply it stays takeable. Skipped when
 *   the mover is in check, where there is no such thing as passing.
 *
 * A position that fails to parse yields false — no verdict beats a
 * guessed one.
 */
export function detectSacrifices(fens: string[]): boolean[] {
  return fens.slice(0, -1).map((fen, i) => {
    const before = parse(fen);
    const after = parse(fens[i + 1]!);
    if (!before || !after) return false;
    const mover = before.turn;

    const owned = material(before, mover);
    // `after` is the opponent's turn, so the search answers from their
    // side; the mover's view is its negation.
    const kept = -settled(after, -Infinity, Infinity, MAX_PLIES);
    if (kept > owned - 2) return false;

    if (before.isCheck()) return true;
    const setup = before.toSetup();
    setup.turn = mover === 'white' ? 'black' : 'white';
    setup.epSquare = undefined;
    const passed = Chess.fromSetup(setup);
    if (passed.isErr) return true;
    return -settled(passed.unwrap(), -Infinity, Infinity, MAX_PLIES) > owned - 2;
  });
}
