/** What a document is filed under, which is also half its reservation key. */
export type DocKind = 'study' | 'game';
const baseOf = (kind: DocKind): string => (kind === 'game' ? 'games/docs' : 'studies');

/**
 * Whether this document drew player bars last time.
 *
 * A study's chapters can carry White and Black headers (one made from an
 * imported game does), and the bars are drawn for the headers, not for
 * the kind. Per document, like a puzzle book's shape.
 *
 * On a wide screen the top slot is held whatever it will carry, but a
 * stacked layout draws the bars only when there are players, and
 * `kind === 'game'` was the guess: measured on the demo at 390px, a
 * study made from a game put its board 34px lower and the column under
 * it 64px lower than the placeholder had them. Stored per document on
 * the way out, read on the way in; a document never opened here falls
 * back to the guess.
 *
 * A module of its own because three things share the key and none of
 * them should import another: the route outline, drawn before the page's
 * chunk exists; the page, which writes what it drew; and the study store,
 * which writes what the listing says about studies never opened here.
 */
export const playersKey = (kind: DocKind, id: string): string =>
  `vault:doc-players:${baseOf(kind)}:${id}`;

export const readReservedPlayers = (kind: DocKind, id: string): boolean | null => {
  try {
    const stored = localStorage.getItem(playersKey(kind, id));
    return stored === null ? null : stored === '1';
  } catch {
    return null;
  }
};


export const reservePlayers = (kind: DocKind, id: string, players: boolean): void => {
  try {
    localStorage.setItem(playersKey(kind, id), players ? '1' : '0');
  } catch {
    /* no storage: the outline falls back to its guess */
  }
};
