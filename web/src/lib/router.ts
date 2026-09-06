import { useEffect, useState } from 'react';
import { confirmLeave, leaveIsBlocked } from './leaveGuard';

// Named for the page each one IS. Two were not: `analysis` drew a page
// the whole app calls the Board, and `books` was the opening-books page
// long enough ago that books have since been retired — it is Databases.
// Both renamed with no alias, so a bookmark on either old hash lands on
// Home the way any unknown hash does (see parse). `books` is back as a
// section, and now it IS books: the library of PDFs you read beside a
// board. (`#/puzzles/books` is the puzzle shelf, which is a different
// thing and says so in its own title.)
export const SECTIONS = ['home', 'board', 'workspace', 'editor', 'studies', 'notes', 'games', 'books', 'puzzles', 'repertoire', 'openingmap', 'databases', 'settings', 'more'] as const;
export type Section = (typeof SECTIONS)[number];

const isSection = (v: string): v is Section => (SECTIONS as readonly string[]).includes(v);

export interface Route {
  section: Section;
  /** Remaining path segments, e.g. `#/studies/ruy-lopez/3` -> ['ruy-lopez', '3']. */
  params: string[];
}

function parse(hash: string): Route {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [head = 'home', ...params] = segments;
  // An unknown hash lands on Home, which explains itself — it used to
  // land on an empty analysis Board with no hint anything went wrong.
  return isSection(head) ? { section: head, params } : { section: 'home', params: [] };
}

/**
 * A route segment as the document id it names.
 *
 * The app writes ids with encodeURIComponent, so a `/` in a folder name
 * or a `%` in a title arrives escaped and this undoes it. A hand-typed or
 * truncated link can carry a `%` that escapes nothing, and
 * decodeURIComponent throws on that, during render, which put the whole
 * section on the error page. Such a segment is taken as it stands: the
 * view asks the server for it, hears there is no such document, and says
 * so where the document would be.
 */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Where the app actually is, as against what the address bar says at this
 * instant.
 *
 * They are the same except for one moment: the browser's Back changes the
 * hash before anyone can object to it, so leaving a document with unsaved
 * changes has to put the address bar back while the question is answered.
 * This is the value it goes back to. Read lazily for the same reason
 * `historyFloor` is — node-side tests have no window.
 */
let current = typeof window !== 'undefined' ? window.location.hash : '';

/**
 * Hash routing rather than a router dependency: this app is served from the
 * filesystem in packaged builds, where History API paths would 404.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = (): void => {
      const next = window.location.hash;
      // Already where we think we are: the restore below put the bar back
      // and this is the app agreeing with it.
      if (next === current) return;
      if (!leaveIsBlocked()) {
        current = next;
        arrivedByNavigate = pendingNavigate;
        pendingNavigate = false;
        setRoute(parse(next));
        return;
      }
      /**
       * Back, with something to lose.
       *
       * There is no preventDefault for a hashchange — by the time we hear
       * about it the address bar has already moved — so put it back and
       * then ask. replaceState is deliberate over pushState: it rewrites
       * the entry that was just landed on instead of growing the stack,
       * which keeps `up`'s historyFloor arithmetic honest. It also fires
       * no hashchange, so there is nothing to suppress.
       */
      window.history.replaceState(window.history.state, '', current || '#/');
      void confirmLeave().then((ok) => {
        // Saved or discarded, so the second time round leaveIsBlocked() is
        // false and this same handler lets it through.
        if (ok) window.location.hash = next;
      });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/**
 * How the current route was arrived at: an in-app navigate, or the
 * browser's own history (Back, Forward, the back chevron's history.back).
 *
 * The two carry different intent — Back means "return me to what I was
 * doing", a tab or a More tile means "open this page" — and the editor
 * restores its session snapshot only for the first kind. There is no
 * event that says which one a hashchange was, so navigateNow marks its
 * own writes and anything unmarked is the browser's. A plain load counts
 * as navigate, so a bookmark opens fresh.
 */
export function returnedThroughHistory(): boolean {
  return !arrivedByNavigate;
}
let arrivedByNavigate = true;
let pendingNavigate = false;

/**
 * Go, without asking anyone.
 *
 * For navigations that are not leaving anything: a rename moves the open
 * document to a new id and lands on the same document, so stopping to ask
 * whether to save it first would be a question about nothing.
 */
/**
 * The address a section IS.
 *
 * Exported so a nav item can put it in a real `href` and this function can
 * set it, from one expression. They used to be the same string written
 * twice — except the sidebar never wrote it at all, being buttons, which
 * is how the whole navigation lost middle-click and open-in-new-tab on an
 * app where two windows side by side is an obvious way to work.
 */
export const sectionHref = (section: Section, ...params: string[]): string =>
  `#/${[section, ...params].join('/')}`;

export function navigateNow(section: Section, ...params: string[]): void {
  const target = sectionHref(section, ...params);
  // Same hash fires no hashchange, so the mark would sit unconsumed and
  // mislabel the next Back as a navigate.
  if (window.location.hash !== target) pendingNavigate = true;
  window.location.hash = target;
}

/**
 * Go, once the open document has had its say.
 *
 * Deliberately still void-returning. There are 130 calls to this and `up`
 * across 26 files; making them await a decision would have been a bigger
 * change than the feature, and none of them has anything to do after
 * navigating anyway.
 */
export function navigate(section: Section, ...params: string[]): void {
  if (!leaveIsBlocked()) {
    navigateNow(section, ...params);
    return;
  }
  void confirmLeave().then((ok) => {
    if (ok) navigateNow(section, ...params);
  });
}

/** How deep the history was when the app loaded — see `up`. Read lazily:
    this module is imported by node-side tests, where there is no window. */
let historyFloor: number | null = null;
if (typeof window !== 'undefined') historyFloor = window.history.length;

/**
 * A back chevron that cannot eject you from the app.
 *
 * Leaf pages used to call history.back() bare, and opened from a shared
 * or bookmarked deep link "back" left the site instead of going up a
 * level. If in-app navigation has grown the history, back is honest;
 * otherwise go where the chevron points.
 */
export function up(fallback: Section, ...params: string[]): void {
  const go = (): void => {
    if (historyFloor !== null && window.history.length > historyFloor) window.history.back();
    else navigateNow(fallback, ...params);
  };
  if (!leaveIsBlocked()) {
    go();
    return;
  }
  void confirmLeave().then((ok) => {
    if (ok) go();
  });
}
