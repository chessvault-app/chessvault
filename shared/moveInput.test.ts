import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from 'chessops/fen';
import { typedMove } from './moveInput';

// White can castle both ways; a pawn stands on e7 ready to promote on e8
// (nothing on e8), and two knights (b1, f1) can each reach d2.
const CASTLE_FEN = 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPPBPPP/RNBQK2R w KQkq - 0 1';
const PROMO_FEN = '8/4P3/8/8/8/8/8/k5K1 w - - 0 1';
const TWO_KNIGHTS_FEN = 'k7/8/8/8/8/8/8/KN3N2 w - - 0 1';

describe('typedMove', () => {
  it('reads plain SAN and returns both notations', () => {
    expect(typedMove(INITIAL_FEN, 'Nf3')).toEqual({ uci: 'g1f3', san: 'Nf3' });
    expect(typedMove(INITIAL_FEN, ' e4 ')).toEqual({ uci: 'e2e4', san: 'e4' });
  });

  it('reads UCI', () => {
    expect(typedMove(INITIAL_FEN, 'e2e4')?.san).toBe('e4');
    expect(typedMove(INITIAL_FEN, 'G1F3')?.san).toBe('Nf3');
    expect(typedMove(PROMO_FEN, 'e7e8q')).toEqual({ uci: 'e7e8q', san: 'e8=Q' });
  });

  it('reads figurines and lowercase piece letters', () => {
    expect(typedMove(INITIAL_FEN, '♘f3')?.san).toBe('Nf3');
    expect(typedMove(INITIAL_FEN, '♞c3')?.san).toBe('Nc3');
    expect(typedMove(INITIAL_FEN, 'nf3')?.san).toBe('Nf3');
    // A leading b is the pawn, never guessed as the bishop.
    expect(typedMove(INITIAL_FEN, 'b3')?.san).toBe('b3');
  });

  it('ignores check, mate and annotation marks', () => {
    expect(typedMove(INITIAL_FEN, 'e4!?')?.san).toBe('e4');
    expect(typedMove(INITIAL_FEN, 'Nf3+')?.san).toBe('Nf3');
    expect(typedMove(PROMO_FEN, 'e8=Q#')?.san).toBe('e8=Q');
  });

  it('reads castling in every spelling', () => {
    for (const s of ['O-O', '0-0', 'o-o', 'O-O+']) {
      expect(typedMove(CASTLE_FEN, s)).toEqual({ uci: 'e1g1', san: 'O-O' });
    }
    expect(typedMove(CASTLE_FEN, '0-0-0')).toBeNull();
  });

  it('reads promotions with and without the equals sign', () => {
    expect(typedMove(PROMO_FEN, 'e8=Q')?.uci).toBe('e7e8q');
    expect(typedMove(PROMO_FEN, 'e8Q')?.uci).toBe('e7e8q');
    expect(typedMove(PROMO_FEN, 'e8n')?.uci).toBe('e7e8n');
    expect(typedMove(PROMO_FEN, 'e8')).toBeNull();
  });

  it('refuses what is illegal, ambiguous or unreadable', () => {
    expect(typedMove(INITIAL_FEN, 'Ke2')).toBeNull();
    expect(typedMove(INITIAL_FEN, 'e5')).toBeNull();
    expect(typedMove(INITIAL_FEN, 'nonsense')).toBeNull();
    expect(typedMove(INITIAL_FEN, '')).toBeNull();
    expect(typedMove(TWO_KNIGHTS_FEN, 'Nd2')).toBeNull();
    expect(typedMove(TWO_KNIGHTS_FEN, 'Nbd2')?.uci).toBe('b1d2');
    expect(typedMove('not a fen', 'e4')).toBeNull();
  });
});
