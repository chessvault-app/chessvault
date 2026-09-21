import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * How far a finger must travel before the gesture has an axis at all.
 *
 * The same 8px the pane swipe uses (hooks/use-pane-swipe): under it a
 * finger has not said anything yet, and the two gestures live on the same
 * pages, so they must stop guessing at the same moment.
 */
const SLOP = 8;

/**
 * How much more vertical than horizontal a pull has to be to be a pull.
 *
 * Three halves, not the pane swipe's plain comparison. That gesture is the
 * only one on its column, so every drag is either a turn or a scroll; this
 * one shares a page with the horizontal pane flick and with sideways chip
 * rows, and a diagonal it claimed would be a flick that did not turn. A
 * pull is a thumb going straight down, and anything else is somebody
 * else's.
 */
const VERTICAL_RATIO = 1.5;

/**
 * Where the spinner comes to rest while the refetch runs, and how far the
 * pull can ever reach.
 *
 * REST is the distance that commits: about a thumb's length of travel on
 * the screen, and the same number the circle sits at afterwards, so the
 * release does not move it. MAX is the asymptote of the curve below, never
 * a stop the finger hits, which is what keeps the band from reading as a
 * drawer that has opened.
 */
const PULL_REST = 64;
const PULL_MAX = 160;

/**
 * How far the indicator has travelled for a finger that has gone `dy`.
 *
 * One to one at the start and slower the further it goes, asymptotic to
 * PULL_MAX: the first pixels answer the finger exactly, so the gesture is
 * discovered by pulling rather than by pulling far enough, and the last
 * ones cost more and more, which is what says the band has a bottom
 * without ever drawing one. `dy * MAX / (MAX + dy)` is the cheapest curve
 * with both properties (slope 1 at 0, limit MAX) and it is one expression,
 * so a test can state it.
 *
 * At PULL_MAX 160 a commit costs about 107px of finger, which is a
 * deliberate pull and not a scroll that overran.
 */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return (dy * PULL_MAX) / (PULL_MAX + dy);
}

/** How full the spinner is drawn, 0 to 1: the whole of it at the commit. */
export function pullProgress(distance: number): number {
  return Math.max(0, Math.min(1, distance / PULL_REST));
}

/** Whether letting go here refetches. */
export function pullCommits(distance: number): boolean {
  return distance >= PULL_REST;
}

/**
 * The axis a gesture has committed to, or null while it is too small to
 * tell. 'y' only for a downward pull: a drag UP at the top of a list is a
 * scroll that has nowhere to go, and claiming it would swallow the flick.
 */
export function pullAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return null;
  if (dy > 0 && Math.abs(dy) > Math.abs(dx) * VERTICAL_RATIO) return 'y';
  return 'x';
}

/**
 * Whether a scroller can be pulled at all right now: only from its top.
 *
 * Exactly zero, not a few pixels of grace. A list one line down is a list
 * being read, and a refresh that fired there would take the rows out from
 * under the reader's thumb. iOS reports a negative scrollTop through its
 * own rubber band, which is still the top.
 */
export function canPull(scrollTop: number): boolean {
  return scrollTop <= 0;
}

/**
 * How long the spinner stays on screen at the least.
 *
 * A vault served from the same machine answers in single-digit
 * milliseconds, so without this the whole gesture is a circle that
 * appears and vanishes in the same frame: the page looks like it ignored
 * you, and the only way to tell it did not is to notice a row that
 * changed. Four hundred is long enough to read as an answer and short
 * enough that a fast refetch still feels fast.
 */
const MIN_VISIBLE_MS = 400;

/** Whether this is a finger at all. A mouse has the page's own controls,
    and a vertical mouse drag is a selection. */
function coarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Whether something between the touch and the scroller has already
 * claimed this gesture.
 *
 * The same three kinds the pane swipe refuses (hooks/use-pane-swipe), read
 * for the other axis: a control that declares `touch-action: none` handles
 * its own drags, a box that actually scrolls vertically inside the page
 * owns vertical within its own bounds, and a drag inside a text field is a
 * selection.
 */
function claimed(from: EventTarget | null, root: Element): boolean {
  let el = from instanceof Element ? from : null;
  while (el && el !== root) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
    if (el instanceof HTMLElement && el.isContentEditable) return true;
    const style = getComputedStyle(el);
    if (style.touchAction === 'none') return true;
    if (
      el.scrollHeight > el.clientHeight &&
      (style.overflowY === 'auto' || style.overflowY === 'scroll')
    )
      return true;
    el = el.parentElement;
  }
  return false;
}

/** A sheet, a dialog or a menu is open over the page. The gesture belongs
    to whatever is on top, and the list under it is not being read. */
function layerOpen(): boolean {
  return document.querySelector('[data-slot="dialog-content"], [role="dialog"], [role="menu"]') !== null;
}

/** A field has the caret. The keyboard is up, the page is shifted, and a
    drag is the user reaching for their own text. */
