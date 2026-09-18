import { useEffect, useState, type RefObject } from 'react';
import { scrollParent } from '@/lib/scroll';

/** Within this many pixels of the top the page counts as unscrolled. */
const TOP = 16;
/** A move smaller than this is a finger settling, not a scroll. */
const SLACK = 4;

/**
 * A pinned band that steps aside while the page is being read and comes
 * back the moment the reader turns round.
 *
 * Two answers, read off the nearest scroller. `scrolled` is whether the
 * page is down at all (the band's fill and its rule hang on it).
 * `hidden` is whether the band should be off the screen: true once the
 * page is scrolled and the last move went DOWN, false again on the first
 * move UP, and always false at the top, where the band is in the flow
 * and there is nothing to hide from. That is Material 3's and the
 * platform's own shape for a top app bar over a long list (lanph3re's
 * call, 2026-09-18): the words the reader is moving towards get the
 * whole screen, and the controls are one flick back.
 *
 * A scroll listener, passive and coalesced to one read a frame, rather
 * than an IntersectionObserver on a sentinel: a sentinel is a box, and a
 * box in PageShell's gap-4 column costs a gap even at zero height. The
 * state only changes at a boundary, so a page scrolling smoothly
 * re-renders its band a handful of times, not once a frame. The
 * direction has a few pixels of slack, or a finger resting on the glass
 * flickers the band; and a position past the scroller's end (a
 * rubber-band bounce) is read as no move, or every bounce at the foot of
 * a list flashed the band.
 */
export function useScrollReveal(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
): { scrolled: boolean; hidden: boolean } {
  const [state, setState] = useState({ scrolled: false, hidden: false });
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const scroller = scrollParent(el);
    if (!scroller) return;
    let frame = 0;
    let last = scroller.scrollTop;
    const read = (): void => {
      frame = 0;
      const top = scroller.scrollTop;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const delta = top - last;
      last = top;
      if (top < 0 || top > max) return;
      setState((prev) => {
        if (top <= TOP) return prev.scrolled || prev.hidden ? { scrolled: false, hidden: false } : prev;
        const hidden = delta > SLACK ? true : delta < -SLACK ? false : prev.hidden;
        return prev.scrolled && prev.hidden === hidden ? prev : { scrolled: true, hidden };
      });
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
  return enabled ? state : { scrolled: false, hidden: false };
}
