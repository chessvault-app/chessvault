/**
 * How a device stores the arrangement of its home page.
 *
 * Per device, in localStorage, and deliberately not in the vault: the
 * page is a screen's business. A phone's home is its navigation and a
 * desktop's is a dashboard beside a sidebar, and one arrangement that has
 * to suit both is the wrong one for at least one of them. The vault used
 * to hold this (config.json's `home`), and every device already kept an
 * echo of the vault's answer under the same key it reads now, so nothing
 * anybody arranged was lost when the vault stopped being asked.
 *
 * Deliberately, nothing in the normaliser knows which destinations or
 * cards exist. Those lists are this build's, and they grow when a panel
 * is added; a stored layout that named everything would let an older
 * build's layout silently amputate a newer one's page. So it validates
 * SHAPE, a list of plausible ids per field, and the page that renders it
 * ignores the ids it does not recognise.
 */

export interface HomeLayout {
  /** Entry ids drawn as tiles, in order. Anything listed in neither this
      nor `hidden` is drawn as a button in the row underneath. */
  tiles: string[];
  /** Entry ids drawn nowhere on home at all.
   *
   * Opt-in and listed one by one, never "everything unmentioned": a
   * destination this build has not heard of is in neither list and must
   * still appear, so a layout stored by an older build cannot hide a
   * page it was never told about.
   *
   * Home is not the only way anywhere, since the sidebar and More reach
   * every destination, so an empty home is a preference rather than a
   * way to strand a page. */
  hidden: string[];
  /** Card ids switched off, on the same opt-in terms as `hidden`: a card
      this layout has never heard of is drawn. */
  off: string[];
}

/** Thirteen destinations and six cards exist; the cap is only there so a
    hand-edited value cannot make the page arbitrarily long. */
export const MAX_HOME_TILES = 40;
export const MAX_HOME_ID = 64;

const ID = new RegExp(`^[a-z0-9-]{1,${MAX_HOME_ID}}$`);

/** A list of ids, deduplicated, or null if it is not one. */
function idList(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_HOME_TILES) return null;
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    // First position wins. A repeat is a value somebody edited by hand,
    // and dropping it beats drawing the same tile twice.
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Anything at all → a layout, or null if it is not one.
 *
 * Null means "this device has never customised home", and that is NOT
 * the same as a layout with no tiles: someone who switches every tile off
 * has said something, and gets an empty grid. Keeping the two apart is
 * why resetting DELETES the stored value instead of writing today's
 * defaults back: a device that has never chosen inherits whatever a later
 * version ships.
 *
 * Two earlier shapes are still read. A layout stored before hiding
 * existed has no `hidden`, and one stored before the cards were a list
 * says `continueCard: false` or `checklist: false` instead of naming them
 * in `off`. Absent is empty, not invalid, in both cases: rejecting either
 * would reset a page somebody had already arranged.
 */
export function normaliseHomeLayout(input: unknown): HomeLayout | null {
  if (input === null || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const tiles = idList(raw.tiles);
  if (tiles === null) return null;
  const hidden = raw.hidden === undefined ? [] : idList(raw.hidden);
  if (hidden === null) return null;
  const off = raw.off === undefined ? [] : idList(raw.off);
  if (off === null) return null;
  // The two flags only ever turned a card off when they were exactly
  // false, so that is the only value that carries over.
  if (raw.continueCard === false && !off.includes('continue')) off.push('continue');
  if (raw.checklist === false && !off.includes('checklist')) off.push('checklist');
  return {
    tiles,
    // A tile wins: it is the more visible of the two, and a value saying
    // both is one somebody edited by hand.
    hidden: hidden.filter((id) => !tiles.includes(id)),
    off,
  };
}

/**
 * The cards home draws besides the tile grid, in the order the dialog
 * lists them.
 *
 * ONE list, read by the page to decide what to draw and by the customise
 * dialog to decide what to offer, because the two used to be written
 * separately and drifted: the dialog offered two switches while the page
 * had grown four more panels nobody could turn off. A card added to the
 * page is added here, and the dialog has it the same moment.
 *
 * `phone` and `desktop` say where the page draws it, so the dialog can say
 * so too: a switch for a panel this screen never shows would otherwise
 * read as broken.
 */
export interface HomeCard {
  id: string;
  label: string;
  /** What the card shows, in the dialog's own words. */
  blurb: string;
  phone: boolean;
  desktop: boolean;
}

export const HOME_CARDS: readonly HomeCard[] = [
  {
    id: 'continue',
    label: 'Continue',
    blurb: 'Where you left off, above everything else.',
    phone: true,
    desktop: true,
  },
  {
    id: 'games',
    label: 'Recent games',
    blurb: 'The latest games in your collection, with their results.',
    phone: true,
    desktop: true,
  },
  {
    id: 'checklist',
    label: 'Set up your vault',
    blurb: 'The first steps for a new vault. It leaves once they are all done.',
    phone: true,
    desktop: true,
  },
  {
    id: 'training',
    label: 'Training',
    blurb: 'Solved today, and what is due for review.',
    phone: false,
    desktop: true,
  },
  {
    id: 'books',
    label: 'Puzzle books',
    blurb: 'The books you are in the middle of.',
    phone: false,
    desktop: true,
  },
  {
    id: 'work',
    label: 'Recent work',
    blurb: 'The studies and notes last touched.',
    phone: false,
    desktop: true,
  },
];

/** Whether a card is drawn: on unless this layout names it off. A device
    that has never customised draws every card. */
export function cardOn(layout: HomeLayout | null, id: string): boolean {
  return layout === null || !layout.off.includes(id);
}

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
 * Stable ids, stored on the device. Not `Section` values, and they must not
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
  'books',
  'puzzles',
  'openingmap',
  'repertoire',
  'explorer',
  'databases',
  'puzzlebooks',
  'settings',
] as const;

