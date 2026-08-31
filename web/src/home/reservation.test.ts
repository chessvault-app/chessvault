import { describe, expect, it } from 'vitest';
import {
  continueReservation,
  MAX_ROWS,
  parseContinueShape,
  shownOnDesktop,
  WELCOME_SHAPE,
  type ContinueShape,
} from './reservation.ts';

/** What HomePage writes at the end of a launch, spelled once. */
const stored = (shape: ContinueShape): string => JSON.stringify(shape);

/** Everything that means "this device stored nothing readable". */
const NOTHING_STORED = [null, '', '{', 'null', '42', '"three"', '[]', '{}', '{"board":true}'];

describe('parseContinueShape', () => {
  it('round-trips what a launch stores', () => {
    const shape: ContinueShape = { rows: 3, mdRows: 2, board: true };
    expect(parseContinueShape(stored(shape))).toEqual(shape);
  });

  it('reads a card with all four rows', () => {
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
    const big = parseContinueShape(stored({ rows: 9, mdRows: 9, board: false }));
    expect(big?.rows).toBe(MAX_ROWS);
    expect(big?.mdRows).toBe(MAX_ROWS);
  });

  it('never reads more desktop rows than the card has', () => {
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

  it('keeps an empty card distinct from a device it has never seen', () => {
    // The distinction the whole default turns on. Both used to read as
    // null, which would have made "seen, and there was no card" fall back
    // to the welcome shape and draw a placeholder at somebody who has no
    // Continue card at all — on every launch, not once.
    expect(parseContinueShape(stored({ rows: 0, mdRows: 0, board: false }))).toEqual({
      rows: 0,
      mdRows: 0,
      board: false,
    });
    for (const raw of NOTHING_STORED) expect(parseContinueShape(raw)).toBeNull();
  });

  it('learns nothing from a count that is not one', () => {
    for (const rows of [-1, 2.5, '2', null, NaN]) {
      expect(parseContinueShape(JSON.stringify({ rows }))).toBeNull();
    }
  });

  it('takes a board flag only when it was actually stored', () => {
    expect(parseContinueShape(JSON.stringify({ rows: 1 }))?.board).toBe(false);
    expect(parseContinueShape(JSON.stringify({ rows: 1, board: 'yes' }))?.board).toBe(false);
  });
});

describe('continueReservation', () => {
  it('reserves what this device saw last time', () => {
    const shape: ContinueShape = { rows: 4, mdRows: 2, board: true };
    expect(continueReservation(stored(shape))).toEqual(shape);
  });

  it('reserves the vault floor for a device it has never seen', () => {
    // A new phone, a new browser, a private window, a cleared store: an
    // established vault meeting a device with no memory of it. Every vault
    // is seeded with the welcome study, so there IS a card — reserving
    // nothing here was the old behaviour and it was wrong every time.
    for (const raw of NOTHING_STORED) expect(continueReservation(raw)).toEqual(WELCOME_SHAPE);
  });

  it('reserves nothing for a vault that really has no card', () => {
    // The welcome study deleted, no game, no training, nothing due. This
    // device HAS been seen, so its answer stands against the default —
    // otherwise it draws a placeholder for a card that never comes, which
    // is the one flicker worse than the one being fixed.
    expect(continueReservation(stored({ rows: 0, mdRows: 0, board: false }))).toBeNull();
  });

  it('is what a fresh vault goes on to store, so the first launch is not a guess', () => {
    // The floor is not a number picked to be safe: it is the shape the
    // welcome study produces, which is what the launch it stands in for
    // writes back. Measured on this repo's own vault.
    expect(WELCOME_SHAPE).toEqual({ rows: 1, mdRows: 0, board: true });
    expect(continueReservation(stored(WELCOME_SHAPE))).toEqual(WELCOME_SHAPE);
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

  it('draws the welcome vault on both, which is why its floor is worth reserving', () => {
    expect(shownOnDesktop(WELCOME_SHAPE)).toBe(true);
    expect(WELCOME_SHAPE.rows).toBeGreaterThan(0);
  });
});
