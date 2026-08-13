import { describe, expect, it } from 'vitest';
import { moveTextToUci } from './moveText';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// White ready to castle either side; a pawn on b2 so `b4` stays ambiguous
// with the bishop-to-b4 reading.
const CASTLING = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
// White pawn on e7, empty e8 — one push from promotion.
const PROMOTING = '8/3kP3/8/8/8/8/8/4K3 w - - 0 1';

describe('moveTextToUci', () => {
  it('reads SAN as printed', () => {
    expect(moveTextToUci(START, 'Nf3')).toBe('g1f3');
    expect(moveTextToUci(START, 'e4')).toBe('e2e4');
  });

  it('reads lowercase piece letters the way they are typed', () => {
    expect(moveTextToUci(START, 'nf3')).toBe('g1f3');
  });

  it('keeps a bare pawn-file reading over the piece reading', () => {
    // `b4` while the b-pawn can push must be the pawn, not a bishop.
    expect(moveTextToUci(START, 'b4')).toBe('b2b4');
  });

  it('reads castling spelt with zeros or lowercase o', () => {
    expect(moveTextToUci(CASTLING, '0-0')).toBe('e1g1');
    expect(moveTextToUci(CASTLING, 'o-o-o')).toBe('e1c1');
    expect(moveTextToUci(CASTLING, 'O-O')).toBe('e1g1');
  });

  it('reads UCI, promotion letter included', () => {
    expect(moveTextToUci(START, 'g1f3')).toBe('g1f3');
    expect(moveTextToUci(PROMOTING, 'e7e8q')).toBe('e7e8q');
  });

  it('reads SAN promotion', () => {
    expect(moveTextToUci(PROMOTING, 'e8=Q')).toBe('e7e8q');
  });

  it('tolerates check and mate suffixes', () => {
    expect(moveTextToUci(START, 'e4+')).toBe('e2e4');
  });

  it('refuses what is not legal here', () => {
    expect(moveTextToUci(START, 'Nf6')).toBeNull(); // black's move
    expect(moveTextToUci(START, 'e5')).toBeNull(); // too far
    expect(moveTextToUci(START, 'e2e5')).toBeNull(); // illegal UCI
    expect(moveTextToUci(START, 'xyzzy')).toBeNull();
    expect(moveTextToUci(START, '')).toBeNull();
  });

  it('refuses garbage FEN without throwing', () => {
    expect(moveTextToUci('not a fen', 'e4')).toBeNull();
  });
});