export type HomeEntryId = (typeof HOME_ENTRY_IDS)[number];

/**
 * The tiles a device gets before anyone says otherwise.
 *
 * Three, and none of them a bottom-bar tab. The grid is drawn only on a
 * phone, where the bar already carries Games, Studies, Notes and
 * Puzzles two hundred pixels under it, and the default grid used to draw
 * those four again as tiles: the same list twice, which is the objection
 * the desktop's dashboard was built on. What is left is what the bar
 * cannot reach in one press: the board, the explorer and the map.
 * Explorer over Editor because a phone between rounds asks what an
 * opponent plays far more often than it sets up a position from nothing;
 * the editor is one row down.
 */
export const DEFAULT_TILES: readonly HomeEntryId[] = ['board', 'explorer', 'openingmap'];

/**
 * What a never-customised device keeps off home altogether: the four
 * destinations the phone's bottom bar is made of. They are not lost, since
 * the bar is where they live, and the customise sheet lists them under
 * "Off the page" with a way back. A stored layout is not touched by this:
 * hiding stays opt-in and by name there, for the reason `resolveHomeLayout`
 * gives.
 */
export const DEFAULT_HIDDEN: readonly HomeEntryId[] = ['games', 'studies', 'notes', 'puzzles'];

export interface ResolvedHome<T extends { id: string }> {
  /** The grid, in the stored order. */
  tiles: T[];
  /** The row underneath: everything not a tile and not hidden. */
  launchers: T[];
  /** Asked for by name to be on the page nowhere. Home draws none of
      these; the customise sheet lists them so they can be brought back. */
  hidden: T[];
}

/**
 * A stored layout and this build's catalogue → the two rows.
 *
 * Three properties matter, and each is a bug that has to be designed out
 * rather than noticed later:
 *
 * - An id this build does not know is dropped, not drawn. Two clients of
 *   different ages take turns on one device, and the older one must not
 *   render a tile it has no page for.
 * - An entry the stored layout never mentions lands in the launcher row.
 *   A destination added in a later version therefore appears on an old
 *   stored layout instead of vanishing. Hiding is opt-in and by name for
 *   exactly this reason: "everything unmentioned" would have hidden each
 *   new page as it shipped.
 * - `stored === null` (never customised) takes the defaults; `tiles: []`
 *   does not. Somebody who switched every tile off has said something.
 */
export function resolveHomeLayout<T extends { id: string }>(
  stored: HomeLayout | null,
  catalogue: readonly T[],
  defaults: readonly string[] = DEFAULT_TILES,
  defaultHidden: readonly string[] = DEFAULT_HIDDEN,
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
  const hidden = new Set(stored === null ? defaultHidden : stored.hidden);
  const rest = catalogue.filter((entry) => !placed.has(entry.id));
  return {
    tiles,
    launchers: rest.filter((entry) => !hidden.has(entry.id)),
    hidden: rest.filter((entry) => hidden.has(entry.id)),
  };
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
