/**
 * Where the manual lives, for the controls that point at it.
 *
 * The app had no link to its own manual: the ? sheet listed shortcuts
 * and the docs sat on the public site with nothing in the app naming
 * them. This is the one place the site's address is written; a page is
 * the hash the manual's own drawer uses (`#settings`, `#board`), and the
 * manual picks its language the way the app does, from the same stored
 * choice on its own origin or the browser's language.
 */
export const SITE_URL = 'https://chessvault-app.github.io';

export const manualUrl = (page: string): string => `${SITE_URL}/docs.html#${page}`;
