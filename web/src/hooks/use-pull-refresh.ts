import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import { currentPlatform } from '@/lib/platform';

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
 * How far down the content is held on iOS while the refetch is out.
 *
 * UIRefreshControl's own band is 60pt and the content settles into it
 * rather than back to where the finger left it; 56 is that band less the
 * couple of points the app's own 28px indicator needs to sit centred in
 * it without touching either edge. Android has no hold at all: its
 * content never moved, so there is nothing to hold.
 */
const PULL_HOLD = 56;

/** Whether this phone draws iOS's control. Read once per gesture: the
    platform is decided before the first render and never changes. */
function iosLook(): boolean {
  return currentPlatform() === 'ios';
}

/**
 * Where the indicator rests while the refetch is out.
 *
 * Two numbers because the two platforms are resting two different
 * things. On iOS the number is the band the CONTENT is held open by, and
 * the spinner is centred in it; on Android it is how far the circle
 * itself has travelled down over content that never moved, which is the
 * same distance that committed, so the release does not move it.
 */
export function pullRest(ios: boolean): number {
  return ios ? PULL_HOLD : PULL_REST;
}

/**
 * How wide the gap is, for a finger that has gone `dy` on a scroller
 * whose own rubber band has already opened `band` of it.
 *
 * iOS Safari rubber-bands an `overflow-y: auto` element at its top
 * whatever `overscroll-behavior` says (contain stops the chain, not the
 * elasticity), and reports the bounce as a NEGATIVE scrollTop. That band
 * is the gap the indicator has to sit in, and the app cannot fight it:
 * nothing here preventDefaults. So the gap is whichever is larger, the
 * browser's band or this hook's own curve, and the difference is what
 * the app adds by translating the content (`pullOwn`). Where the band is
 * the larger the app adds nothing and the browser is doing all of it;
 * where there is no band at all — Android, a desktop window, a WebView
 * without the bounce — the app is doing all of it and the curve is
 * exactly what it always was.
 */
export function pullGap(dy: number, band: number): number {
  return Math.max(pullDistance(dy), Math.max(0, band));
}

/** How much of that gap the app has to open itself. Zero whenever the
    browser's band is already wider, which is what keeps the two from
    fighting. */
