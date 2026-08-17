import { describe, expect, it } from 'vitest';
import { terminalScore } from './terminal';

describe('terminalScore', () => {
  it('is null for a position with moves left', () => {
    expect(terminalScore('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
  });

  it('scores mate against the side to move', () => {
    // Fool's mate: White is to move and has been checkmated, so Black is
    // winning — a NEGATIVE mate in White's point of view.
    expect(
      terminalScore('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'),
    ).toEqual({ mate: -1 });
    // The mirror: Black to move and mated reads positive.
    expect(terminalScore('7k/5KQ1/8/8/8/8/8/8 b - - 0 1')).toEqual({ mate: 1 });
  });

  it('scores every other ending as a draw', () => {
    // Stalemate: Black to move, no legal move, not in check.
    expect(terminalScore('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ cp: 0 });
    // Two bare kings — dead by insufficient material.
    expect(terminalScore('7k/8/6K1/8/8/8/8/8 w - - 0 1')).toEqual({ cp: 0 });
  });

  it('treats a FEN it cannot read as unfinished rather than throwing', () => {
    // A render path calls this; a bad position must not take the page down.
    expect(terminalScore('not a fen')).toBeNull();
    expect(terminalScore('8/8/8/8/8/8/8/8 w - - 0 1')).toBeNull(); // no kings
  });
});
