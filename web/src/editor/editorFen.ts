import { Chess } from 'chessops/chess';
import { Board } from 'chessops/board';
import { defaultSetup, type Setup } from 'chessops/setup';
import { SquareSet } from 'chessops/squareSet';
import { makeFen, parseFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';
import type { Color, Piece, Square } from 'chessops/types';

export type CastlingFlag = 'K' | 'Q' | 'k' | 'q';

/** Editable board state, independent of any legality constraint. */
export interface EditorState {
  /** Square index -> piece. Sparse; missing means empty. */
  pieces: Map<Square, Piece>;
  turn: Color;
  castling: Set<CastlingFlag>;
  /** En-passant target square name, e.g. `e3`, or null. */
  epSquare: string | null;
  halfmoves: number;
  fullmoves: number;
}

export function emptyEditorState(): EditorState {
  return {
    pieces: new Map(),
    turn: 'white',
    castling: new Set(),
    epSquare: null,
    halfmoves: 0,
    fullmoves: 1,
  };
}

export function defaultEditorState(): EditorState {
  return fromFen(makeFen(defaultSetup())) ?? emptyEditorState();
}

/** Read a FEN into editor state. Returns undefined if the FEN is unparseable. */
export function fromFen(fen: string): EditorState | undefined {
  const parsed = parseFen(fen.trim());
  if (parsed.isErr) return undefined;
  const setup = parsed.unwrap();

  const pieces = new Map<Square, Piece>();
  for (const square of setup.board.occupied) {
    const piece = setup.board.get(square);
    if (piece) pieces.set(square, piece);
  }

  const castling = new Set<CastlingFlag>();
  // chessops stores castling rights as rook squares, which is more robust than
  // KQkq for shuffled positions; translate back to the familiar flags.
  for (const rook of setup.castlingRights) {
    const isWhite = rook < 8;
    const kingSide = (rook & 7) > 4;
    castling.add(
      isWhite ? (kingSide ? 'K' : 'Q') : kingSide ? 'k' : 'q',
    );
  }

  return {
    pieces,
    turn: setup.turn,
    castling,
    epSquare: setup.epSquare !== undefined ? squareName(setup.epSquare) : null,
    halfmoves: setup.halfmoves,
    fullmoves: setup.fullmoves,
  };
}

const FILES = 'abcdefgh';
const squareName = (square: Square): string =>
  `${FILES[square & 7]}${1 + (square >> 3)}`;

/** Build a FEN from editor state. Always succeeds; may describe an illegal position. */
export function toFen(state: EditorState): string {
  const board = Board.empty();
  for (const [square, piece] of state.pieces) board.set(square, piece);

  let castlingRights = SquareSet.empty();
  // Only claim a castling right when the rook is actually on its home square,
  // otherwise the FEN would be self-contradictory.
  const rookSquares: Record<CastlingFlag, number> = { Q: 0, K: 7, q: 56, k: 63 };
  for (const flag of state.castling) {
    const square = rookSquares[flag];
    const piece = state.pieces.get(square);
    const expected: Color = flag === flag.toUpperCase() ? 'white' : 'black';
    if (piece?.role === 'rook' && piece.color === expected) {
      castlingRights = castlingRights.with(square);
    }
  }

  const setup: Setup = {
    board,
    pockets: undefined,
    turn: state.turn,
    castlingRights,
    epSquare: state.epSquare ? (parseSquare(state.epSquare) ?? undefined) : undefined,
    remainingChecks: undefined,
    halfmoves: state.halfmoves,
    fullmoves: state.fullmoves,
  };
  return makeFen(setup);
}

export interface Validity {
  legal: boolean;
  /** Why the position can't be analysed, if it can't. */
  reason?: string;
}

/**
 * Check whether the position can actually be played from.
 *
 * The editor deliberately allows illegal arrangements while you build them, so
 * this is what gates handing the position to the analysis board.
 */
export function validate(state: EditorState, fen = toFen(state)): Validity {
  const whiteKings = [...state.pieces.values()].filter(
    (p) => p.role === 'king' && p.color === 'white',
  ).length;
  const blackKings = [...state.pieces.values()].filter(
    (p) => p.role === 'king' && p.color === 'black',
  ).length;

  // Report the common mistakes specifically; chessops' own message for these is
  // accurate but not helpful in a UI.
  if (whiteKings === 0 || blackKings === 0) {
    return { legal: false, reason: 'Both sides need a king.' };
  }
  if (whiteKings > 1 || blackKings > 1) {
    return { legal: false, reason: 'Each side can only have one king.' };
  }
  for (const [square, piece] of state.pieces) {
    const rank = square >> 3;
    if (piece.role === 'pawn' && (rank === 0 || rank === 7)) {
      return { legal: false, reason: 'Pawns cannot stand on the first or last rank.' };
    }
  }

  const parsed = parseFen(fen);
  if (parsed.isErr) return { legal: false, reason: parsed.error.message };
  const position = Chess.fromSetup(parsed.unwrap());
  if (position.isErr) {
    const message = position.error.message;
    // e.g. the side not to move is left in check.
    return {
      legal: false,
      reason:
        message === 'ERR_OPPOSITE_CHECK'
          ? 'The side not to move is in check — switch whose turn it is.'
          : message.replace(/^ERR_/, '').toLowerCase().replace(/_/g, ' '),
    };
  }
  return { legal: true };
}

/** Squares where an en-passant target is even possible, given whose turn it is. */
export function epCandidates(state: EditorState): string[] {
  const rank = state.turn === 'white' ? 5 : 2; // 0-indexed: rank 6 or rank 3
  const out: string[] = [];
  for (let file = 0; file < 8; file++) {
    const square = rank * 8 + file;
    if (!state.pieces.has(square)) out.push(squareName(square));
  }
  return out;
}
