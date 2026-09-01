import { winningChances } from './uci.ts';
import type { Category } from '@/explorer/tablebase';

/**
 * Lichess-style move judgment — the real criteria, not an imitation:
 * centipawns map to winning chances through lila's logistic curve, and a
 * move is judged by how much of those chances it threw away. Lila's
 * thresholds are 0.1/0.2/0.3 on a −1..1 scale; `winningChances` here is
 * normalised to 0..1, so they halve.
 *
 * Brilliancy (!!, NAG 3) is NOT a chess.com imitation — their criteria
 * are proprietary and rating-adjusted. This one is a rule you can say
 * out loud: the played move held the evaluation (≤2% chance drop), it
 * genuinely offered real material (two pawns' worth capturable at a
 * profit in the position it created — see engine/sacrifice.ts), and the
 * game wasn't already decided either way.
 */

export interface Score {
  cp?: number;
  mate?: number;
}

/** NAG for a winning-chances drop (0..1 scale): ?! / ? / ?? or none. */
export function judgeNag(drop: number): number | null {
  if (drop >= 0.15) return 4; // ?? blunder
  if (drop >= 0.1) return 2; // ? mistake
  if (drop >= 0.05) return 6; // ?! inaccuracy
  return null;
}

/**
 * What a tablebase verdict means for the GAME, which is the only thing
 * a review judges by.
 *
 * Three outcomes, not eight: the fifty-move pair collapse into the draw
 * they actually end in — a cursed win is a win the rule draws, and a
 * player who reaches one has drawn, whatever the pieces say. (The
 * explorer pane already paints them the draw's colour for the same
 * reason.) `maybe-win`/`maybe-loss` are the source saying it is not sure
 * under that rule, and unsure is not something to stamp a blunder on, so
 * they judge nothing at all — as does `unknown`.
 */
export function outcomeOf(category: Category | null): 'win' | 'draw' | 'loss' | null {
  switch (category) {
    case 'win':
      return 'win';
    case 'loss':
      return 'loss';
    case 'draw':
    case 'cursed-win':
    case 'blessed-loss':
      return 'draw';
    default:
      return null;
  }
}

const OUTCOME_RANK: Record<'win' | 'draw' | 'loss', number> = { win: 2, draw: 1, loss: 0 };

/** Turn a verdict round: the position after a move is the OPPONENT's to
    play, so their win is the mover's loss. */
const flip = (outcome: 'win' | 'draw' | 'loss'): 'win' | 'draw' | 'loss' =>
  outcome === 'win' ? 'loss' : outcome === 'loss' ? 'win' : 'draw';

/**
 * Judge one move against the tables rather than against a score.
 *
 * The rule is not the eval-swing one and must not be: under a tablebase
 * a move is a blunder when it changes the RESULT, by any distance, and
 * nothing else is a mistake at all. Going from mate in 5 to mate in 40
 * throws away no part of the point; going from +9.0 to +8.5 in a drawn
 * fortress was never worth anything to begin with. So this returns
 * exactly one NAG or none — no inaccuracies, no mistakes, because there
 * is no such thing as slightly losing a won ending.
 *
 * `before` is the verdict for the side to move; `after` is the verdict
 * in the position the move reached, which belongs to the OPPONENT and is
 * flipped here.
 */
export function judgeTablebase(before: Category | null, after: Category | null): number | null {
  const was = outcomeOf(before);
  const now = outcomeOf(after);
  if (was === null || now === null) return null;
  // A move cannot improve the mover's own result against perfect play; if
  // one appears to, the two positions were not answered by the same
  // tables, and inventing a verdict from that is worse than staying quiet.
  return OUTCOME_RANK[flip(now)] < OUTCOME_RANK[was] ? 4 : null;
}

/** The mover's winning chances (0..1) from a white-POV score. */
export function moverChances(whitePov: Score, mover: 'white' | 'black'): number {
  const chances = winningChances(whitePov);
  return mover === 'white' ? chances : 1 - chances;
}

/**
 * Per-move accuracy, lichess's published formula
 * (https://lichess.org/page/accuracy), over win% (0..100) before/after
 * from the mover's perspective.
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const loss = Math.max(0, winBefore - winAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.min(100, Math.max(0, raw));
}

/** Centipawn value of a white-POV score, mates clamped like lila does. */
export function cpOf(score: Score): number {
  if (score.mate !== undefined) return score.mate > 0 ? 1000 : -1000;
  return Math.min(1000, Math.max(-1000, score.cp ?? 0));
}

export interface SideSummary {
  /** Arithmetic mean of per-move accuracies (lila windows/weights; close). */
  accuracy: number;
  acpl: number;
  moves: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  brilliancies: number;
  /** Moves inside the opening-book prefix (never judged). */
  bookMoves: number;
  /** Moves the tables judged instead of the engine — the endgame, and
      how much of the game it was. */
  tablebaseMoves: number;
}

