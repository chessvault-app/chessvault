import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * Past this much of a horizontal drag, letting go turns to the next pane.
 *
 * Well under the 96px a swipe-row asks for, and deliberately: that gesture
 * deletes a game, this one changes which panel is on screen and the tab
 * strip above undoes it in one tap. What a cheap, reversible act should
 * cost is the smallest movement that cannot be a tap or a scroll.
 */
const THRESHOLD = 56;

/** How far a finger must travel before the gesture has an axis at all. */
const SLOP = 8;

/**
 * How far from a screen edge a gesture has to start.
 *
 * Both platforms read a swipe that begins on the edge as Back (and iOS the
 * right edge as Forward). A gesture that starts in the middle of the panel
 * is nobody else's; one that starts on the edge belongs to the browser.
 * Guarded on both sides, unlike swipe-row's left-only rule, because this
 * gesture goes both ways.
 */
const EDGE_PX = 32;

/**
 * How far the pane travels — both halves of the turn, one number.
 *
 * The pane the finger pushes aside stops here, and the pane that replaces
 * it starts exactly this far the other way, so the handover cannot come
 * out lopsided. Small on purpose: what shows beside a leaning pane is the
 * page's own background rather than the next pane — they are separate
 * elements at separate heights, see the note on the hook — so this is a
 * panel getting out of the way, not a curtain being drawn across. Further
 * than this and the gap reads as the column coming apart.
 */
const SLIDE_PX = 32;

/**
 * What share of the finger's movement the pane takes before the cap.
 *
 * Half, so the panel is plainly following the thumb and just as plainly
 * not going anywhere yet: the strip above is what says where it lands.
 */
const FOLLOW = 0.5;

/**
 * The same two numbers at an end of the strip, where the swipe has nowhere
 * to go.
 *
 * A wall the finger can still feel: the pane gives a little and stops,
 * which is the only cue that this is the first tab or the last. It is what
 * `paneAfterSwipe` already refuses to do, said during the gesture instead
 * of after it — before, an end-of-strip swipe and a swipe onto the next
 * pane looked identical right up until nothing happened.
 */
const WALL_FOLLOW = 0.15;
const WALL_PX = 10;

/**
 * How long the pane takes to settle, whether it turned or sprang back.
 *
 * The JS half of `--pane-turn` in index.css, which is what actually times
 * the motion — this is only how long the column is left carrying it. It
 * must not be the shorter of the two, or the offset is taken away
 * mid-transition and the pane jumps the rest of the way.
 */
const SETTLE_MS = 200;

/**
 * How dim the arriving pane starts.
 *
 * A pane that only slid was a panel nudging sideways; one that also fades
 * up is a different panel. Not from nothing — the content is what the
 * gesture was for, and starting it invisible spends the whole animation
 * getting back to legible.
 */
const ENTER_OPACITY = 0.55;

/**
 * The pane on one side of the open one, or null if that side is the end of
 * the strip.
 *
 * Dragging left pulls the NEXT pane in from the right — the panes are the
 * row the tab strip draws, and the finger moves the row. No wrapping:
 * the strip has a first tab and a last one, and a gesture that jumped from
 * one end to the other would be the only thing on the page saying the row
 * is a ring.
 */
export function paneBeside<T extends string>(
  ids: readonly T[],
  value: T,
  dx: number,
): T | null {
  const from = ids.indexOf(value);
  if (from < 0) return null;
  return ids[from + (dx < 0 ? 1 : -1)] ?? null;
}

/** The pane a finished gesture lands on, or null if it lands nowhere —
    which is either side of the threshold, or either end of the strip. */
export function paneAfterSwipe<T extends string>(
  ids: readonly T[],
  value: T,
  dx: number,
): T | null {
  if (Math.abs(dx) < THRESHOLD) return null;
  return paneBeside(ids, value, dx);
}

/**
 * How far the pane sits from its resting place, part-way through a drag.
 *
 * Damped and capped in both cases, because the pane is not a track being
 * scrolled to a destination — it is one panel leaning towards the edge it
 * would leave by. `room` is whether there is a pane that way at all; where
 * there is not, the same movement buys a sixth as much.
 */
export function dragOffset(dx: number, room: boolean): number {
  const follow = room ? FOLLOW : WALL_FOLLOW;
  const cap = room ? SLIDE_PX : WALL_PX;
  return Math.sign(dx) * Math.min(Math.abs(dx) * follow, cap);
}

