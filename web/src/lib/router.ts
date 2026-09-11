import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { confirmLeave, leaveIsBlocked } from './leaveGuard';
import { prefersReducedMotion } from './motion';
import { disarmSharedBoard } from './shared-board';

// Named for the page each one IS. Two were not: `analysis` drew a page
// the whole app calls the Board, and `books` was the opening-books page
// long enough ago that books have since been retired — it is Databases.
// Both renamed with no alias, so a bookmark on either old hash lands on
// Home the way any unknown hash does (see parse). `books` is back as a
// section, and now it IS books: the library of PDFs you read beside a
// board. (`#/puzzles/books` is the puzzle shelf, which is a different
// thing and says so in its own title.)
export const SECTIONS = ['home', 'board', 'workspace', 'editor', 'studies', 'notes', 'games', 'books', 'puzzles', 'repertoire', 'openingmap', 'insights', 'databases', 'settings', 'more'] as const;
export type Section = (typeof SECTIONS)[number];

const isSection = (v: string): v is Section => (SECTIONS as readonly string[]).includes(v);

export interface Route {
  section: Section;
  /** Remaining path segments, e.g. `#/studies/ruy-lopez/3` -> ['ruy-lopez', '3']. */
  params: string[];
}

export function parse(hash: string): Route {
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
        const from = current;
        current = next;
        arrivedByNavigate = pendingNavigate;
        const appDriven = pendingNavigate || pendingTraverse;
        const nav = pendingDirection ?? shapeOf(from, next);
        pendingNavigate = false;
        pendingTraverse = false;
        pendingDirection = null;
        swapRoute(() => setRoute(parse(next)), appDriven, nav, next);
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
 * The page change itself, on a phone, as a 150ms cross-fade.
 *
 * A route change was a hard cut: the old page gone, the new one there,
 * in one frame. On a desktop, where the sidebar stays and the column
 * changes, that reads as a tool; on a phone, where the whole screen
 * changes, it reads as a reload, and every native app crossfades or
 * slides between a hub and a leaf. The browser's own View Transitions
 * (Chrome 111, Safari 18) snapshot the old page, commit the new one and
 * fade between the two; the CSS is under `::view-transition` in
 * index.css. The route is committed synchronously inside the
 * transition's callback, which is what the API needs to snapshot both
 * states.
 *
 * Not on a desktop (`md` and up), not under reduced motion, and not in a
 * browser without the API: those take the cut they always took. The
 * leave-guard branch above never comes here; it asks first and then
 * navigates again through this same path.
 *
 * And not when the browser moved the history itself. A swipe from the
 * edge on an iPhone plays Safari's own animation first: the old page
 * slides away and a snapshot of the previous one is revealed under it,
 * and only once that has settled does the hashchange arrive. Fading
 * then meant the page the user had just watched leave came back for
 * 150ms over the one they had arrived at, and faded out a second time.
 * Nothing in the event says who moved the history, so the app marks its
 * own moves (navigateNow, traverse) and an unmarked one is the
 * browser's, which has already animated it or, on a desktop, would
 * never have.
 */
function swapRoute(commit: () => void, appDriven: boolean, nav: Nav, to: string): void {
  const phone = window.matchMedia('(max-width: 47.9375rem)').matches;
  if (!appDriven || !phone || prefersReducedMotion() || typeof document.startViewTransition !== 'function') {
    commit();
    disarmSharedBoard();
    return;
  }
  // The new page has to exist before it can slide in. A section's chunk
  // is fetched the first time it is drawn (lib/lazyRoute), and a route
  // whose chunk is still on the wire commits as an empty box: the
  // transition then snapshots the old page and slides a bare ground in
  // beside it, black on a dark theme, and the board arrives only after
  // the slide has finished. Seen on a phone over 5G, opening a game
  // from the games list. So the transition waits for the chunk, capped
  // (CHUNK_WAIT_MS), and a route that has moved on in the meantime is
  // left to its own hashchange.
  const wait = routePending?.(to);
  if (wait) {
    const token = (waitToken = {});
    void Promise.race([wait, new Promise<void>((r) => setTimeout(r, CHUNK_WAIT_MS))]).then(() => {
      if (waitToken !== token) return;
      if (window.location.hash !== to) return;
      swapRouteNow(commit, nav);
    });
    return;
  }
  swapRouteNow(commit, nav);
}
let waitToken: object | null = null;

function swapRouteNow(commit: () => void, nav: Nav): void {
  // The direction, for the stylesheet: a tab switch fades through, a
  // push slides the new page in over the old, a pop slides the old one
  // back out. Stamped on the root before the snapshot so the first frame
  // is already the right animation, and cleared once it has played.
  document.documentElement.dataset.nav = nav;
  const transition = document.startViewTransition(() => {
    flushSync(commit);
  });
  // `finished` rejects when a transition is skipped (another starts, the
  // tab hides); either way the route has settled, and a board flight the
  // tap armed has flown.
  const settled = transition.finished.catch(() => undefined).then(() => {
    disarmSharedBoard();
    if (inFlight === settled) {
      inFlight = null;
      delete document.documentElement.dataset.nav;
    }
  });
  inFlight = settled;
}

/**
 * The shape of a page change: `tab` between two top-level pages, `push`
 * down into a leaf, `pop` back up. The CSS is under `[data-nav]` in
 * index.css.
 *
 * Read off the two routes, not off which function the page called: a
 * leaf's back chevron may `navigate` to its list (the study page does,
 * so a bookmarked study still has somewhere to go) and that is still a
 * step up. Only the app's own history moves (`traverse`) name their
 * direction outright, since Back is a pop wherever it lands.
 */
type Nav = 'tab' | 'push' | 'pop';

/** How deep a route is: its parameter count, with the puzzles hub at the
    top, since that is where the Puzzles tab lands, and the bare trainer
    (`#/puzzles`, what the hub's Next puzzle card opens) one step under
    it. Counted by parameters alone the trainer sat level with the hub,
    so the card faded through like a tab switch while the Failed and
    theme cards beside it pushed. The opening map's colour is not counted
    at all: `#/openingmap/black` is the same page as `#/openingmap` in
    the other colour, not a leaf under it. Read as a push, the black map
    slid in from the right over the white one and slid back out on the
    way back, a page opening under a page rather than one map giving way
    to its twin. Two depths of zero make it a tab, the fade-through. */
function depth(hash: string): number {
  const { section, params } = parse(hash);
  if (section === 'openingmap' && (params[0] === 'black' || params[0] === 'white')) return 0;
  if (section !== 'puzzles') return params.length;
  return params[0] === 'hub' ? 0 : Math.max(1, params.length);
}

export function shapeOf(from: string, to: string): Nav {
  const a = depth(from);
  const b = depth(to);
  if (b > a) return 'push';
  if (b < a) return 'pop';
  return b === 0 ? 'tab' : 'push';
}

let inFlight: Promise<void> | null = null;

/**
 * What the app knows and the router does not: whether the section a hash
 * names has its chunk yet. Registered by App, which owns the lazy routes;
 * null means it will draw on the next render.
 */
let routePending: ((hash: string) => Promise<void> | null) | null = null;
export function registerRoutePending(fn: (hash: string) => Promise<void> | null): void {
  routePending = fn;
}

/**
 * How long a page change waits for its chunk before moving anyway. A
 * chunk on a good link is here in tens of milliseconds and the wait is
 * unfelt; on a bad one the cap keeps the tap answered, and the page
 * slides in blank the way it did before there was a wait, which is the
 * failure it always had rather than a new one.
 */
const CHUNK_WAIT_MS = 400;

/**
 * Resolves once the page change in flight, if any, has finished drawing.
 *
 * Anything that appears during a View Transition is captured in the
 * new page's snapshot and shown as a still while the old page fades,
 * then plays live once the pseudo-elements are torn down. A toast raised
 * in that window rose twice: once frozen mid-entrance in the snapshot,
 * once for real. Whatever wants to appear after a route change awaits
 * this first; with no transition in flight it resolves at once.
 *
 * The tear-down has a second, cosmetic consequence worth knowing before
 * someone goes hunting for it elsewhere: on iOS the snapshot rasterises
 * a shelf's board thumbnails about a device pixel off the live page, so
 * they hop when it hands back. It is a raster and not a layout change,
 * and it is written up where it is seen (components/mini-board).
 */
export function routeSettled(): Promise<void> {
  return inFlight ?? Promise.resolve();
}

/**
 * Whether a page change is being drawn right now. A placeholder that
 * waits its usual beat before admitting to a load (useSlowLoad) has no
 * flash to avoid while the page it stands in is still sliding in, and
 * a page that draws nothing during the slide is a bare ground moving
 * across the screen; so a wait that begins here shows at once.
 */
export function routeChanging(): boolean {
  return inFlight !== null;
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
let pendingTraverse = false;
/** Which way a pending history move goes, for the transition's shape;
    a plain navigate leaves it null and the routes decide (shapeOf). */
let pendingDirection: 'push' | 'pop' | null = null;

/**
 * Back or Forward, asked for by the app: the chevron on a leaf page,
 * the arrows in the desktop title bar. Marked so the hashchange it
 * causes still gets the transition (swapRoute), as against the same move
 * made from the browser's own chrome, which does not.
 */
export function traverse(delta: -1 | 1): void {
  pendingTraverse = true;
  pendingDirection = delta < 0 ? 'pop' : 'push';
  window.history.go(delta);
}

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

/**
 * Whether the address bar already says `href`. Both sides are read the
 * way `parse` reads them, so `#/`, `#` and `#/home` are one place.
 */
export function atRoute(href: string): boolean {
  const norm = (h: string): string => {
    const segs = h.replace(/^#\/?/, '').split('/').filter(Boolean);
    return (segs.length ? segs : ['home']).join('/');
  };
  return norm(window.location.hash) === norm(href);
}

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
    if (historyFloor !== null && window.history.length > historyFloor) traverse(-1);
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
