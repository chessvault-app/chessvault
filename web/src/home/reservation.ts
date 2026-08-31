/**
 * What the Continue card looked like last launch, so this launch can
 * reserve its space before the data lands.
 *
 * Home asks nine endpoints before it knows what Continue holds, and the
 * card is the first thing on the page: with nothing standing in its place
 * it appears a beat after first paint and pushes everything under it down.
 * This is the hint that stops that — a paint hint and never the authority,
 * on the same bargain as the layout echo. It is wrong by at most one
 * launch, and a device that has never opened this page reserves nothing,
 * because a skeleton card that turns out to have no card behind it is a
 * worse flicker than the one it was drawn to prevent.
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
 * repo's vitest runs in a node environment over `.ts` files, and the bug
 * this module exists to fix (see MAX_ROWS) was one a test would have
 * caught the day it was written.
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

/** A stored count as a count: a whole number of rows, capped, or none. */
const rowCount = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, MAX_ROWS) : 0;

/**
 * The stored hint, or nothing to reserve.
 *
 * Nothing is the answer for an absent key, junk, a shape from some future
 * version that does not parse, and a card that had no rows last launch —
 * all of which mean the same thing here: draw no placeholder.
 */
export function parseContinueShape(raw: string | null): ContinueShape | null {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
  const value = stored as Partial<ContinueShape> | null;
  const rows = rowCount(value?.rows);
  if (rows === 0) return null;
  return { rows, mdRows: Math.min(rowCount(value?.mdRows), rows), board: value?.board === true };
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
