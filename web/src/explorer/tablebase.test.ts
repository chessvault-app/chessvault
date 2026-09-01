import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from 'chessops/fen';
import { categoryTone, inTablebaseRange } from './tablebase';

describe('inTablebaseRange', () => {
  it('lets through what a table can hold', () => {
    expect(inTablebaseRange('8/8/8/4k3/8/8/8/K1Q5 w - - 0 1')).toBe(true);
    // Seven exactly, which is where Syzygy stops.
    expect(inTablebaseRange('8/8/8/4k3/8/8/PPP5/KQ6 b - - 0 1')).toBe(true);
  });

  it('keeps the request from being made at all otherwise', () => {
    expect(inTablebaseRange(INITIAL_FEN)).toBe(false);
    expect(inTablebaseRange('8/8/8/4k3/8/8/PPPPP3/KQ6 w - - 0 1')).toBe(false);
    // Small, legal, and not in any table: they are built without castling.
    expect(inTablebaseRange('8/8/8/8/8/8/8/R3K2k w Q - 0 1')).toBe(false);
    expect(inTablebaseRange('not a position')).toBe(false);
  });
});

describe('categoryTone', () => {
  it('paints only a settled result', () => {
    expect(categoryTone('win')).toBe('good');
    expect(categoryTone('loss')).toBe('bad');
    // The fifty-move pair END in a draw, whatever the pieces say, so they
    // wear the draw's colour rather than the one they are named after.
    expect(categoryTone('cursed-win')).toBe('neutral');
    expect(categoryTone('blessed-loss')).toBe('neutral');
    expect(categoryTone('draw')).toBe('neutral');
  });
});
