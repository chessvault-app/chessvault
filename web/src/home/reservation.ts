/**
 * What the Continue card looked like last launch, so this launch can
 * reserve its space before the data lands.
 *
 * Home asks nine endpoints before it knows what Continue holds, and the
 * card is the first thing on the page: with nothing standing in its place
 * it appears a beat after first paint and pushes everything under it down.
 * This is the hint that stops that — a paint hint and never the authority,
 * on the same bargain as the layout echo. It is wrong by at most one
 * launch, and corrected by whatever the vault says.
 *
 * Three facts rather than one count, because the phone's card and the
 * desktop's are not the same card. The board is desktop-only; the
 * repertoire reminder is phone-only, as is the last study once there is a
 * board above to say the same thing. One count reserved the PHONE's rows
 * on a desktop, so the page settled upwards by as much as two rows — a
 * jump in the other direction is not an improvement on the jump it
 * replaced.
 *
 * Kept out of HomePage.tsx and free of React so it can be tested: the
 * repo's vitest runs in a node environment over `.ts` files, and both bugs
 * this module was extracted for (see MAX_ROWS and WELCOME_SHAPE) were ones
 * a test would have caught the day they were written.
 */

export interface ContinueShape {
  /** Rows the phone draws — every row the card has. */
  rows: number;
  /** Rows a desktop draws: the phone's, less the ones it hides. Legitimately
      0, for a card that is a board and a repertoire reminder and nothing
      else. Never more than `rows`, since the desktop hides a subset. */
  mdRows: number;
  /** Whether the desktop card leads with the last study's position. */
  board: boolean;
}

/**
 * The most rows Continue can hold: last study, last game, resume training,
 * repertoire due.
 *
 * A stored number above it is clamped rather than thrown away, and that is
 * the whole point of the constant. The reader used to reject anything over
 * THREE — so the one reader with all four, the most-returning user this
 * card exists for, reserved nothing at all and watched the entire card
 * push the page down on every launch. A hint is allowed to be roughly
 * right; it is not allowed to go silent exactly where it is needed.
 */
export const MAX_ROWS = 4;

/**
 * What a vault holds before anybody has done anything with it: the welcome
 * study, whose first chapter has a position (server/welcome.ts). So a
 * desktop draws its board and no rows, and a phone draws the one row.
 *
 * This is the reservation for a device with no stored hint, and it is a
 * floor rather than a guess. The reasoning it replaced was that an unknown
 * device should reserve nothing, since a placeholder for a card that turns
 * out not to exist is a worse flicker than one that pops in — true enough,
 * but it assumed the unknown case might have no card. It cannot: every
 * vault is seeded with that study, so the card exists from a vault's first
 * second and this shape is its minimum.
 *
 * Which also means the case being paid for is not the first launch of a
 * new vault, which happens once. It is a new phone, a new browser, a
 * private window, a cleared store — an established vault meeting a device
 * that has never seen it, which recurs for as long as somebody uses the
 * app. A richer vault than this is under-reserved and still moves, but by
 * less than the whole card.
 */
export const WELCOME_SHAPE: ContinueShape = { rows: 1, mdRows: 0, board: true };

/** A stored count as a count: a whole number of rows, capped, or none. */
const rowCount = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_ROWS) : 0;

/**
 * The shape a device stored, or null if it stored nothing readable.
 *
 * `{ rows: 0 }` is a shape and not a nothing — it is a vault that HAS been
 * seen and had no card, which is a different answer from never having been
 * seen, and the difference is what keeps `continueReservation` from
 * drawing a placeholder at somebody who genuinely has no Continue card.
 * Absent, unparseable, and a shape from some later version all read as
 * null: nothing was learned about this device.
 */
export function parseContinueShape(raw: string | null): ContinueShape | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof stored !== 'object' || stored === null) return null;
  const value = stored as Partial<ContinueShape>;
  if (typeof value.rows !== 'number' || !Number.isInteger(value.rows) || value.rows < 0) return null;
  const rows = Math.min(value.rows, MAX_ROWS);
  return { rows, mdRows: Math.min(rowCount(value.mdRows), rows), board: value.board === true };
}

/**
 * What to reserve on this launch, or nothing.
 *
 * The three cases the card turns on, and they are three and not two: a
 * device that has been here reserves what it saw, a device that has been
 * here and saw no card reserves nothing, and a device that has never been
 * here reserves the floor every vault starts at.
 */
export function continueReservation(raw: string | null): ContinueShape | null {
  const stored = parseContinueShape(raw);
  if (stored === null) return WELCOME_SHAPE;
  return stored.rows > 0 ? stored : null;
}

/**
 * Whether the desktop draws this card at all.
 *
 * A card whose every row is phone-only — a repertoire reminder on its own
 * — is a "Continue" heading over nothing at that width, so both the
 * placeholder and the card itself are hidden there rather than reserving
 * and then drawing an empty box.
 */
export const shownOnDesktop = (shape: Pick<ContinueShape, 'mdRows' | 'board'>): boolean =>
  shape.board || shape.mdRows > 0;
