import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { PgnParser } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { summarise, type MoveVerdict } from '@/engine/review';

/**
 * The engine pass's arithmetic, apart from the engine: a PGN into the
 * positions the engine is asked about, a position into its phase, and
 * the verdicts into the record the server keeps. Pure, so the pass's
 * bookkeeping is tested without a worker; the loop that drives the
 * engine is in analysisJob.ts.
 */

/** One judged move of the owner's, as the server stores it: ply,
    accuracy, quality NAG (0 for none), phase, book. Mirrors
    server/myGamesAnalysis.ts PerMove. */
export type PerMove = [number, number, number, number, number];

export interface AnalysisRecord {
  file: string;
  index: number;
  side: 'white' | 'black';
  site: string | null;
  plies: number;
  depth: number;
  accuracy: number;
  acpl: number;
  moves: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  brilliancies: number;
  bookMoves: number;
  perMove: PerMove[];
}

/**
 * The mainline of a PGN as the FEN before every move and after the last,
 * so `fens.length` is the ply count plus one. Null for what the index
 * also refuses (a variant, a set-up position, nothing legal to replay):
 * such a game is never queued, so a null here is a file that changed
 * under the pass, and the game is simply skipped this round.
 */
export function lineOf(pgn: string): { fens: string[]; plies: number } | null {
  let out: { fens: string[]; plies: number } | null = null;
  new PgnParser((game, err) => {
    if (err || out) return;
    const variant = (game.headers.get('Variant') ?? 'standard').toLowerCase();
    if (!['standard', 'chess', 'classical', 'normal'].includes(variant)) return;
    if (game.headers.has('FEN')) return;
    const pos = Chess.default();
    const fens = [makeFen(pos.toSetup())];
    for (const data of game.moves.mainline()) {
      const move = parseSan(pos, data.san);
      if (!move) break;
      pos.play(move);
      fens.push(makeFen(pos.toSetup()));
    }
    if (fens.length > 1) out = { fens, plies: fens.length - 1 };
  }).parse(pgn);
  return out;
}

/**
 * The phase a position is in, by the pieces left on the board: lila's
 * divider, less its "mixedness" test. Counting queens, rooks, bishops
 * and knights of both sides, more than ten is the opening, ten or fewer
 * the middlegame, six or fewer the endgame. A rule you can say out loud,
 * and one the two sites' own phase figures are near enough to.
 */
export function phaseOf(fen: string): 0 | 1 | 2 {
  const setup = parseFen(fen);
  if (setup.isErr) return 1;
  const board = setup.unwrap().board;
  const pieces = board.occupied.diff(board.pawn).diff(board.king).size();
  return pieces > 10 ? 0 : pieces > 6 ? 1 : 2;
}

/**
 * How many leading moves are book: one flag per move (whether the
 * position it REACHES is in the catalogue), counted until the first
 * that is not. Once out, never back in, however a game transposes.
 */
export function bookPrefix(reached: readonly boolean[], cap: number): number {
  let n = 0;
  while (n < reached.length && n < cap && reached[n]) n += 1;
  return n;
}

/** The record the server keeps, from the review's verdicts. */
export function buildRecord(input: {
  file: string;
  index: number;
  side: 'white' | 'black';
  site: string | null;
  depth: number;
  fens: string[];
  verdicts: MoveVerdict[];
}): AnalysisRecord {
  const { side } = input;
  const summary = summarise(input.verdicts, side);
  const perMove: PerMove[] = input.verdicts
    .filter((v) => v.mover === side)
    .map((v) => [
      v.ply,
      Math.round(v.accuracy * 10) / 10,
      v.nag ?? 0,
      phaseOf(input.fens[v.ply]!),
      v.book ? 1 : 0,
    ]);
  return {
    file: input.file,
    index: input.index,
    side,
    site: input.site,
    plies: input.fens.length - 1,
    depth: input.depth,
    accuracy: summary.accuracy,
    acpl: summary.acpl,
    moves: summary.moves,
    inaccuracies: summary.inaccuracies,
    mistakes: summary.mistakes,
    blunders: summary.blunders,
    brilliancies: summary.brilliancies,
    bookMoves: summary.bookMoves,
    perMove,
  };
}
