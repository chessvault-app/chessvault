import { useEffect, useState } from 'react';

/**
 * A media query as state, kept current as the window changes.
 *
 * For the cases a CSS class cannot reach: not "hide this at that size" but
 * "offer something different at that size". A menu whose items are merely
 * `lg:hidden` is still a menu of that many items — it renders a chevron
 * and a popover to show one row — so the list itself has to know.
 *
 * Read once at mount as well as subscribed, because the first paint is a
 * real paint: a menu that decides it is narrow and corrects itself a frame
 * later has already been seen.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = (): void => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