/**
 * The axis a gesture has committed to, or null while it is still too small
 * to tell.
 *
 * Once it is decided it stays decided, exactly as in swipe-row: a column
 * that stole every diagonal drag would be a column you cannot scroll, and
 * the panes under a board are scrolled far more often than they are
 * switched.
 */
export function gestureAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/**
 * Whether something inside the column has already claimed sideways
 * movement, so the swipe must keep its hands off this gesture.
 *
 * Three kinds, all of them real and all of them inside these columns:
 * a control that declares `touch-action: none` has said outright that it
 * handles its own gestures (the review strip is scrubbed sideways, the
 * resize grips are dragged); a box that actually scrolls sideways owns
 * horizontal within its own bounds (the NAG chip rows under a study's
 * annotations); and a text field's horizontal drag is a selection.
 */
function claimedByContent(from: EventTarget | null, root: Element): boolean {
  let el = from instanceof Element ? from : null;
  while (el && el !== root) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
    if (el instanceof HTMLElement && el.isContentEditable) return true;
    const style = getComputedStyle(el);
    if (style.touchAction === 'none') return true;
    if (
      el.scrollWidth > el.clientWidth &&
      (style.overflowX === 'auto' || style.overflowX === 'scroll')
    )
      return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Swipe sideways across the panes under a board to turn to the next one.
 *
 * On a phone the panels beside a board become one pane at a time behind
 * PaneTabs (see components/pane-tabs), and reaching the strip means a trip
 * back to the top of the column with a thumb that is already down on the
 * panel. This is the accelerator for that: the same page turn, made where
 * the reading is happening. The strip stays the visible switcher — it is
 * what says how many panes there are and which one is open — and this adds
 * no state of its own, so a swipe and a tap are the same act.
 *
 * A hook returning handlers to spread, like useSwipeRow, and for the same
 * reason: only the page knows which box is the pane region. It is spread on
 * the COLUMN, never on the board — a drag on the board moves a piece.
 *
 * Touch only. A mouse has the strip, and a horizontal mouse drag is a
 * selection.
 *
 * The pane MOVES, and it moves without the column being rebuilt around it.
 * The panes are separate elements at separate heights in a column whose
 * geometry every board page has tuned (see components/layout), so they
 * cannot be gathered into one sliding track without changing that geometry
 * on the desktop too. What travels instead is every child of the column at
 * once, carried by two custom properties this hook writes on the column
 * itself — `--pane-dx` and `--pane-fade`, read by the rule in index.css
 * that `data-pane-swipe` switches on. Moving all of them is moving the one
 * that can be seen, because on these layouts only one pane is on screen;
 * the strip opts out with `data-pane-strip`, being the fixed thing the
 * turning is measured against.
 *
 * Written straight to the node rather than held in state: these columns
 * ARE the board pages — a move tree, an engine, an explorer — and a render
 * per touchmove would re-run all of that sixty times a second to change
 * one transform. useSwipeRow can afford `useState` because a row is a row.
 *
 * A tap on the strip stays instant. It has no direction — it can jump two
 * tabs at once — and giving it one would be the page guessing which way
 * the reader thinks they went.
 */
export function usePaneSwipe<T extends string>({
  panes,
  value,
  onChange,
  enabled = true,
}: {
  /** The panes in strip order — pass the SAME array PaneTabs is given, so
      the two cannot come to disagree about the order or the count. */
  panes: readonly { id: T }[];
  value: T;
  onChange: (id: T) => void;
  /** False wherever the page is showing every pane at once: the strip is
      not on screen, so neither is the row this gesture turns. */
  enabled?: boolean;
}): {
  // Typed to the element rather than to `Element`, because the column is
  // what the offset is written on and only an HTMLElement has a `style`.
  onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
} {
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'x' | 'y' | null>(null);
  const dx = useRef(0);
  /** The column the handlers are spread on, kept because the settle
      outlives the gesture that started it. */
  const column = useRef<HTMLElement | null>(null);
  const settling = useRef<number | null>(null);
  /** Which turn the pending frame belongs to. Anything that ends a turn —
      the backstop above, a new gesture — moves it on, and a frame that
      arrives after that has nothing left to walk home. */
  const turn = useRef(0);
  /** Read once per gesture rather than once per frame, and per gesture
      rather than at mount, so a setting changed mid-session is honoured. */
  const still = useRef(false);

  const ids = panes.map((pane) => pane.id);

  const stopSettling = (): void => {
    if (settling.current === null) return;
    clearTimeout(settling.current);
    settling.current = null;
  };

  /** Put the column at an offset, or take the whole thing off it again: at
      rest the column carries neither the attribute nor the properties, so
      nothing about it belongs to this hook until a finger says so. */
  const paint = (mode: 'drag' | 'settle' | null, offset = 0, fade = 1): void => {
    const node = column.current;
    if (!node) return;
    if (mode === null) {
      node.removeAttribute('data-pane-swipe');
      node.style.removeProperty('--pane-dx');
      node.style.removeProperty('--pane-fade');
      return;
    }
    node.dataset.paneSwipe = mode;
    node.style.setProperty('--pane-dx', `${offset}px`);
    node.style.setProperty('--pane-fade', String(fade));
  };

  /** Take the column back to rest once the motion has had its time.
      Armed the moment a pane is put off to one side, not only when the
      transition that walks it home starts — a tab backgrounded on the
      release frame never runs that frame, and what it left behind was a
      panel parked 32px out and half faded until the next gesture. */
  const clearLater = (): void => {
    stopSettling();
    settling.current = window.setTimeout(() => {
      settling.current = null;
      turn.current++;
      paint(null);
    }, SETTLE_MS);
  };

  /** Hand the offset to the transition, and clear up behind it. */
  const settle = (): void => {
    paint('settle', 0, 1);
    clearLater();
  };

  const forget = (): void => {
    start.current = null;
    axis.current = null;
    dx.current = 0;
  };

  /** A gesture that ends without turning a pane: put the panel back. */
  const springBack = (): void => {
    if (column.current?.hasAttribute('data-pane-swipe')) settle();
    forget();
  };

  // A column unmounted mid-settle leaves a timer pointing at a node that is
  // no longer on the page.
  useEffect(() => stopSettling, []);

  return {
    onTouchStart: (e) => {
      forget();
      turn.current++;
      if (!enabled) return;
      // A second finger is a pinch or a two-finger scroll, never a page
      // turn.
      if (e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      if (touch.clientX < EDGE_PX || touch.clientX > window.innerWidth - EDGE_PX) return;
      if (claimedByContent(e.target, e.currentTarget)) return;
      column.current = e.currentTarget;
      still.current = prefersReducedMotion();
      start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchMove: (e) => {
      if (!start.current) return;
      // A finger added mid-gesture: whatever this is, it stopped being a
      // swipe, and abandoning it is quieter than guessing.
      if (e.touches.length !== 1) return springBack();
      const touch = e.touches[0]!;
      const moveX = touch.clientX - start.current.x;
      const moveY = touch.clientY - start.current.y;
      axis.current ??= gestureAxis(moveX, moveY);
      if (axis.current !== 'x') return;
      dx.current = moveX;
      if (still.current) return;
      // The last gesture's settle must not wipe this one's offset out from
      // under it.
      stopSettling();
      paint('drag', dragOffset(moveX, paneBeside(ids, value, moveX) !== null));
    },
    onTouchEnd: () => {
      const next = axis.current === 'x' ? paneAfterSwipe(ids, value, dx.current) : null;
      if (next === null || next === value) return springBack();
      if (still.current) {
        onChange(next);
        return forget();
      }
      // The turn, across two frames. The arriving pane is put where the
      // leaving one was headed BEFORE it is asked for, so it mounts already
      // off to one side; the next frame walks it home. Reading `offsetWidth`
      // there is what makes that starting place a real computed style —
      // without it the pane has never been laid out where it starts, and
      // the browser has nothing to transition from.
      paint('drag', dx.current < 0 ? SLIDE_PX : -SLIDE_PX, ENTER_OPACITY);
      clearLater();
      onChange(next);
      forget();
      const mine = ++turn.current;
      requestAnimationFrame(() => {
        // A frame that arrives late enough for the backstop to have tidied
        // up, or for another gesture to have started, is not this turn's
        // any more.
        if (turn.current !== mine || !column.current) return;
        void column.current.offsetWidth;
        settle();
      });
    },
    onTouchCancel: springBack,
  };
}
