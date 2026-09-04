import { describe, expect, it } from 'vitest';
import {
  checklistReservation,
  continueReservation,
  DASH_MAX,
  dashReservation,
  dashRows,
  MAX_ROWS,
  parseContinueShape,
  parseDashShape,
  shownOnDesktop,
  storedChecklist,
  WELCOME_DASH,
  WELCOME_SHAPE,
  type ContinueShape,
  type DashShape,
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
    // A board over two phone-only reminders: the phone draws the rows, the
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
    expect(WELCOME_SHAPE).toEqual({ rows: 0, mdRows: 0, board: true });
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
    expect(WELCOME_SHAPE.board).toBe(true);
  });
});

/** What a launch writes for the dashboard, spelled once. */
const storedDash = (shape: DashShape): string => JSON.stringify(shape);

describe('parseDashShape', () => {
  it('round-trips what a launch stores', () => {
    const shape: DashShape = { training: 3, games: 5, books: 1, docs: 5 };
    expect(parseDashShape(storedDash(shape))).toEqual(shape);
  });

  it.each(NOTHING_STORED)('learns nothing from %j', (raw) => {
    expect(parseDashShape(raw)).toBeNull();
  });

  it('reads a shape that names only some of its panels', () => {
    // A vault with games and nothing else is a real vault, and the panels
    // it does not have are absent from the object rather than zero in it
    // only if some future launch writes them that way. Either spelling has
    // to answer the same, or a reader with one full panel reserves nothing.
    expect(parseDashShape('{"games":4}')).toEqual({ training: 0, games: 4, books: 0, docs: 0 });
  });

  it('clamps a count no panel could have rather than dropping it', () => {
    const big = parseDashShape(storedDash({ training: 9, games: 9, books: 9, docs: 9 }));
    expect(big).toEqual(DASH_MAX);
  });

  it('reads a dashboard with every panel full', () => {
    // The same regression MAX_ROWS exists for, one page down: the fullest
    // vault is the one whose grid is tallest, so it is the one whose
    // launch moves the page furthest when nothing is reserved.
    expect(parseDashShape(storedDash(DASH_MAX))).toEqual(DASH_MAX);
    expect(dashRows(DASH_MAX)).toBe(16);
  });

  it('rejects a count that is not a whole number of rows', () => {
    expect(parseDashShape('{"games":2.5}')?.games).toBe(0);
    expect(parseDashShape('{"games":-1}')?.games).toBe(0);
  });
});

describe('dashReservation', () => {
  it('reserves what this device saw last launch', () => {
    const shape: DashShape = { training: 2, games: 5, books: 0, docs: 3 };
    expect(dashReservation(storedDash(shape))).toEqual(shape);
  });

  it('reserves nothing for a vault seen to have no dashboard', () => {
    // Not the same answer as "never been here": this vault's grid is the
    // one "nothing to show yet" card, and four placeholder panels for it
    // would be the jump this whole module exists to remove.
    expect(dashReservation(storedDash({ training: 0, games: 0, books: 0, docs: 0 }))).toBeNull();
  });

  it.each(NOTHING_STORED)('reserves the welcome floor on a device that stored %j', (raw) => {
    expect(dashReservation(raw)).toEqual(WELCOME_DASH);
  });

  it('reserves a floor that is the shape the welcome study makes', () => {
    // The welcome study is a recent document and nothing else: no games,
    // no books, and a trainer nobody has opened reports nothing.
    expect(WELCOME_DASH).toEqual({ training: 0, games: 0, books: 0, docs: 1 });
    expect(dashRows(WELCOME_DASH)).toBeGreaterThan(0);
    expect(dashReservation(storedDash(WELCOME_DASH))).toEqual(WELCOME_DASH);
  });
});

describe('checklistReservation', () => {
  it('round-trips a launch that drew the checklist', () => {
    expect(checklistReservation(storedChecklist(true))).toBe(true);
    expect(checklistReservation(storedChecklist(false))).toBe(false);
  });

  it.each(NOTHING_STORED)('reserves nothing on a device that stored %j', (raw) => {
    // The one floor on this page that is `false` rather than the shape a
    // fresh vault makes: the checklist is finished with for good once its
    // three steps are done, so an established vault meeting a new device
    // is far more likely not to have it. See reservation.ts.
    expect(checklistReservation(raw)).toBe(false);
  });
});
