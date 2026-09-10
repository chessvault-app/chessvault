import { useRef, useState } from 'react';
import { gestureAxis } from '@/hooks/use-pane-swipe';
import { prefersReducedMotion } from '@/lib/motion';
import { gestureHaptic } from '@/board/sound';

/**
 * How far from a screen edge a scrub has to start.
 *
 * The same guard the pane swipe keeps, for the same reason: both platforms
 * read a drag that begins on the edge as Back. It costs less here than it
 * looks like it does — the first tab's outer 32px cannot BEGIN a scrub,
 * but the finger can still land there from anywhere else on the bar, and
 * the tab is a tap away regardless.
 */
const EDGE_PX = 32;

/**
 * How far above or below the bar a finger may be when it lifts and still
 * be choosing a tab.
 *
 * A scrub is a press on a control, so it ends the way a press on a button
 * does: lift on it and it fires, drag off it and it does not. The band is
 * generous because the bar is 56px of a phone's bottom edge and a thumb
 * arcs; it is not unbounded, because a finger that has travelled into the
 * page has left.
 */
const BAND_PX = 32;

/** Which of the bar's equal slots a point is over. */
export function tabUnder(x: number, left: number, width: number, count: number): number {
  if (count <= 0 || width <= 0) return 0;
  const slot = Math.floor(((x - left) / width) * count);
  return Math.max(0, Math.min(count - 1, slot));
}

/**
 * Where the pill sits while a finger holds it: centred under the finger,
 * and never past either end of the bar.
 *
 * One to one, not snapped to the slot it would pick. The pill is the
 * finger's own position and the lit icon is the answer, which is two
 * things worth saying separately: halfway between two tabs, a pill that
 * had snapped would claim a decision the finger has not made.
 */
export function pillAt(x: number, left: number, width: number, pill: number): number {
  return Math.max(0, Math.min(width - pill, x - left - pill / 2));
}

/** Whether a finger that lifted here is still on the bar. */
export function inBand(y: number, top: number, bottom: number): boolean {
  return y >= top - BAND_PX && y <= bottom + BAND_PX;
}

/**
 * Drag along the phone's tab bar to pick a tab: the pill follows the
 * finger, the tab under it lights, and the app navigates when the finger
 * lifts.
 *
 * This is a SELECTION, which is what separates it from the pane swipe next
 * door (hooks/use-pane-swipe) and is why the two are not one hook. A swipe
 * is relative: it turns to the next pane, the contents travel with the
 * finger, and a release decides only whether the turn happened. A scrub is
 * absolute: nothing travels but the marker, the finger names a tab
 * outright rather than a direction, and the release lands wherever it is.
 * Giving either one the other's rules makes it worse — a scrub with a
 * commit threshold could not reach the tab three along, and a swipe with
 * absolute landing would need the panes laid out as one strip, which the
 * board pages cannot do (see that hook's note).
 *
 * What they do share is plumbing, and this takes it: `gestureAxis` decides
 * whether a drag is horizontal at all, the same 8px of slop, the same
 * edge guard, and the same haptic tick.
 *
 * The tap is untouched. A gesture that never turns horizontal is never
 * claimed, no marker moves, and the button's own click does what it has
 * always done; a scrub that WAS claimed swallows the click that follows it
 * so the tab under the finger wins rather than the tab it started on.
 *
 * Reduced motion keeps the swap this bar has always had: the tab under the
 * finger still lights, because a colour is not motion and it is the only
 * thing left saying where the gesture is, but the pill does not travel.
 *
 * Touch only. A mouse has the tabs, and the bar is not on screen above md.
 */
