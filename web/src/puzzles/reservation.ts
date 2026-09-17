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
 *    note, against a flat guess of five;
 *  - and the Training panel ends on a sentence reconciling Attempts with
 *    the pool, said only where the two numbers differ, so on the vaults
 *    that do differ the panel grew by it when the answers landed.
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
  /** Rows the attempts list drew. 0 is its one-line note, and it is also
      what says the filter row above the list stood: that row is drawn over
      a list and never over the note, so zero reserves neither. */
  attempts: number;
  /** Whether the panel ended on the reconciling sentence, which is said
      only where Attempts and the pool disagree. */
  reconcile: boolean;
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
export const FRESH_DASHBOARD: DashboardShape = {
  review: 'button',
  books: 0,
  attempts: 0,
  // A fresh vault's counts agree at zero, so the sentence is not said.
  reconcile: false,
};

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
    reconcile: value.reconcile === true,
  };
}

/** What a settled page stores for the reader above. */
export const storedDashboardShape = (shape: DashboardShape): string => JSON.stringify(shape);

/**
 * Where the dashboard keeps the shape above.
 *
 * Here rather than in DashboardPage because the OUTLINE that stands in
 * for that page reads it too (puzzles/PuzzlesView.skeleton), and it is
 * drawn before the page that writes it exists.
 */
export const DASH_SHAPE_KEY = 'vault:puzzle-dash-shape';

export const readDashboardShape = (): DashboardShape => {
  try {
    return parseDashboardShape(localStorage.getItem(DASH_SHAPE_KEY));
  } catch {
    // Storage a browser has blocked throws on the read, and a page is
    // not the place to find that out.
    return FRESH_DASHBOARD;
  }
};

/* ------------------------------------------------------------------ */

/**
 * The themes page's histogram: how many cards each group drew last
 * visit. It does not move once the puzzle database is built, so after
 * one visit the wall of seventy cards is reserved exactly.
 *
 * `[]` is a vault seen WITHOUT a database — reserve nothing, because its
 * settled page is an empty state and a wall of invented groups would be
 * the jump in the other direction. `null` is a device that has never
 * been here, and takes SkeletonThemeGroups' own 3x6 guess.
 */
export const THEMES_SHAPE_KEY = 'vault:puzzle-themes-shape';

/** Past this a group's tail is below every fold. */
const MAX_THEME_CARDS = 24;
/** The page's own group count plus the leftovers group it may add. */
const MAX_THEME_GROUPS = 16;

function parseThemesShape(raw: string | null): number[] | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(stored)) return null;
  return stored
    .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
    .slice(0, MAX_THEME_GROUPS)
    .map((n) => Math.min(n, MAX_THEME_CARDS));
}

export const readThemesShape = (): number[] | null => {
  try {
    return parseThemesShape(localStorage.getItem(THEMES_SHAPE_KEY));
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */

/**
 * One puzzle book's own shape: how many tiles its grid drew, whether a
 * cycle was open, and whether this vault has attempted anything in it
 * (which decides how long the Cycles panel's invitation is).
 *
 * Per book, because two books in one vault are not the same size. Here
 * rather than in BookPage for the reason above: the outline reads it.
 */
export const bookShapeKey = (slug: string): string => `vault:book-shape:${slug}`;

interface BookShape {
  tiles: number;
  open: boolean;
  nudge: boolean;
}

/**
 * The stored shape as a shape: a whole tile count clamped to the grid
 * guess's own 48 (the cap is the fold, not a data fact), and whether a
 * pass was open. Unreadable reads as null: nothing was learned, and the
 * blind 48-tile guess stands as it always has.
 */
function parseBookShape(raw: string | null): BookShape | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof stored !== 'object' || stored === null) return null;
  const value = stored as { tiles?: unknown; open?: unknown; nudge?: unknown };
  if (typeof value.tiles !== 'number' || !Number.isInteger(value.tiles) || value.tiles < 0)
    return null;
  return { tiles: Math.min(value.tiles, 48), open: value.open === true, nudge: value.nudge === true };
}

export const readBookShape = (slug: string): BookShape | null => {
  try {
    return parseBookShape(localStorage.getItem(bookShapeKey(slug)));
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */

/**
 * The puzzle-book shelf's own store and its own orders.
 *
 * The shelf is flat, so only `root` of the stored shape means anything
 * (components/shelf-reservation). The orders are here beside it because
 * the outline prints the chosen one in the select before Shelf.tsx's
 * chunk exists, which is the reason the library's list moved beside its
 * outline too.
 */
export const PUZZLE_SHELF_KEY = 'vault:puzzle-shelf';
export const PUZZLE_SHELF_ORDER_KEY = 'chess-vault:shelf-books';
type PuzzleBookSort = 'title' | 'puzzles' | 'progress';

/** How the book shelf is ordered. Not sortDocs: a book has no mtime or
    byte size worth ordering by - what it has is a count and a score. */
export const PUZZLE_BOOK_SORTS: readonly { value: PuzzleBookSort; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'puzzles', label: 'Puzzles' },
  { value: 'progress', label: 'Progress' },
];

/** The direction each sort starts in - the one its name means. */
export const PUZZLE_BOOK_NATURAL: Record<PuzzleBookSort, 'asc' | 'desc'> = {
  title: 'asc',
  puzzles: 'desc',
  progress: 'desc',
};
