import { describe, expect, it } from 'vitest';
import { parseSquare } from 'chessops/util';
import {
  defaultEditorState,
  emptyEditorState,
  epCandidates,
  fromFen,
  toFen,
  validate,
  type CastlingFlag,
} from './editorFen.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('editor FEN round-trip', () => {
  it('reads and writes the starting position unchanged', () => {
    expect(toFen(defaultEditorState())).toBe(START);
    expect(toFen(fromFen(START)!)).toBe(START);
  });

  it('produces an empty-board FEN', () => {
    expect(toFen(emptyEditorState())).toBe('8/8/8/8/8/8/8/8 w - - 0 1');
  });

  it('rejects an unparseable FEN', () => {
    expect(fromFen('not a fen')).toBeUndefined();
    expect(fromFen('')).toBeUndefined();
  });

  it('preserves each castling flag individually', () => {
    for (const flag of ['K', 'Q', 'k', 'q'] as CastlingFlag[]) {
      const fen = START.replace('KQkq', flag);
      const state = fromFen(fen)!;
      expect(state.castling.has(flag), `${flag} should survive`).toBe(true);
      expect(state.castling.size).toBe(1);
      expect(toFen(state)).toBe(fen);
    }
  });

  it('drops a castling right when the rook is not on its home square', () => {
    // Claim White kingside castling, but h1 is empty.
    const state = fromFen(START)!;
    state.pieces.delete(parseSquare('h1')!);
    // K must vanish; Q (a1 rook still present) must remain.
    const fen = toFen(state);
    expect(fen).toContain(' Qkq ');
    expect(fen).not.toContain('KQkq');
  });

  it('keeps the en-passant square and move counters', () => {
    const fen = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 3 7';
    const state = fromFen(fen)!;
    expect(state.epSquare).toBe('f6');
    expect(state.halfmoves).toBe(3);
    expect(state.fullmoves).toBe(7);
    expect(toFen(state)).toBe(fen);
  });
});

describe('validate', () => {
  it('accepts the starting position', () => {
    expect(validate(defaultEditorState()).legal).toBe(true);
  });

  it('requires both kings', () => {
    expect(validate(emptyEditorState())).toMatchObject({
      legal: false,
      reason: 'Both sides need a king.',
    });
    const oneKing = fromFen('4k3/8/8/8/8/8/8/8 w - - 0 1')!;
    expect(validate(oneKing).reason).toBe('Both sides need a king.');
  });

  it('rejects two kings of the same colour', () => {
    const state = fromFen('4k3/8/8/8/8/8/8/K3K3 w - - 0 1')!;
    expect(validate(state)).toMatchObject({
      legal: false,
      reason: 'Each side can only have one king.',
    });
  });

  it('rejects pawns on the back ranks', () => {
    const first = fromFen('4k3/8/8/8/8/8/8/K6P w - - 0 1');
    // h1 pawn — parseable as a FEN, but not a reachable position.
    expect(validate(first!).reason).toMatch(/first or last rank/);
    const last = fromFen('4k2P/8/8/8/8/8/8/K7 w - - 0 1');
    expect(validate(last!).reason).toMatch(/first or last rank/);
  });

  it('explains when the side not to move is in check', () => {
    // Black king on e8 attacked by the e1 rook, but it is White to move.
    const state = fromFen('4k3/8/8/8/8/8/8/4R2K w - - 0 1')!;
    const result = validate(state);
    expect(result.legal).toBe(false);
    expect(result.reason).toMatch(/not to move is in check/);
    // Flipping the turn makes it legal.
    expect(validate({ ...state, turn: 'black' }).legal).toBe(true);
  });
});

describe('epCandidates', () => {
  it('offers rank 6 for White and rank 3 for Black', () => {
    const white = epCandidates({ ...emptyEditorState(), turn: 'white' });
    expect(white).toHaveLength(8);
    expect(white.every((s) => s.endsWith('6'))).toBe(true);

    const black = epCandidates({ ...emptyEditorState(), turn: 'black' });
    expect(black.every((s) => s.endsWith('3'))).toBe(true);
  });

  it('excludes occupied squares', () => {
    const state = fromFen('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 0 1')!;
    // Black to move -> rank 3 candidates; f3 holds a knight.
    expect(epCandidates(state)).not.toContain('f3');
    expect(epCandidates(state)).toContain('e3');
  });
});
