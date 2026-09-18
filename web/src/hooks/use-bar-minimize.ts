import { useEffect, useState } from 'react';
import { currentPlatform } from '@/lib/platform';

/** Within this many pixels of the top the page counts as unscrolled. */
const TOP = 16;
/** A move smaller than this is a finger settling, not a scroll. */
const SLACK = 4;

/**
 * Whether the iOS capsule should be down to its current tab.
 *
 * iOS 26 minimises the tab bar on a scroll down and brings it back on
 * the first scroll up, so the content being read gets the width of the
 * screen and the tabs are one flick away; at the top of a page the bar
 * is always whole. The same shape the pinned headers take
 * (hooks/use-scroll-reveal), read the same way: direction with a few
 * pixels of slack, and a position past either end (a rubber-band
 * bounce) read as no move.
 *
 * The bar lives in the shell and the scroller in whichever page is
 * open, so this listens on `main` in the CAPTURE phase, where every
 * scroller under it reports without any page having to wire itself up;
 * scroll events do not bubble, but they are captured. A scroller that
 * cannot scroll vertically (a chip row) is ignored. The page's own
 * scroller is primed when the route settles, so the first flick on a
 * page decides (measured before this: the first scroll down on a fresh
 * page changed nothing, because the direction needs a position to
 * compare with); a scroller that was not primed, one list swapped for
 * another inside a page, records where it is on its first event and
 * decides from the second.
 *
 * iOS only, by the root's platform attribute: on Android the bar is
 * docked and never minimises, and the listener is not installed. A
 * route change expands the bar, since the page that arrives is at its
 * top.
 */
export function useBarMinimized(route: string): { minimized: boolean; expand: () => void } {
  const [minimized, setMinimized] = useState(false);
  // Expanded on every route change. Derived during render, the way
  // React's docs adjust state on a prop change, rather than in an effect.
  const [seen, setSeen] = useState(route);
  if (route !== seen) {
    setSeen(route);
    setMinimized(false);
  }

  useEffect(() => {
    if (currentPlatform() !== 'ios') return;
    const main = document.getElementById('main');
    if (!main) return;
    let frame = 0;
    let target: HTMLElement | null = null;
    let last = 0;
    // The page's scroller, once the page is in: PageShell's, or the first
    // vertical scroller under main for a page that manages its own. A
    // lazy page is not in on the first frame (a direct load of a shelf
    // primed a skeleton, or nothing, and the first flick was lost), so
    // the priming follows the DOM: once a frame while main's subtree
    // changes, until a scroller is held and stays visible. The walk of
    // every element is the expensive part and runs only until then.
    let primed = 0;
    const prime = (): void => {
      primed = 0;
      if (target?.isConnected && target.checkVisibility()) return;
      const el =
        [...main.querySelectorAll<HTMLElement>('[data-page-scroll]')].find((n) => n.checkVisibility()) ??
        [...main.querySelectorAll<HTMLElement>('*')].find((n) => {
          const s = getComputedStyle(n);
          return (s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight && n.checkVisibility();
        });
      if (el) {
        target = el;
        last = el.scrollTop;
      }
    };
    const schedule = (): void => {
      if (!primed) primed = requestAnimationFrame(prime);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(main, { childList: true, subtree: true });
    schedule();
    const read = (): void => {
      frame = 0;
      const el = target;
      if (!el) return;
      const top = el.scrollTop;
      const max = el.scrollHeight - el.clientHeight;
      const delta = top - last;
      last = top;
      if (top < 0 || top > max) return;
      if (top <= TOP) setMinimized(false);
      else if (delta > SLACK) setMinimized(true);
      else if (delta < -SLACK) setMinimized(false);
    };
    const onScroll = (e: Event): void => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight) return;
      if (el !== target) {
        target = el;
        last = el.scrollTop;
        return;
      }
      if (!frame) frame = requestAnimationFrame(read);
    };
    main.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      main.removeEventListener('scroll', onScroll, { capture: true });
      mo.disconnect();
      if (primed) cancelAnimationFrame(primed);
      if (frame) cancelAnimationFrame(frame);
    };
    // Re-primed on every route: the scroller is the new page's.
  }, [route]);

  return { minimized, expand: () => setMinimized(false) };
}