export function useTabScrub({
  count,
  onPick,
}: {
  /** How many equal slots the bar has. */
  count: number;
  /** Run the slot's own action — the same one its tap runs, so a release
      where the finger started is the tap it would have been. */
  onPick: (index: number) => void;
}): {
  /** Spread on the NAV: the slots are read from its box, not from theirs. */
  bar: {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchCancel: () => void;
  };
  /** The tab the finger is over, or null while no finger is down. What
      lights up; `aria-current` stays on the page the app is actually on,
      which has not changed yet. */
  at: number | null;
  /** Whether the click now arriving belongs to a scrub rather than to a
      tap. Asking clears it. */
  scrubbed: () => boolean;
} {
  const [at, setAt] = useState<number | null>(null);

  const bar = useRef<HTMLElement | null>(null);
  const pill = useRef<HTMLElement | null>(null);
  const box = useRef<DOMRect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'x' | 'y' | null>(null);
  /** The same number as `at`, for the handlers to read. Two touchmoves in
      one frame see one render's worth of state, and the second would tick
      the haptic for a boundary the first already crossed. */
  const over = useRef<number | null>(null);
  const swallow = useRef(false);
  /** Read per gesture rather than at mount, so a setting changed
      mid-session is honoured. */
  const still = useRef(false);

  /** Take the pill off the finger and give it back its clock. */
  const release = (): void => {
    const node = bar.current;
    setAt(null);
    over.current = null;
    if (!node) return;
    node.removeAttribute('data-nav-scrub');
    // The attribute has to be off AND computed before the position
    // changes: the pill is standing where the finger left it with no
    // transition, and taking both away in one go walks it home instantly.
    void node.offsetWidth;
    node.style.removeProperty('--nav-pill-left');
  };

  const forget = (): void => {
    start.current = null;
    axis.current = null;
    box.current = null;
  };

  /**
   * Give up on a gesture without choosing anything: a second finger
   * arrived, or the system took the touch away.
   *
   * It still swallows the click, if there was a scrub to swallow it for.
   * Otherwise a scrub abandoned half way would fall back on the click the
   * browser sends afterwards, which is a press on the tab the finger
   * STARTED on — a tab nobody asked for, chosen by letting go of the one
   * they did.
   */
  const abandon = (): void => {
    if (axis.current === 'x' && over.current !== null) swallow.current = true;
    release();
    forget();
  };

  return {
    at,
    scrubbed: () => {
      const was = swallow.current;
      swallow.current = false;
      return was;
    },
    bar: {
      onTouchStart: (e) => {
        forget();
        swallow.current = false;
        // A second finger is a pinch or a stray palm, never a choice.
        if (e.touches.length !== 1) return;
        const touch = e.touches[0]!;
        if (touch.clientX < EDGE_PX || touch.clientX > window.innerWidth - EDGE_PX) return;
        bar.current = e.currentTarget;
        pill.current = e.currentTarget.querySelector<HTMLElement>('[data-nav-pill]');
        box.current = e.currentTarget.getBoundingClientRect();
        still.current = prefersReducedMotion();
        start.current = { x: touch.clientX, y: touch.clientY };
      },
      onTouchMove: (e) => {
        const from = start.current;
        const rect = box.current;
        if (!from || !rect) return;
        if (e.touches.length !== 1) return abandon();
        const touch = e.touches[0]!;
        axis.current ??= gestureAxis(touch.clientX - from.x, touch.clientY - from.y);
        // Not horizontal, or not yet: the button still has its tap.
        if (axis.current !== 'x') return;
        const next = tabUnder(touch.clientX, rect.left, rect.width, count);
        if (next !== over.current) {
          // A tick per boundary, which is the whole of what a scrub can
          // say without looking at the screen.
          if (over.current !== null) gestureHaptic();
          over.current = next;
          setAt(next);
        }
        if (still.current) return;
        const node = bar.current;
        if (!node) return;
        node.dataset.navScrub = '';
        if (pill.current)
          node.style.setProperty(
            '--nav-pill-left',
            `${pillAt(touch.clientX, rect.left, rect.width, pill.current.offsetWidth)}px`,
          );
      },
      onTouchEnd: (e) => {
        const rect = box.current;
        const touch = e.changedTouches[0];
        const claimed = axis.current === 'x' && over.current !== null;
        const lands =
          claimed && rect && touch && inBand(touch.clientY, rect.top, rect.bottom) ? over.current : null;
        // Claimed either way: a scrub that ended off the bar chose nothing,
        // and the click behind it must not choose the tab it began on.
        if (claimed) swallow.current = true;
        if (lands !== null) onPick(lands);
        release();
        forget();
      },
      onTouchCancel: abandon,
    },
  };
}
