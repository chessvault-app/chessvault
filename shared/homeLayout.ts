/**
 * How a vault stores the arrangement of its home page.
 *
 * Shared because three places need the SAME answer about what a stored
 * layout is: the route that writes it into config.json, the demo's
 * stand-in for that route, and the page that draws from it. A second copy
 * of these rules is a second set of ids the other two would eventually
 * disagree about.
 *
 * Deliberately, nothing here knows which destinations exist. The list of
 * places home can send you is the web app's, and it grows when a page is
 * added; a server that rejected an id it had not heard of would let an
 * older client silently amputate a newer one's layout. So this validates
 * SHAPE — that it is a list of plausible ids and two flags — and the page
 * that renders it ignores the ids it does not recognise.
 */

export interface HomeLayout {
  /** Entry ids drawn as tiles, in order. Anything not listed is drawn as a
      button in the row underneath, so a tile is a promotion and never the
      only way to something. */
  tiles: string[];
  /** The "Continue" card. */
  continueCard: boolean;
  /** The "Set up your vault" checklist. */
  checklist: boolean;
}

/** Twelve destinations exist; the cap is only there so a hand-edited or
    hostile config cannot make the page arbitrarily long. */
export const MAX_HOME_TILES = 40;
export const MAX_HOME_ID = 64;

const ID = /^[a-z0-9-]{1,64}$/;

/**
 * Anything at all → a layout, or null if it is not one.
 *
 * Null means "this vault has never been customised", and that is NOT the
 * same as a layout with no tiles: someone who switches every tile off has
 * said something, and gets an empty grid. Keeping the two apart is why the
 * settings route answers with null rather than an empty object, and why
 * resetting DELETEs instead of writing today's defaults back — a vault
 * that has never chosen inherits whatever a later version ships.
 */
export function normaliseHomeLayout(input: unknown): HomeLayout | null {
  if (input === null || typeof input !== 'object') return null;
  const raw = input as Partial<Record<keyof HomeLayout, unknown>>;
  if (!Array.isArray(raw.tiles)) return null;
  if (raw.tiles.length > MAX_HOME_TILES) return null;
  const tiles: string[] = [];
  for (const id of raw.tiles) {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    // First position wins. A repeat is a config somebody edited by hand,
    // and dropping it beats drawing the same tile twice.
    if (!tiles.includes(id)) tiles.push(id);
  }
  // The flags are on unless the stored value is exactly false, so a
  // truncated or hand-written config shows the page rather than hiding
  // half of it.
  return { tiles, continueCard: raw.continueCard !== false, checklist: raw.checklist !== false };
}
