import { useCallback, useRef } from 'react';
import { scrollParent } from '@/lib/scroll';

/**
 * A band that stays put over a scrolling page tells that page it is there,
 * so the browser scrolls a focused control clear of it instead of under it.
 *
 * The browser's own scroll-into-view for Tab and Shift+Tab stops the moment
 * a control is inside the SCROLLPORT, and a pinned band is inside the
 * scrollport too - it just happens to be painted on top. So the settings
 * page's section row hid whatever Shift+Tab landed on at the top of the
 * page, the note's header hid a board's controls, and a focus ring under a
 * 95% opaque band is not a focus indicator at all (WCAG 1.4.11 asks 3:1 of
 * one; measured over the band it was 0 of 1,260 ring pixels visible).
 *
 * `scroll-padding` is the property for this, and the only question is where
 * its number comes from. It comes from here: the band measures ITSELF, the
 * way the board block publishes its height to the row beside it
 * (board/boardBlock.ts), and the scroller reads the measurement back as a
 * variable (index.css). So a 60px row, the 84px that row becomes when it
 * wraps, and a 65px note header all work with no constant written down
 * anywhere, and a band that changes height changes the clearance with it.
 *
 * A CALLBACK ref, like the element measurers beside it: these bands mount
 * conditionally (the settings row appears only once a page has four cards),
 * so a static ref bound on mount would never see them.
 *
 * One band per edge per scroller, which is what the app has: the value is
 * written, not accumulated, and the last band to mount on an edge wins.
 */
export function usePinnedBand(edge: 'top' | 'bottom'): (el: HTMLElement | null) => void {
  const held = useRef<{ ro: ResizeObserver; scroller: HTMLElement; prop: string } | null>(null);
  return useCallback(
    (el: HTMLElement | null) => {
      const prev = held.current;
      if (prev) {
        prev.ro.disconnect();
        prev.scroller.style.removeProperty(prev.prop);
        if (!prev.scroller.style.getPropertyValue('--pin-top') && !prev.scroller.style.getPropertyValue('--pin-bottom')) {
          prev.scroller.removeAttribute('data-pinned');
        }
        held.current = null;
      }
      if (!el) return;
      const scroller = scrollParent(el);
      if (!scroller) return;
      const prop = edge === 'top' ? '--pin-top' : '--pin-bottom';
      const publish = (): void => {
        scroller.style.setProperty(prop, `${Math.round(el.getBoundingClientRect().height)}px`);
        scroller.setAttribute('data-pinned', '');
      };
      const ro = new ResizeObserver(publish);
      ro.observe(el);
      publish();
      held.current = { ro, scroller, prop };
    },
    [edge],
  );
}
