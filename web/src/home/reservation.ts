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
 * desktop's are not the same card. The repertoire reminder is phone-only,
 * and the board, drawn at every width, is not a row at all. One count
 * reserved the PHONE's rows on a desktop, so the page settled upwards by
 * as much as two rows — a jump in the other direction is not an
 * improvement on the jump it replaced.
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
  /** Whether the card leads with the last study's position. */
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
 * study, whose first chapter has a position (server/welcome.ts). So every
 * width draws its board and no rows.
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
export const WELCOME_SHAPE: ContinueShape = { rows: 0, mdRows: 0, board: true };

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
  // A board with no rows under it is still a card, at every width.
  return stored.rows > 0 || stored.board ? stored : null;
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

/**
 * What the DESKTOP dashboard looked like last launch, on exactly the
 * bargain the Continue card above is reserved on: a paint hint, never the
 * authority, wrong by at most one launch and corrected by whatever the
 * vault says.
 *
 * The dashboard used to reserve nothing, and the argument for that was
 * written down: it waits for both answer batches so the grid lands once
 * instead of reflowing panel by panel, and the single re-centre this costs
 * is the beat the phone already absorbs for Continue. The first half is
 * still true and is why there is one shape here and not one per batch. The
 * second half was finally measured and is not true. The launcher is
 * CENTRED in its column, so an unreserved grid does not push the page
 * down — it moves everything on the page by half the grid's height, and
 * what moved furthest was the Continue card, the one thing here that had
 * been reserved to the pixel. Measured at 1920x1080 against the demo
 * vault: the block grew 274 → 885px as the grid landed and the Continue
 * card jumped 306px UP the screen. A reservation that is undone by the
 * panel below it is not a reservation.
 *
 * Four counts and not one total, because the panels are conditional and a
 * total cannot say which of them to draw: three Training rows and three
 * Recent work rows are not the same three, and the panels sit in a
 * two-column grid whose row heights come from which panel is beside
 * which.
 */
export interface DashShape {
  /** Rows the Training panel drew: solved today, review due, repertoire due. */
  training: number;
  /** Rows the Recent games panel drew. */
  games: number;
  /** Rows the Puzzle books panel drew — the tall ones, each with a cover. */
  books: number;
  /** Rows the Recent work panel drew. */
  docs: number;
}

/**
 * The most rows each panel can hold — the Training panel's three
 * conditions, and the `slice` each of the other three lists is cut to in
 * HomePage. Same purpose as MAX_ROWS above: a stored count past the end is
 * clamped to something roughly right rather than dropped for being wrong,
 * because dropping it takes the reservation away from the fullest vault,
 * which is the one that needs it most.
 */
export const DASH_MAX: DashShape = { training: 3, games: 5, books: 3, docs: 5 };

/** The panels, in the order the grid lays them out. */
export const DASH_PANELS = ['training', 'games', 'books', 'docs'] as const;

/** Total rows in a shape — what tells a drawn dashboard from an empty one. */
export const dashRows = (shape: DashShape): number =>
  DASH_PANELS.reduce((n, panel) => n + shape[panel], 0);

/**
 * What a vault holds before anybody has done anything with it, as this
 * grid draws it: the welcome study is a recent document, and nothing else
 * on this page exists yet — no games, no books, and a trainer that has
 * never been opened says nothing.
 *
 * A floor rather than a guess, and paid for by the same case WELCOME_SHAPE
 * is: not the first launch of a new vault, which happens once, but an
 * established vault meeting a device that has never seen it — a new phone,
 * a new browser, a private window, a cleared store. A richer vault than
 * this is under-reserved and still moves, by less than the whole grid.
 */
export const WELCOME_DASH: DashShape = { training: 0, games: 0, books: 0, docs: 1 };

/** A stored count as a count: a whole number of rows, clamped, or none. */
const dashCount = (v: unknown, max: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0;

/**
 * The dashboard shape a device stored, or null if it stored nothing
 * readable.
 *
 * "Readable" is at least one of the four counts being a number. An object
 * with none of them is a shape from some other version of this page and
 * says nothing about this one — the same reading as `{}` for the card
 * above, and the difference that keeps a device which has genuinely never
 * been here from being mistaken for one whose dashboard was empty.
 */
export function parseDashShape(raw: string | null): DashShape | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof stored !== 'object' || stored === null) return null;
  const value = stored as Partial<DashShape>;
  if (!DASH_PANELS.some((panel) => typeof value[panel] === 'number')) return null;
  return {
    training: dashCount(value.training, DASH_MAX.training),
    games: dashCount(value.games, DASH_MAX.games),
    books: dashCount(value.books, DASH_MAX.books),
    docs: dashCount(value.docs, DASH_MAX.docs),
  };
}

/**
 * What this launch reserves for the dashboard, or nothing.
 *
 * The same three cases as `continueReservation`, for the same reasons: a
 * device that has been here reserves what it saw, a device that was here
 * and saw an empty dashboard reserves nothing — the "nothing to show yet"
 * card is a single panel of prose, not a grid, and reserving four panels
 * for it would be the jump in the other direction — and a device that has
 * never been here reserves the floor every vault starts at.
 */
export function dashReservation(raw: string | null): DashShape | null {
  const stored = parseDashShape(raw);
  if (stored === null) return WELCOME_DASH;
  return dashRows(stored) > 0 ? stored : null;
}

/**
 * Whether the setup checklist was on screen last launch.
 *
 * The third and last thing on this page that arrives with the vault's
 * answer and used to arrive unreserved. It is a boolean and not a count
 * because the list is three fixed steps: it is drawn whole or not at all.
 * Measured at 1920x1080: 161px with its margin, which on a centred page is
 * 81px of movement for everything else.
 *
 * A device that has never been here reserves NOTHING, and this is the one
 * place that deliberately disagrees with WELCOME_DASH above. That floor is
 * a floor because every vault is seeded with the welcome study, so the
 * shape it reserves is one the vault certainly has. The checklist is the
 * opposite: it exists only until the three steps are done and then never
 * again, so on the case these floors are chosen for — an established vault
 * meeting a new phone, a new browser, a private window — it is far more
 * likely absent than present. Reserving it there would invent a card for
 * the many to save a jump for the few.
 *
 * Unreadable reads the same as absent, on the same bargain as everything
 * else here: this is a paint hint, and the launch it is wrong about
 * overwrites it.
 */
export const checklistReservation = (raw: string | null): boolean => raw === '1';

/** What a launch stores for the reader above. */
export const storedChecklist = (shown: boolean): string => (shown ? '1' : '0');