function fieldFocused(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * Pull a list down from its top to fetch it again.
 *
 * The vault is not this client's alone: the desktop app writes to it while
 * a phone is looking at it, and the archive browser's rows come from
 * Lichess and chess.com, which go on being played in. Every one of those
 * lists had exactly one way to ask again, which was to leave the page and
 * come back, and on an installed PWA there is no reload button to fall
 * back to. This is both platforms' answer to that (iOS's own control and
 * Material's are the same gesture), so it is not gated by platform; only
 * the indicator is drawn, and it is drawn one way on both.
 *
 * Touch only, from the very top of the scroller, and only for a pull that
 * is clearly vertical: the board pages' panes are flicked sideways on the
 * same phone (hooks/use-pane-swipe), and a gesture that took diagonals
 * would be a pane turn that refreshed instead.
 *
 * The distance is written STRAIGHT to the indicator as custom properties,
 * never held in state. React gives a continuous event's update a task of
 * its own (see the note in use-pane-swipe), so a setState per touchmove
 * lands a frame late and re-renders the whole list — which on the archive
 * is a decade of rows — to move one circle.
 *
 * Nothing here sets `overscroll-behavior`, and it was checked rather than
 * assumed: `html` and `body` already say `none` and every scroller under
 * `#root` says `contain` (styles/base.css), which is exactly what stops
 * Android Chrome's own pull-to-refresh firing behind this one in a browser
 * tab, and an installed PWA in standalone has it on Android and not on
 * iOS. So the app is already contained everywhere this gesture can run,
 * and a scroller that lost the rule would be a page that also bounced the
 * whole shell. iOS's native rubber band still moves the page under the
 * indicator, which is left alone: that is what its own control looks like.
 *
 * Nor does anything here preventDefault, so the listeners stay passive and
 * the scroll they ride on is never blocked on this hook's main thread.
 */
export function usePullRefresh({
  onRefresh,
  enabled = true,
}: {
  /** Fetch the list again. Its promise is what the spinner waits on, so a
      handler that does not return one spins for the minimum and stops. */
  onRefresh: () => void | Promise<unknown>;
  /** False where the page has nothing to refetch, or is not the one being
      read (a pane that is closed, a tab that is not open). */
  enabled?: boolean;
}): {
  /** The scroller the gesture is read from. */
  scrollerRef: (node: HTMLElement | null) => void;
  /** The indicator (components/pull-refresh), which must be inside that
      scroller: it is what the distance is written to. */
  indicatorRef: (node: HTMLElement | null) => void;
} {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const indicator = useRef<HTMLElement | null>(null);
  /** Running, so a second pull cannot start a second refetch. */
  const busy = useRef(false);

  const refresh = useEffectEvent(onRefresh);

  useEffect(() => {
    if (!scroller || !enabled) return;
    let start: { x: number; y: number } | null = null;
    let axis: 'x' | 'y' | null = null;
    let distance = 0;
    /** Read once per gesture, so a setting changed mid-session is honoured. */
    let still = false;
    let live = true;

    /** Move the circle. Written to the node, not to state. */
    const paint = (state: 'pulling' | 'refreshing' | null, at: number): void => {
      const node = indicator.current;
      if (!node) return;
      if (state === null) {
        delete node.dataset.pull;
        node.style.removeProperty('--pull-y');
        node.style.removeProperty('--pull-p');
        return;
      }
      node.dataset.pull = state;
      node.style.setProperty('--pull-y', `${at}px`);
      node.style.setProperty('--pull-p', String(pullProgress(at)));
    };

    const forget = (): void => {
      start = null;
      axis = null;
      distance = 0;
    };

    /** The gesture is over: refetch if it went far enough, then put the
        circle back. The minimum is counted from the moment the spinner
        appears, not from the moment the finger left. */
    const release = (commit: boolean): void => {
      forget();
      if (!commit) {
        paint(null, 0);
        return;
      }
      busy.current = true;
      paint('refreshing', PULL_REST);
      const shown = performance.now();
      void Promise.resolve(refresh())
        .catch(() => {
          // The page says what went wrong in its own words; this gesture
          // only ever promised to ask again.
        })
        .then(() => {
          const left = MIN_VISIBLE_MS - (performance.now() - shown);
          window.setTimeout(
            () => {
              busy.current = false;
              if (live) paint(null, 0);
            },
            Math.max(0, left),
          );
        });
    };

    const onStart = (e: TouchEvent): void => {
      forget();
      if (busy.current) return;
      // A second finger is a pinch or a two-finger scroll, never a pull.
      if (e.touches.length !== 1) return;
      if (!coarsePointer()) return;
      if (!canPull(scroller.scrollTop)) return;
      if (layerOpen() || fieldFocused()) return;
      if (claimed(e.target, scroller)) return;
      const touch = e.touches[0]!;
      still = prefersReducedMotion();
      start = { x: touch.clientX, y: touch.clientY };
    };

    const onMove = (e: TouchEvent): void => {
      if (!start) return;
      if (e.touches.length !== 1) return void release(false);
      const touch = e.touches[0]!;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // Spelt out rather than `??=`, which the React Compiler cannot lower.
      if (axis === null) axis = pullAxis(dx, dy);
      if (axis !== 'y') return;
      // The list moved under the gesture after all: it is a scroll.
      if (!canPull(scroller.scrollTop)) return void release(false);
      distance = pullDistance(dy);
      // Reduced motion keeps the distance but draws none of the travel:
      // nothing on screen until the pull has committed, and then the
      // spinner at rest. The threshold is the same threshold.
      if (still) return;
      paint('pulling', distance);
    };

    const onEnd = (): void => {
      const commit = axis === 'y' && pullCommits(distance);
      release(commit);
    };

    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: true });
    scroller.addEventListener('touchend', onEnd, { passive: true });
    scroller.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      live = false;
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  }, [scroller, enabled]);

  return {
    scrollerRef: setScroller,
    indicatorRef: (node) => {
      indicator.current = node;
    },
  };
}