export interface MoveVerdict {
  /** Index into the mainline (0 = first move). */
  ply: number;
  mover: 'white' | 'black';
  nag: number | null;
  accuracy: number;
  cpLoss: number;
  /** Known theory: judgment withheld, measurement kept. */
  book: boolean;
  /** The tables judged this one, not the engine. Accuracy and cp-loss
      below are still the engine's — see judgeLine. */
  tablebase: boolean;
}

/**
 * Judge every move of a line given white-POV scores for each position
 * (scores.length = moves.length + 1; scores[0] is before the first move).
 *
 * `bookPlies` is how many leading moves are known theory — each reached a
 * position in the opening catalogue, with no gap (once out of book a game
 * never re-enters, however it transposes). Book moves get NO quality NAG:
 * theory is memory, not calculation, and judging it flags every sound
 * gambit as an inaccuracy. Accuracy and cp-loss are still MEASURED for
 * them — suppressing a verdict is not the same as faking a number.
 */
export function judgeLine(
  scores: Score[],
  firstMover: 'white' | 'black',
  /** Per-move flag: material genuinely offered by the move — capturable
      at a profit in the position it created (see engine/sacrifice.ts). */
  sacrifices?: boolean[],
  bookPlies = 0,
  /**
   * Per-POSITION tablebase verdicts, aligned with `scores` — null where
   * no table covers that position, which is most of a game.
   *
   * Where both sides of a move are covered, the table judges it and the
   * engine does not: its number is an estimate and the table's is the
   * result, and the two disagree exactly where it matters. Accuracy and
   * cp-loss stay the engine's measurement, for the same reason a book
   * move keeps its numbers — withholding a verdict is not the same as
   * faking a figure, and an accuracy that jumped to 100 or 0 on the move
   * the pieces ran out would be a number about nothing.
   */
  tablebase?: (Category | null)[],
): MoveVerdict[] {
  const verdicts: MoveVerdict[] = [];
  for (let i = 1; i < scores.length; i++) {
    const mover: 'white' | 'black' =
      i % 2 === 1 ? firstMover : firstMover === 'white' ? 'black' : 'white';
    const before = moverChances(scores[i - 1]!, mover);
    const after = moverChances(scores[i]!, mover);
    const drop = Math.max(0, before - after);
    const cpBefore = cpOf(scores[i - 1]!) * (mover === 'white' ? 1 : -1);
    const cpAfter = cpOf(scores[i]!) * (mover === 'white' ? 1 : -1);
    const book = i - 1 < bookPlies;
    // Covered when BOTH sides of the move are: one end in the tables and
    // the other out of them can only be compared through the engine.
    const covered =
      outcomeOf(tablebase?.[i - 1] ?? null) !== null && outcomeOf(tablebase?.[i] ?? null) !== null;
    // No brilliancies in book either: a memorised sacrifice is preparation.
    // Nor under the tables: "!!" is measured in winning chances offered
    // against material, and where the result is known there are no
    // chances — every move that holds the win is simply the method. (A
    // move that is the ONLY one holding it would be worth saying; the
    // probe already carries the move list to say it with, so that is a
    // thing to add, not a thing this rule is pretending to cover.)
    const brilliant =
      !book &&
      !covered &&
      sacrifices?.[i - 1] === true &&
      drop <= 0.02 &&
      before > 0.35 &&
      before < 0.9;
    verdicts.push({
      ply: i - 1,
      mover,
      nag: book
        ? null
        : covered
          ? judgeTablebase(tablebase![i - 1]!, tablebase![i]!)
          : brilliant
            ? 3
            : judgeNag(drop),
      accuracy: moveAccuracy(before * 100, after * 100),
      cpLoss: Math.min(1000, Math.max(0, cpBefore - cpAfter)),
      book,
      tablebase: covered && !book,
    });
  }
  return verdicts;
}

export function summarise(verdicts: MoveVerdict[], side: 'white' | 'black'): SideSummary {
  const own = verdicts.filter((v) => v.mover === side);
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  return {
    accuracy: Math.round(mean(own.map((v) => v.accuracy)) * 10) / 10,
    acpl: Math.round(mean(own.map((v) => v.cpLoss))),
    moves: own.length,
    inaccuracies: own.filter((v) => v.nag === 6).length,
    mistakes: own.filter((v) => v.nag === 2).length,
    blunders: own.filter((v) => v.nag === 4).length,
    brilliancies: own.filter((v) => v.nag === 3).length,
    bookMoves: own.filter((v) => v.book).length,
    tablebaseMoves: own.filter((v) => v.tablebase).length,
  };
}
