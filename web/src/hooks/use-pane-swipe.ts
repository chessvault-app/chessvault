import { useRef } from 'react';

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
 * The pane a finished gesture lands on, or null if it lands nowhere.
 *
 * Dragging left pulls the NEXT pane in from the right — the panes are the
 * row the tab strip draws, and the finger moves the row. No wrapping:
 * the strip has a first tab and a last one, and a gesture that jumped from
 * one end to the other would be the only thing on the page saying the row
 * is a ring.
 */
export function paneAfterSwipe<T extends string>(
  ids: readonly T[],
  value: T,
  dx: number,
): T | null {
  if (Math.abs(dx) < THRESHOLD) return null;
  const from = ids.indexOf(value);
  if (from < 0) return null;
  return ids[from + (dx < 0 ? 1 : -1)] ?? null;
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
 * Nothing follows the finger. The panes are separate elements at separate
 * heights in a column whose geometry every board page has tuned (see
 * components/layout), and dragging them as one track would mean wrapping
 * them in a box that changes that geometry on the desktop too. So this
 * commits on release, which is also what makes a swipe and a tap on the
 * strip produce the identical instant swap.
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
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
} {
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'x' | 'y' | null>(null);
  const dx = useRef(0);

  const forget = (): void => {
    start.current = null;
    axis.current = null;
    dx.current = 0;
  };

  return {
    onTouchStart: (e) => {
      forget();
      if (!enabled) return;
      // A second finger is a pinch or a two-finger scroll, never a page
      // turn.
      if (e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      if (touch.clientX < EDGE_PX || touch.clientX > window.innerWidth - EDGE_PX) return;
      if (claimedByContent(e.target, e.currentTarget)) return;
      start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchMove: (e) => {
      if (!start.current) return;
      // A finger added mid-gesture: whatever this is, it stopped being a
      // swipe, and abandoning it is quieter than guessing.
      if (e.touches.length !== 1) return forget();
      const touch = e.touches[0]!;
      const moveX = touch.clientX - start.current.x;
      const moveY = touch.clientY - start.current.y;
      axis.current ??= gestureAxis(moveX, moveY);
      if (axis.current !== 'x') return;
      dx.current = moveX;
    },
    onTouchEnd: () => {
      if (axis.current === 'x') {
        const next = paneAfterSwipe(
          panes.map((pane) => pane.id),
          value,
          dx.current,
        );
        if (next !== null && next !== value) onChange(next);
      }
      forget();
    },
    onTouchCancel: forget,
  };
}
