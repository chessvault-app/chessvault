import { Board } from 'chessops/board';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { SquareSet } from 'chessops/squareSet';
import type { Color, Role } from 'chessops/types';
import { materialSatisfied, type MaterialSpec, type PieceLetter } from '../shared/scanMatch.ts';
import { MAX_MEN, drillable } from '../shared/endgameDrill.ts';

/**
 * Random legal endgames of a given material, for the endgame drill.
 *
 * The drill wants "a rook ending", not a position anybody has seen: a
 * random one, small enough for a tablebase to hold, whose winner is
 * decided by the table rather than guessed here. So this file only
 * proposes. It rolls piece counts inside the spec's ranges, scatters
 * them, and hands back whatever chessops accepts as a legal position
 * with a move to play; whether the side to move is winning is the
 * tablebase's verdict, asked by the route (server/endgameDrill.ts),
 * which draws candidates from here until one is.
 *
 * The spec is the games hunt's own (shared/scanMatch.ts): a preset from
 * endgames.json, or the custom editor's ranges. Nothing here knows a
 * class by name, which keeps every endgame a row of data and none of
 * them a branch.
 */

/** The ceiling and the fit test live in shared/endgameDrill.ts, where
    the app's class picker reads them too. */
export { MAX_MEN, drillable };

/** A source of numbers in [0, 1), so the tests can seed it. */
export type Rng = () => number;

const LETTERS: readonly PieceLetter[] = ['p', 'n', 'b', 'r', 'q'];
const ROLE: Record<PieceLetter, Role> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
};

/**
 * What an UNCONSTRAINED letter may draw. A preset that says nothing
 * about pawns ("Rook endgame") means "any number" to the hunt, whose
 * games decide; a drill has to pick, and three queens a side is not
 * an ending anybody trains. Ranges the spec does state are honoured
 * as written.
 */
const FREE_CEILING: Record<PieceLetter, number> = { p: 4, n: 2, b: 2, r: 2, q: 1 };

const randomInt = (random: Rng, lo: number, hi: number): number =>
  lo + Math.floor(random() * (hi - lo + 1));

/**
 * Piece counts inside the spec, the total under the ceiling.
 *
 * Every (side, letter) slot takes its minimum first, then the slots are
 * visited in a random order and each draws extra pieces from what is
 * left of the budget. The order is shuffled because a fixed one would
 * always hand the spare men to the same pieces; the result is checked
 * against the whole spec afterwards, difference ranges included, since
 * counts drawn per side know nothing about "a pawn up".
 */
function sampleCounts(
  spec: MaterialSpec,
  random: Rng,
): Record<Color, Record<PieceLetter, number>> | null {
  const counts: Record<Color, Record<PieceLetter, number>> = {
    white: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    black: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  const slots: { color: Color; letter: PieceLetter; max: number }[] = [];
  let budget = MAX_MEN - 2;
  for (const color of ['white', 'black'] as const) {
    for (const letter of LETTERS) {
      const range = spec[color][letter];
      const min = range ? range[0] : 0;
      const max = range ? range[1] : FREE_CEILING[letter];
      counts[color][letter] = min;
      budget -= min;
      slots.push({ color, letter, max });
    }
  }
  if (budget < 0) return null;
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  for (const { color, letter, max } of slots) {
    const room = Math.min(max - counts[color][letter], budget);
    if (room <= 0) continue;
    const extra = randomInt(random, 0, room);
    counts[color][letter] += extra;
    budget -= extra;
  }
  return counts;
}

/**
 * Counts that satisfy the WHOLE spec, difference ranges included.
 *
 * Rolling counts is cheap and placing pieces is not, so a difference
 * range ("two minors for a rook") is settled here, on the counts, before
 * any square is chosen: the rolled counts are laid on a scratch board
 * and put to the same materialSatisfied the scan uses, so there is one
 * reading of what a spec means. A spec whose differences are hard to
 * hit at random gets many rolls; one that cannot be hit gets none.
 */
function sampleCountsSatisfying(
  spec: MaterialSpec,
  random: Rng,
): Record<Color, Record<PieceLetter, number>> | null {
  for (let tries = 0; tries < 64; tries += 1) {
    const counts = sampleCounts(spec, random);
    if (!counts) return null;
    const scratch = Board.empty();
    let square = 0;
    for (const color of ['white', 'black'] as const) {
      for (const letter of LETTERS) {
        for (let n = 0; n < counts[color][letter]; n += 1) {
          scratch.set(square++, { color, role: ROLE[letter] });
        }
      }
    }
    if (materialSatisfied(scratch, spec)) return counts;
  }
  return null;
}

/**
 * One legal position of the spec's material with the given side to
 * move, or null when this roll produced none. Callers loop.
 *
 * Kings on any square, pawns off the first and last ranks, nothing on a
 * square already taken; then chessops decides legality (kings apart,
 * the side not to move not in check). What is refused here before any
 * table is asked: a side to move with a bare king, which cannot be
 * winning; a position with no move to play; and material the rules
 * already call a draw. The spec is re-checked on the placed board so a
 * difference range ("a rook up") holds as well as the per-side counts.
 */
export function samplePosition(spec: MaterialSpec, turn: Color, random: Rng): string | null {
  const counts = sampleCountsSatisfying(spec, random);
  if (!counts) return null;
  const board = Board.empty();
  const taken = new Set<number>();
  const place = (color: Color, role: Role, pawn: boolean): boolean => {
    for (let tries = 0; tries < 64; tries += 1) {
      const square = pawn ? randomInt(random, 8, 55) : randomInt(random, 0, 63);
      if (taken.has(square)) continue;
      taken.add(square);
      board.set(square, { color, role });
      return true;
    }
    return false;
  };
  if (!place('white', 'king', false) || !place('black', 'king', false)) return null;
  for (const color of ['white', 'black'] as const) {
    for (const letter of LETTERS) {
      for (let n = 0; n < counts[color][letter]; n += 1) {
        if (!place(color, ROLE[letter], letter === 'p')) return null;
      }
    }
  }
  if (!materialSatisfied(board, spec)) return null;
  // A bare king to move has nothing to win with.
  if (board[turn].diff(board.king).isEmpty()) return null;
  const setup = {
    board,
    pockets: undefined,
    turn,
    castlingRights: SquareSet.empty(),
    epSquare: undefined,
    remainingChecks: undefined,
    halfmoves: 0,
    fullmoves: 1,
  };
  const pos = Chess.fromSetup(setup);
  if (pos.isErr) return null;
  if (pos.value.isEnd() || pos.value.isInsufficientMaterial()) return null;
  return makeFen(setup);
}

/**
 * Up to `count` candidates, each a legal position of the spec's
 * material with a random side to move. Fewer where the material makes
 * legal placements rare; none where the spec cannot fit at all.
 */
export function drawCandidates(spec: MaterialSpec, count: number, random: Rng): string[] {
  const out: string[] = [];
  if (!drillable(spec)) return out;
  // Each candidate gets a handful of rolls, so a class whose random
  // placements are mostly illegal (many pawns on few free squares)
  // still yields, while a spec that never places anything ends.
  for (let rolls = 0; out.length < count && rolls < count * 8; rolls += 1) {
    const turn: Color = random() < 0.5 ? 'white' : 'black';
    const fen = samplePosition(spec, turn, random);
    if (fen) out.push(fen);
  }
  return out;
}
