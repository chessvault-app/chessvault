/**
 * What the puzzle dashboard looked like last visit, so this visit can
 * reserve its three variable blocks before the answers land — on
 * home/reservation.ts's bargain exactly: a paint hint, never the
 * authority, wrong by at most one visit, corrected by whatever the
 * vault says.
 *
 * Three facts, because the page has three blocks whose shape the
 * answers decide, and they are not one question:
 *
 *  - the review slot settles as one of two shapes — a button (review
 *    when something is due or failed, train otherwise), or that button
 *    with a one-line "next review lands…" note under it — and the note
 *    is the taller one, so a schedule with nothing due used to shove
 *    when its line arrived;
 *  - the Books panel draws one row per book, or a whole EmptyState
 *    when there are none — which is TALLER than the three rows it used
 *    to reserve, so the empty case (every vault that has never imported
 *    a scan) moved in the wrong direction;
 *  - the attempts list draws up to a hard 384px of rows, or a one-line
 *    note, against a flat guess of five.
 *
 * Kept out of DashboardPage.tsx and free of React so it can be tested,
 * for the same reason home's module is.
 */

export interface DashboardShape {
  /** Which shape the review slot settled as. The three buttons are one
      case: same box, different words. `note` is that box plus a line. */
  review: 'button' | 'note';
  /** Rows the Books panel drew. 0 is the EmptyState, not nothing. */
  books: number;
  /** Rows the attempts list drew. 0 is its one-line note. */
  attempts: number;
}

/**
 * The most book rows worth reserving. The panel itself is uncapped, but
 * a hint only has to hold the fold still — past eight rows the jump the
 * reservation prevents is below the fold of every supported height. A
 * stored count above it is clamped, not dropped (MAX_ROWS's argument:
 * dropping takes the reservation from the fullest vault, which needs it
 * most).
 */
export const MAX_BOOKS = 8;

/**
 * The most attempt rows worth reserving: the list's own ceiling. Its
 * scroller is max-h-96 — 384px — and a dense row is 33px, so twelve
 * rows fill it; the reservation wraps in the same ceiling, which makes
 * any count past this a layout no-op.
 */
export const MAX_ATTEMPTS = 12;

/**
 * What a device that has never seen this vault reserves: what a fresh
 * vault certainly has, which on this page is the Train button and
 * nothing else — no schedule under it, no books (the EmptyState), no
 * attempts (the one-line note). Unlike home's WELCOME_SHAPE there is no
 * seeded content here to raise the floor: the welcome study puts
 * nothing on this page.
 */
export const FRESH_DASHBOARD: DashboardShape = { review: 'button', books: 0, attempts: 0 };

const count = (v: unknown, max: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0;

/**
 * The shape a device stored, or the floor if it stored nothing
 * readable. Absent, unparseable, and a shape from some later version
 * all read as the floor — nothing was learned about this device, and
 * the floor is also what the unknown vault most likely holds.
 */
export function parseDashboardShape(raw: string | null): DashboardShape {
  if (raw === null) return FRESH_DASHBOARD;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return FRESH_DASHBOARD;
  }
  if (typeof stored !== 'object' || stored === null) return FRESH_DASHBOARD;
  const value = stored as Partial<DashboardShape>;
  return {
    review: value.review === 'note' ? 'note' : 'button',
    books: count(value.books, MAX_BOOKS),
    attempts: count(value.attempts, MAX_ATTEMPTS),
  };
}

/** What a settled page stores for the reader above. */
export const storedDashboardShape = (shape: DashboardShape): string => JSON.stringify(shape);
