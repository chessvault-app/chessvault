import { useEffect, useState } from 'react';

export const SECTIONS = ['home', 'analysis', 'editor', 'studies', 'notes', 'games', 'puzzles', 'repertoire', 'openingmap', 'books', 'settings', 'more'] as const;
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
 * Hash routing rather than a router dependency: this app is served from the
 * filesystem in packaged builds, where History API paths would 404.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(section: Section, ...params: string[]): void {
  window.location.hash = `/${[section, ...params].join('/')}`;
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
  if (historyFloor !== null && window.history.length > historyFloor) window.history.back();
  else navigate(fallback, ...params);
}
