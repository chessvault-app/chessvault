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
}

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

const clampCount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_SHELF_CARDS) : null;

/**
 * The shape a device stored, or the floor if it stored nothing
 * readable. `{ root: 0, folders: [] }` is a shape and not a nothing —
 * a vault seen genuinely empty settles into the shelf's EmptyState, and
 * the caller reserves nothing for it rather than inventing cards.
 */
export function parseShelfShape(raw: string | null): ShelfShape {
  if (raw === null) return WELCOME_SHELF;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return WELCOME_SHELF;
  }
  if (typeof stored !== 'object' || stored === null) return WELCOME_SHELF;
  const value = stored as Partial<ShelfShape>;
  const root = clampCount(value.root);
  if (root === null || !Array.isArray(value.folders)) return WELCOME_SHELF;
  return {
    root,
    folders: value.folders
      .map(clampCount)
      .filter((n): n is number => n !== null)
      .slice(0, MAX_SHELF_FOLDERS),
  };
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
  const groups = new Map<string, number>();
  for (const folder of folders) if (folder) groups.set(folder, 0);
  let root = 0;
  for (const id of ids) {
    const slash = id.lastIndexOf('/');
    if (slash === -1) root += 1;
    else {
      const folder = id.slice(0, slash);
      groups.set(folder, (groups.get(folder) ?? 0) + 1);
    }
  }
  return {
    root,
    folders: [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((k) => groups.get(k)!),
  };
}

/** What a settled shelf stores for the reader above. */
export const storedShelfShape = (shape: ShelfShape): string => JSON.stringify(shape);
