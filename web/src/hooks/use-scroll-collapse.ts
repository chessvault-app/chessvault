import { useEffect, useState, type RefObject } from 'react';
import { scrollParent } from '@/lib/scroll';

/** How far the page has to have scrolled before the header compacts. */
const THRESHOLD = 16;

/**
 * Whether the page under a sticky header has scrolled: true once its
 * nearest scroller is more than a few pixels down, false at the top.
 *
 * A scroll listener rather than an IntersectionObserver on a sentinel,
 * because a sentinel is a box, and a box in PageShell's gap-4 column costs
 * a gap even at zero height. The listener is passive and coalesced to one
 * read per frame, and the state only changes at the boundary, so a page
 * scrolling smoothly re-renders its header twice: once down, once back.
 *
 * Pages that do not scroll (Games, the canvas pages, anything with
 * `scroll={false}`) have no scroller above the header, and the answer
 * stays false without a listener.
 */
export function useScrollCollapse(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const scroller = scrollParent(el);
    if (!scroller) return;
    let frame = 0;
    const read = (): void => {
      frame = 0;
      setCompact(scroller.scrollTop > THRESHOLD);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
  return enabled && compact;
}