export function pullOwn(gap: number, band: number): number {
  return Math.max(0, gap - Math.max(0, band));
}

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
 * Material's are the same gesture), so the GESTURE is not gated by
 * platform. What it DRAWS is, because the two platforms disagree about
 * what moves: Material drops a raised circle down over content that
 * stays put, and iOS opens a gap above the content and stands a bare
 * activity indicator in it. This hook feeds both the same two numbers
 * and `components/pull-refresh` places them.
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
 * whole shell. What `contain` does NOT do on iOS is stop the elasticity:
 * Safari still rubber-bands the scroller itself at its top, which the
 * first pass read as "that is what its own control looks like" and which
 * lanph3re's screenshot showed it is not. The band dragged the page
 * header 200pt down and the indicator, pinned to a fixed spot, landed on
 * the header's buttons: two systems moving, neither knowing about the
 * other. They are one system now (`pullGap`), and the app adds only the
 * part of the gap the browser did not open.
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
}): (node: HTMLElement | null) => void {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  /**
   * The indicator, found inside the scroller by its slot rather than
   * handed over as a second ref.
   *
   * A ref for it would have to be returned from this hook and passed to
   * the component, and a ref object crossing a component boundary as a
   * prop is a shape the React Compiler refuses outright (measured: it
   * would not compile PageShell). It is one query, once per gesture, for
   * an element the caller has just rendered inside the element it also
   * gave us.
   */
  const indicator = useRef<HTMLElement | null>(null);
  /**
   * What the app moves to open the gap on iOS: the scrolling page's own
   * column, found the same way and for the same reason. It is the
   * element PageShell already draws, not a wrapper added for this: a box
   * between the scroller and the column would be a new percentage base
   * under every `min-h-full` a page passes.
   */
  const content = useRef<HTMLElement | null>(null);
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
    let ios = false;
    let live = true;
    let settle = 0;

    /**
     * Move the indicator, and on iOS the page under it. Written to the
     * nodes, not to state.
     *
     * Two numbers reach the CSS and the CSS does the geometry: `--pull-gap`
     * is how tall the gap at the top of the scroller is, and `--pull-own`
     * is how much of it this hook opened rather than the browser. The
     * indicator's own box rides the content, so where the spinner has to
     * be drawn inside it depends on both, and both platforms' placements
     * are one expression each in `components/pull-refresh`.
     */
    const paint = (state: 'pulling' | 'refreshing' | null, gap: number, own: number): void => {
      const node = indicator.current;
      const col = content.current;
      if (col && ios) {
        // The page header stays where it is and what is under it moves:
        // the gap opens BELOW the title row and the indicator sits in it
        // (lanph3re, 2026-09-21; the first version moved the whole column
        // and put the spinner above the title). So the column is not
        // transformed. It carries the distance, and one rule in
        // styles/pull-refresh.css moves every child of it that is not the
        // header, only while `data-pull-live` is on the column: a transform
        // left on those children at rest would re-anchor anything fixed
        // inside them.
        //
        // No transition while the finger is down: the content answers it
        // frame by frame. On release the hold is taken instantly and only
        // the close at the end is animated, on the app's spring, after
        // which the attribute comes off.
        window.clearTimeout(settle);
        const closing = state === null;
        col.style.setProperty(
          '--pull-transition',
          closing && !still ? 'transform var(--pane-turn) var(--pane-turn-ease)' : 'none',
        );
        col.style.setProperty('--pull-own', `${Math.max(0, own)}px`);
        if (!closing) col.dataset.pullLive = '';
        else {
          settle = window.setTimeout(() => {
            delete col.dataset.pullLive;
            col.style.removeProperty('--pull-own');
            col.style.removeProperty('--pull-transition');
          }, 500);
        }
      }
      if (!node) return;
      if (state === null) {
        delete node.dataset.pull;
        node.style.removeProperty('--pull-gap');
        node.style.removeProperty('--pull-own');
        node.style.removeProperty('--pull-p');
        return;
      }
      node.dataset.pull = state;
      node.style.setProperty('--pull-gap', `${gap}px`);
      node.style.setProperty('--pull-own', `${own}px`);
      node.style.setProperty('--pull-p', String(pullProgress(gap)));
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
        paint(null, 0, 0);
        return;
      }
      busy.current = true;
      // The browser's band, if there was one, springs back on its own the
      // moment the finger leaves, so the hold is the app's whole gap.
      paint('refreshing', pullRest(ios), ios ? pullRest(ios) : 0);
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
              if (live) paint(null, 0, 0);
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
      indicator.current = scroller.querySelector<HTMLElement>('[data-slot="pull-refresh"]');
      content.current = scroller.querySelector<HTMLElement>('[data-slot="pull-content"]');
      // Where the header ends, measured from the scroller's top as the pull
      // begins: the indicator hangs from the scroller's top edge and is
      // placed this far down, under the title row. A page with no header
      // leaves it unset and the placement falls back to the top inset.
      const heads = content.current?.querySelectorAll<HTMLElement>(':scope > [data-page-header]');
      const head = heads?.length ? heads[heads.length - 1] : null;
      if (indicator.current) {
        if (head) {
          const foot = head.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top;
          indicator.current.style.setProperty('--pull-head', `${Math.max(0, foot)}px`);
        } else indicator.current.style.removeProperty('--pull-head');
      }
      const touch = e.touches[0]!;
      still = prefersReducedMotion();
      ios = iosLook();
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
      // One read of scrollTop per move. On iOS it is negative through the
      // browser's own rubber band, and that band is part of the gap; on
      // every other platform it is 0 here and the gap is the curve alone.
      const band = ios ? -scroller.scrollTop : 0;
      distance = pullGap(dy, band);
      // Reduced motion keeps the distance but draws none of the travel:
      // nothing on screen until the pull has committed, and then the
      // spinner at rest. The threshold is the same threshold.
      if (still) return;
      paint('pulling', distance, ios ? pullOwn(distance, band) : 0);
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
      window.clearTimeout(settle);
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  }, [scroller, enabled]);

  // A callback ref of this hook's own, not the setter itself: the React
  // Compiler refuses a component that hands a `useState` setter straight
  // to a `ref` prop (measured on PageShell), and every other attaching
  // hook here (use-element-height) returns a callback the same way.
  const attach = (node: HTMLElement | null): void => {
    setScroller(node);
  };
  return attach;
}
