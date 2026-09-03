/**
 * What a shelf looked like last visit — how many cards at the root, and
 * how many in each named collection — so this visit can reserve the
 * grouped list before the answer lands. home/reservation.ts's bargain:
 * a paint hint, never the authority, wrong by at most one visit,
 * corrected by whatever the vault says.
 *
 * The flat five-card guess this replaces had two blind spots. A shelf's
 * card count is per-vault, so five stood for one seeded document as
 * readily as for forty; and collection headers were never reserved at
 * all — deliberately, on the argument that the ROOT group draws none,
 * which is true and beside the point for a vault that files everything
 * into collections, where the whole grid stood a header-and-gap short
 * per collection.
 *
 * Shared by the studies and notes shelves, which hold the same grouped
 * shape; React-free so it can be tested.
 */

export interface ShelfShape {
  /** Cards in the root group, which draws no header. */
  root: number;
  /** Cards per named collection, in the shelf's own order (alphabetical).
      An entry of 0 is a real shape: a header over the one-line "Empty
      collection." note. */
  folders: number[];
  /**
   * Each card's settled height in CSS px, in the order the grouped list
   * draws them (root, then each collection), when the shelf measured
   * them last visit. Optional because older stores and the floors have
   * none, and dropped by the reader unless it has one per card.
   *
   * A pixel and not a line count, because the count is not knowable
   * from the text: a grid card gives its title two lines and its
   * excerpt two, and which of those it uses depends on the words AND
   * the column width, and a row's cards then all take the tallest
   * (shelf-card's h-full). Measured at 1280 on the demo's studies
   * shelf, eight of twelve titles wrapped and the one-line placeholder
   * stood 24px short per row; the notes shelf's one-line excerpts made
   * its placeholder 20px tall per card the other way. The same device
   * reads this at the same width nearly every time, and when it does
   * not the hint is roughly right, which is all a hint is for.
   */
  heights?: number[];
}

/** No card is taller than this; a stored height past it is not one. */
const MAX_CARD_HEIGHT = 400;

/**
 * Caps, MAX_ROWS's argument: a count past them is clamped rather than
 * dropped, because dropping takes the reservation from the fullest
 * vault. Past a dozen cards a group's tail is below every fold, and
 * past eight collections so is the next header.
 */
export const MAX_SHELF_CARDS = 12;
export const MAX_SHELF_FOLDERS = 8;

/**
 * The floor for a device that has never seen the vault: the one
 * document every vault is seeded with (server/welcome.ts puts a study
 * and a note at the root), in no collection. The same reasoning as
 * home's WELCOME_SHAPE — this is not a guess about an unknown vault but
 * the minimum every vault holds from its first second.
 */
export const WELCOME_SHELF: ShelfShape = { root: 1, folders: [] };

/**
 * The floor for a shelf nothing seeds — the book library. A device that
 * has never seen the vault reserves nothing there, because a fresh
 * vault certainly has no books and inventing cards for the many to save
 * a jump for the few is the checklist floor's mistake.
 */
export const EMPTY_SHELF: ShelfShape = { root: 0, folders: [] };

const clampCount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_SHELF_CARDS) : null;

/**
 * The shape a device stored, or the floor if it stored nothing
 * readable. `{ root: 0, folders: [] }` is a shape and not a nothing —
 * a vault seen genuinely empty settles into the shelf's EmptyState, and
 * the caller reserves nothing for it rather than inventing cards.
 */
export function parseShelfShape(raw: string | null, floor: ShelfShape = WELCOME_SHELF): ShelfShape {
  if (raw === null) return floor;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return floor;
  }
  if (typeof stored !== 'object' || stored === null) return floor;
  const value = stored as Partial<ShelfShape>;
  const root = clampCount(value.root);
  if (root === null || !Array.isArray(value.folders)) return floor;
  const folders = value.folders
    .map(clampCount)
    .filter((n): n is number => n !== null)
    .slice(0, MAX_SHELF_FOLDERS);
  const shape: ShelfShape = { root, folders };
  // One height per card the reader will draw, or none: a list that is
  // short or holds a non-height is from another shape or another
  // version, and a placeholder half-measured is worse than one
  // un-measured, because the seam moves.
  const cards = root + folders.reduce((a, b) => a + b, 0);
  if (
    Array.isArray(value.heights) &&
    value.heights.length >= cards &&
    value.heights.slice(0, cards).every((h) => typeof h === 'number' && h > 0 && h <= MAX_CARD_HEIGHT)
  ) {
    shape.heights = value.heights.slice(0, cards);
  }
  return shape;
}

/**
 * The settled cards' heights, read off the page in the order the grouped
 * list draws them. Every shelf card carries `data-slot="shelf-card"`, and
 * a page holds one shelf, so the document is the scope. `null` when
 * there is nothing to measure yet (or no document, in a node test).
 */
export function readShelfHeights(): number[] | null {
  if (typeof document === 'undefined') return null;
  const cards = document.querySelectorAll<HTMLElement>('[data-slot="shelf-card"]');
  if (cards.length === 0) return null;
  return [...cards].map((card) => card.getBoundingClientRect().height);
}

/** Whether a shape has anything to reserve at all. */
export const shelfHasShape = (shape: ShelfShape): boolean =>
  shape.root > 0 || shape.folders.length > 0;

/**
 * The shape a settled shelf has, computed the way the grouped list
 * computes it: a document files under the collection its id's last
 * slash names, an empty collection still exists, and named collections
 * sort alphabetically. Stored uncapped — the cap belongs to the reader,
 * so a later version can raise it without stale data holding it down.
 */
export function shelfShapeOf(ids: string[], folders: string[]): ShelfShape {
  return shelfShapeFromCollections(
    ids.map((id) => {
      const slash = id.lastIndexOf('/');
      return slash === -1 ? null : id.slice(0, slash);
    }),
    folders,
  );
}

/**
 * The same shape from documents that name their collection outright
 * (the book library's `collection` field) rather than in their id.
 */
export function shelfShapeFromCollections(
  collections: (string | null | undefined)[],
  folders: string[],
): ShelfShape {
  const groups = new Map<string, number>();
  for (const folder of folders) if (folder) groups.set(folder, 0);
  let root = 0;
  for (const collection of collections) {
    if (!collection) root += 1;
    else groups.set(collection, (groups.get(collection) ?? 0) + 1);
  }
  return {
    root,
    folders: [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((k) => groups.get(k)!),
  };
}

/** What a settled shelf stores for the reader above. The heights ride
    along only when the page measured one per card; a count that does
    not match the shape (a card mid-mount, a filtered list) is dropped
    rather than stored to be dropped by the reader. */
export const storedShelfShape = (shape: ShelfShape, heights: number[] | null = null): string => {
  const cards = shape.root + shape.folders.reduce((a, b) => a + b, 0);
  return JSON.stringify(
    heights !== null && heights.length === cards ? { ...shape, heights: heights.map((h) => Math.round(h * 10) / 10) } : shape,
  );
};
