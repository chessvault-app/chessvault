import { describe, expect, it } from 'vitest';
import { MAX_ROWS, parseContinueShape, shownOnDesktop, type ContinueShape } from './reservation.ts';

/** What HomePage writes at the end of a launch, spelled once. */
const stored = (shape: ContinueShape): string => JSON.stringify(shape);

describe('parseContinueShape', () => {
  it('round-trips what a launch stores', () => {
    const shape: ContinueShape = { rows: 3, mdRows: 2, board: true };
    expect(parseContinueShape(stored(shape))).toEqual(shape);
  });

  it('reserves a card with all four rows', () => {
    // The regression this module was extracted for. The reader capped at
    // three and answered 0 above it, so a vault with a last study, a last
    // game, training under way and a repertoire due — the fullest card,
    // belonging to the reader who returns most — reserved nothing, and the
    // whole card pushed the page down a beat after first paint.
    expect(parseContinueShape(stored({ rows: 4, mdRows: 2, board: true }))).toEqual({
      rows: 4,
      mdRows: 2,
      board: true,
    });
  });

  it('clamps a count no card could have rather than dropping it', () => {
    // Roughly right beats absent: this is a paint hint, and the next
    // launch overwrites it with the truth either way.
    expect(parseContinueShape(stored({ rows: 9, mdRows: 9, board: false }))?.rows).toBe(MAX_ROWS);
    expect(parseContinueShape(stored({ rows: 9, mdRows: 9, board: false }))?.mdRows).toBe(MAX_ROWS);
  });

  it('never reserves more desktop rows than the card has', () => {
    // The desktop hides a subset of the phone's rows, so mdRows > rows is
    // not a shape any launch can produce — only a corrupted one.
    expect(parseContinueShape(stored({ rows: 1, mdRows: 4, board: false }))?.mdRows).toBe(1);
  });

  it('reads no desktop rows as a real answer, not a missing one', () => {
    // A board and a repertoire reminder: the phone draws two rows, the
    // desktop draws the board and none.
    expect(parseContinueShape(stored({ rows: 2, mdRows: 0, board: true }))).toEqual({
      rows: 2,
      mdRows: 0,
      board: true,
    });
  });

  it('reserves nothing when there is nothing to reserve', () => {
    // A fresh vault, a fresh device, a cleared store, junk, and a shape
    // some later version wrote — all one answer: draw no placeholder.
    for (const raw of [
      null,
      '',
      '{',
      'null',
      '42',
      '"three"',
      '{}',
      stored({ rows: 0, mdRows: 0, board: false }),
      JSON.stringify({ rows: -1 }),
      JSON.stringify({ rows: 2.5 }),
      JSON.stringify({ rows: '2' }),
    ]) {
      expect(parseContinueShape(raw)).toBeNull();
    }
  });

  it('takes a board flag only when it was actually stored', () => {
    expect(parseContinueShape(JSON.stringify({ rows: 1 }))?.board).toBe(false);
    expect(parseContinueShape(JSON.stringify({ rows: 1, board: 'yes' }))?.board).toBe(false);
  });
});

describe('shownOnDesktop', () => {
  it('draws a card that has a board or a row of its own', () => {
    expect(shownOnDesktop({ mdRows: 0, board: true })).toBe(true);
    expect(shownOnDesktop({ mdRows: 2, board: false })).toBe(true);
  });

  it('draws no heading over nothing', () => {
    // Only a repertoire reminder, which is phone-only: at desktop width
    // this card is a "Continue" bar with an empty box under it.
    expect(shownOnDesktop({ mdRows: 0, board: false })).toBe(false);
  });
});
