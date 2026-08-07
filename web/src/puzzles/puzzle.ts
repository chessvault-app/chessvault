import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseUci } from 'chessops/util';
import type { Color } from 'chessops/types';

/**
 * Pure puzzle mechanics, lichess semantics: `fen` is the position BEFORE
 * the opponent's setup move; `moves[0]` is that setup move, and the solver
 * answers every odd index. A solver move is correct if it matches the
 * solution — or if it delivers checkmate, which lichess accepts even when
 * it differs (any mate ends the puzzle, solved).
 */

export interface ApiPuzzle {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  popularity: number;
  plays: number;
  themes: string;
  game_url: string | null;
  opening_tags: string | null;
}

export interface PuzzlePosition {
  fen: string;
  /** chessground dests for the side to move. */
  dests: Map<string, string[]>;
  check: boolean;
  turn: Color;
  lastMove?: [string, string];
}

export function solverColor(puzzle: ApiPuzzle): Color {
  const setup = parseFen(puzzle.fen).unwrap();
  // The solver answers the setup move, so they play the OTHER side.
  return setup.turn === 'white' ? 'black' : 'white';
}

function positionAfter(puzzle: ApiPuzzle, plies: number): Chess {
  const pos = Chess.fromSetup(parseFen(puzzle.fen).unwrap()).unwrap();
  const moves = puzzle.moves.split(' ');
  for (const uci of moves.slice(0, plies)) {
    pos.play(parseUci(uci)!);
  }
  return pos;
}

/** The board state after `plies` of the solution (0 = the raw FEN). */
export function positionAt(puzzle: ApiPuzzle, plies: number): PuzzlePosition {
  const pos = positionAfter(puzzle, plies);
  const moves = puzzle.moves.split(' ');
  const last = plies > 0 ? moves[plies - 1]! : undefined;
  return {
    fen: makeFen(pos.toSetup()),
    dests: chessgroundDests(pos),
    check: pos.isCheck(),
    turn: pos.turn,
    lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : undefined,
  };
}

/** The board state after `plies` of the solution plus one off-script move. */
export function positionWith(puzzle: ApiPuzzle, plies: number, uci: string): PuzzlePosition {
  const pos = positionAfter(puzzle, plies);
  pos.play(parseUci(uci)!);
  return {
    fen: makeFen(pos.toSetup()),
    dests: new Map(),
    check: pos.isCheck(),
    turn: pos.turn,
    lastMove: [uci.slice(0, 2), uci.slice(2, 4)],
  };
}

export type Judgement = 'correct' | 'wrong' | 'complete';

/**
 * Judge the solver's move at `plies` into the solution. `complete` means
 * the puzzle is finished by this move — either it was the last solution
 * move, or it mates.
 */
export function judgeMove(puzzle: ApiPuzzle, plies: number, uci: string): Judgement {
  const moves = puzzle.moves.split(' ');
  const expected = moves[plies];
  const pos = positionAfter(puzzle, plies);
  const move = parseUci(uci);
  if (!move) return 'wrong';

  if (uci === expected) {
    pos.play(move);
    return plies + 1 >= moves.length || pos.isCheckmate() ? 'complete' : 'correct';
  }
  // Off-script but mates: accepted, puzzle over.
  makeSanAndPlay(pos, move);
  return pos.isCheckmate() ? 'complete' : 'wrong';
}

/** SAN for the solution move at `plies`, for the solution viewer. */
export function solutionSan(puzzle: ApiPuzzle, plies: number): string {
  const pos = positionAfter(puzzle, plies);
  return makeSanAndPlay(pos, parseUci(puzzle.moves.split(' ')[plies]!)!);
}

/** SAN of the first `plies` solution moves, for the trainer's move list. */
export function sanLine(puzzle: ApiPuzzle, plies: number): string[] {
  const pos = Chess.fromSetup(parseFen(puzzle.fen).unwrap()).unwrap();
  return puzzle.moves
    .split(' ')
    .slice(0, plies)
    .map((uci) => makeSanAndPlay(pos, parseUci(uci)!));
}

/** Move number and side to move of the raw puzzle FEN, for numbering. */
export function startAt(puzzle: ApiPuzzle): { moveNumber: number; blackToMove: boolean } {
  const parts = puzzle.fen.split(' ');
  return { moveNumber: Number(parts[5] ?? 1), blackToMove: parts[1] === 'b' };
}
