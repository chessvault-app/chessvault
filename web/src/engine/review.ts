import { winningChances } from './uci.ts';

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
 * sacrificed real material (two pawns' worth still ungained after the
 * opponent's reply), and the game wasn't already decided either way.
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
  /** Per-move flag: material sacrificed and not immediately recouped. */
  sacrifices?: boolean[],
  bookPlies = 0,
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
    // No brilliancies in book either: a memorised sacrifice is preparation.
    const brilliant =
      !book && sacrifices?.[i - 1] === true && drop <= 0.02 && before > 0.35 && before < 0.9;
    verdicts.push({
      ply: i - 1,
      mover,
      nag: book ? null : brilliant ? 3 : judgeNag(drop),
      accuracy: moveAccuracy(before * 100, after * 100),
      cpLoss: Math.min(1000, Math.max(0, cpBefore - cpAfter)),
      book,
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
  };
}
