import type { HomeLayout } from '@shared/homeLayout';

/**
 * What home can offer, as ids, and how a stored layout turns into the two
 * rows the page draws.
 *
 * Separate from `destinations.ts`, which carries the icons and the copy,
 * for one practical reason: this half is where the logic is, and the
 * repo's vitest runs in a node environment over `.ts` files only. Keeping
 * lucide and React on the other side of the wall is what lets the logic be
 * tested at all.
 */

/**
 * Stable ids, stored in the vault. Not `Section` values: Board, Editor and
 * Explorer all live under `analysis` (Explorer is the board opened on its
 * explorer pane), and Puzzle books is a param of `puzzles` — so a section
 * cannot name an entry. `databases` rather than `books` for the same
 * reason the other way round: `#/books` is the URL that section has always
 * had, and this is a new format with no reason to inherit an old name.
 *
 * The order is the CATALOGUE order: it is what the launcher row is drawn
 * in, and the order the customise sheet lists everything in. The first six
 * are today's tiles and the rest today's launcher row, so a vault that has
 * never been customised gets exactly the page it had.
 */
export const HOME_ENTRY_IDS = [
  'board',
  'editor',
  'studies',
  'notes',
  'games',
  'puzzles',
  'repertoire',
  'explorer',
  'databases',
  'puzzlebooks',
  'settings',
] as const;

export type HomeEntryId = (typeof HOME_ENTRY_IDS)[number];

/** The tiles a vault gets before anyone says otherwise. */
export const DEFAULT_TILES: readonly HomeEntryId[] = [
  'board',
  'editor',
  'studies',
  'notes',
  'games',
  'puzzles',
];

export interface ResolvedHome<T extends { id: string }> {
  /** The grid, in the stored order. */
  tiles: T[];
  /** The row underneath: everything else, in catalogue order. */
  launchers: T[];
}

/**
 * A stored layout and this build's catalogue → the two rows.
 *
 * Three properties matter, and each is a bug that has to be designed out
 * rather than noticed later:
 *
 * - An id this build does not know is dropped, not drawn. Two clients of
 *   different ages share one vault, and the older one must not render a
 *   tile it has no page for.
 * - An entry the stored layout never mentions lands in the launcher row.
 *   A destination added in a later version therefore appears on an old
 *   stored layout instead of vanishing, and nothing on home can become
 *   unreachable by editing the vault.
 * - `stored === null` (never customised) takes the defaults; `tiles: []`
 *   does not. Somebody who switched every tile off has said something.
 */
export function resolveHomeLayout<T extends { id: string }>(
  stored: HomeLayout | null,
  catalogue: readonly T[],
  defaults: readonly string[] = DEFAULT_TILES,
): ResolvedHome<T> {
  const wanted = stored === null ? defaults : stored.tiles;
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  const tiles: T[] = [];
  const placed = new Set<string>();
  for (const id of wanted) {
    const entry = byId.get(id);
    if (!entry || placed.has(id)) continue;
    placed.add(id);
    tiles.push(entry);
  }
  return { tiles, launchers: catalogue.filter((entry) => !placed.has(entry.id)) };
}
