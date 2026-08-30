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
  /** Entry ids drawn as tiles, in order. Anything listed in neither this
      nor `hidden` is drawn as a button in the row underneath. */
  tiles: string[];
  /** Entry ids drawn nowhere on home at all.
   *
   * Opt-in and listed one by one, never "everything unmentioned": a
   * destination this build has not heard of is in neither list and must
   * still appear, so a layout stored by an older client cannot hide a
   * page it was never told about.
   *
   * Home is not the only way anywhere — the sidebar and More reach every
   * destination — so an empty home is a preference rather than a way to
   * strand a page. */
  hidden: string[];
  /** The "Continue" card. */
  continueCard: boolean;
  /** The "Set up your vault" checklist. */
  checklist: boolean;
}

/** Twelve destinations exist; the cap is only there so a hand-edited or
    hostile config cannot make the page arbitrarily long. */
export const MAX_HOME_TILES = 40;
export const MAX_HOME_ID = 64;

const ID = new RegExp(`^[a-z0-9-]{1,${MAX_HOME_ID}}$`);

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
  // Absent is empty, not invalid: every layout stored before hiding
  // existed has no such field, and rejecting those would reset a page
  // somebody had already arranged. Present, it is held to the same shape
  // as the tiles.
  const hidden: string[] = [];
  if (raw.hidden !== undefined) {
    if (!Array.isArray(raw.hidden)) return null;
    if (raw.hidden.length > MAX_HOME_TILES) return null;
    for (const id of raw.hidden) {
      if (typeof id !== 'string' || !ID.test(id)) return null;
      // A tile wins: it is the more visible of the two, and a config
      // saying both is one somebody edited by hand.
      if (!hidden.includes(id) && !tiles.includes(id)) hidden.push(id);
    }
  }
  // The flags are on unless the stored value is exactly false, so a
  // truncated or hand-written config shows the page rather than hiding
  // half of it.
  return {
    tiles,
    hidden,
    continueCard: raw.continueCard !== false,
    checklist: raw.checklist !== false,
  };
}
