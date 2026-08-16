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
 * Stable ids, stored in the vault. Not `Section` values, and they must not
 * become them: Board and Explorer are one section (Explorer is the board
 * opened on its explorer pane) and Puzzle books is a param of `puzzles`,
 * so a section cannot name every entry. These ids were already what each
 * page is called — which is why the `analysis`/`books` sections were later
 * renamed to match them rather than the other way round.
 *
 * The order is the CATALOGUE order: it is what the launcher row is drawn
 * in, and the order the customise sheet lists everything in.
 */
export const HOME_ENTRY_IDS = [
  'board',
  'editor',
  'studies',
  'notes',
  'games',
  'puzzles',
  'openingmap',
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
  'openingmap',
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

/**
 * How many columns the launcher row gets on a phone.
 *
 * Five was the number when that row was exactly five buttons, and five is
 * still the most that fit a 360px screen with a label under each. The one
 * shape to avoid is a last line holding a single button: 5+1 reads as an
 * accident, which was the original objection to letting the row wrap at
 * all. So a count that would leave one over drops to four — six becomes
 * 4+2 rather than 5+1, eleven becomes 4+4+3 rather than 5+5+1. Five or
 * fewer just share the width between them.
 */
export function launcherColumns(n: number): number {
  if (n <= 5) return n;
  return n % 5 === 1 ? 4 : 5;
}

/**
 * How many moves an opening map document has charted.
 *
 * Structural rather than typed against the map's own model: that module
 * replays SAN through chessops, and home is the one route bundled eagerly
 * — importing it would put a chess parser in the chunk that has to load
 * before anything at all paints.
 *
 * The two standing roots (one per colour) are placed by simply opening
 * the map and are not moves, so they are not counted. A vault that has
 * looked at the map and charted nothing reads 0, and 0 shows no number.
 */
export function chartedMoves(doc: unknown): number {
  const maps = (doc as { maps?: unknown } | null)?.maps;
  if (!Array.isArray(maps)) return 0;
  let moves = 0;
  const walk = (node: unknown): void => {
    const children = (node as { children?: unknown } | null)?.children;
    if (!Array.isArray(children)) return;
    moves += children.length;
    for (const child of children) walk(child);
  };
  for (const map of maps) walk((map as { root?: unknown } | null)?.root);
  return moves;
}
