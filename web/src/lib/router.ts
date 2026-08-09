import { useEffect, useState } from 'react';

export const SECTIONS = ['home', 'analysis', 'editor', 'studies', 'notes', 'games', 'puzzles', 'settings', 'more'] as const;
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
  return { section: isSection(head) ? head : 'analysis', params };
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
