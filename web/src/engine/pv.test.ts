import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from '@shared/tree';
import { formatPv } from './pv.ts';

/**
 * The pane renders engine lines from this and nothing else, and the plies
 * it hands back are now click targets — a wrong FEN on one of them puts a
 * move on somebody's board that the engine never suggested.
 */
describe('formatPv', () => {
  it('numbers White’s moves and reads the line from the position given', () => {
    const pv = formatPv(INITIAL_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6']);

    expect(pv.text).toBe('1. e4 e5 2. Nf3 Nc6');
    expect(pv.firstSan).toBe('e4');
    expect(pv.plies.map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    // A number before each of White's moves, and nowhere else.
    expect(pv.plies.map((p) => p.number)).toEqual(['1.', undefined, '2.', undefined]);
  });

  it('marks a line that starts on Black’s move, once', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const pv = formatPv(fen, ['e7e5', 'g1f3']);

    expect(pv.text).toBe('1... e5 2. Nf3');
    expect(pv.plies.map((p) => p.number)).toEqual(['1...', '2.']);
  });

  it('gives every ply the position it leads to', () => {
    const pv = formatPv(INITIAL_FEN, ['e2e4', 'e7e5']);

    expect(pv.plies[0]!.fen).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    );
    expect(pv.plies[1]!.fen).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    );
    // The uci is kept as the engine spelled it — that is what gets replayed.
    expect(pv.plies.map((p) => p.uci)).toEqual(['e2e4', 'e7e5']);
  });

  it('highlights the square the king lands on when castling', () => {
    const fen = 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

    // The king-destination spelling, and the king-takes-rook one chessops
    // uses internally: both have to light up g1, never h1.
    for (const uci of ['e1g1', 'e1h1']) {
      const pv = formatPv(fen, [uci]);
      expect(pv.plies[0]!.san).toBe('O-O');
      expect(pv.plies[0]!.squares).toEqual(['e1', 'g1']);
    }
  });

  it('stops at the first move that will not play, keeping what came before', () => {
    const pv = formatPv(INITIAL_FEN, ['e2e4', 'e7e5', 'e2e4']);

    expect(pv.plies.map((p) => p.san)).toEqual(['e4', 'e5']);
    expect(pv.text).toBe('1. e4 e5');
  });

  it('falls back to the raw line when the position will not parse', () => {
    const pv = formatPv('not a fen', ['e2e4', 'e7e5']);

    expect(pv.text).toBe('e2e4 e7e5');
    expect(pv.firstSan).toBeUndefined();
    // No plies means no click targets — the caller shows the text instead.
    expect(pv.plies).toEqual([]);
  });

  it('is empty for an empty line', () => {
    expect(formatPv(INITIAL_FEN, [])).toEqual({ text: '', plies: [] });
  });
});
