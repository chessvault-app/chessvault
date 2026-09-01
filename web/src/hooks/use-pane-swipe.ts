import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

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
 * The gutter between two panes while they travel together.
 *
 * The row is a row of separate panels, not a filmstrip cut from one image,
 * and a gap is what says so: part-way through a turn the page shows the
 * edge of the pane being left and the edge of the one arriving with the
 * column's own background between them. Matched to the column's vertical
 * `gap-3`, so the spacing between two panes reads the same whichever way
 * they are stacked.
 */
const GAP_PX = 12;

/**
 * What share of the trip commits the turn when the finger is lifted.
 *
 * A third, not the half that "past the middle" would suggest: the gesture
 * is cheap and the strip above undoes it in one tap, so the reading that
 * costs less is the one that turns. It is a SHARE now rather than the
 * fixed 56px it was — the pane travels the width of the column instead of
 * a token 32px, so what counts as most of the way is a property of the
 * column, not a number.
 */
const COMMIT_SHARE = 0.3;

/**
 * A flick: fast enough to turn on however little ground it covered.
 *
 * Without this a share-of-the-width threshold refuses the gesture people
 * actually use to page, because a fast flick is a short one. Read over the
 * last 100ms of the finger's path, so one that races out and then rests
 * still lands as the drag it ended as.
 */
const FLICK_PX_PER_MS = 0.5;

/**
 * The same gesture at an end of the strip, where the swipe has nowhere to
 * go.
 *
 * A wall the finger can still feel: the pane gives a little and stops,
 * which is the only cue that this is the first tab or the last. It is also
 * what an overshoot past the arriving pane meets, so one gesture can never
 * turn two panes at once.
 */
const WALL_FOLLOW = 0.2;
const WALL_PX = 24;

/**
 * How long the row takes to settle, whether the turn completed or fell
 * back.
 *
 * The JS half of `--pane-turn` in index.css, which is what actually times
 * the motion — this is only how long the column is left carrying it. It
 * must not be the shorter of the two, or the offset is taken away
 * mid-transition and the row jumps the rest of the way.
 */
const SETTLE_MS = 200;

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
export function paneBeside<T extends string>(ids: readonly T[], value: T, dx: number): T | null {
  const from = ids.indexOf(value);
  if (from < 0) return null;
  return ids[from + (dx < 0 ? 1 : -1)] ?? null;
}

/**
 * Whether a finished gesture turns the page: most of the way across, or
 * fast enough that it did not have to be.
 *
 * `span` is the whole trip — the pane's width plus the gutter — so both
 * halves of this are read against the distance the finger could see moving.
 */
export function swipeCommits(dx: number, span: number, velocity: number): boolean {
  if (Math.abs(dx) < SLOP) return false;
  if (span > 0 && Math.abs(dx) >= span * COMMIT_SHARE) return true;
  return Math.sign(velocity) === Math.sign(dx) && Math.abs(velocity) >= FLICK_PX_PER_MS;
}

/** The pane a finished gesture lands on, or null if it lands nowhere —
    which is either an uncommitted drag, or either end of the strip. */
export function paneAfterSwipe<T extends string>(
  ids: readonly T[],
  value: T,
  dx: number,
  span: number,
  velocity = 0,
): T | null {
  if (!swipeCommits(dx, span, velocity)) return null;
  return paneBeside(ids, value, dx);
}

/**
 * How far the row sits from its resting place, part-way through a drag.
 *
 * One to one, because the two panes are a row the finger is holding: the
 * pane being left and the pane arriving move together, a gutter apart, so
 * the offset IS the movement and letting go only pulls in the gap that is
 * left. `span` is how far there is to go — the pane's width plus that
 * gutter — and 0 means there is no pane that way at all, where the same
 * movement buys a fifth as much and stops. Past the end of the trip it
 * damps the same way, so one gesture cannot turn two panes.
 */
export function dragOffset(dx: number, span: number): number {
  const sign = Math.sign(dx);
  const wall = (past: number): number => Math.min(past * WALL_FOLLOW, WALL_PX);
  if (span <= 0) return sign * wall(Math.abs(dx));
  const over = Math.abs(dx) - span;
  return over <= 0 ? dx : sign * (span + wall(over));
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
 * The panes of a column that are on screen: its children, less the fixed
 * furniture that opts out with `data-pane-strip` (the tab strip, the
 * control row at the floor), less everything a breakpoint has hidden —
 * `display: none` is how the board pages put a closed pane away, and a box
 * in that state has no boxes.
 *
 * At rest that is exactly one box, the open pane. While a turn is being
 * dragged it is two, and which is which is not read from this list: the
 * open one was noted before the other arrived.
 */
function panesOnScreen(column: HTMLElement): HTMLElement[] {
  return [...column.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      !el.hasAttribute('data-pane-strip') &&
      el.getClientRects().length > 0,
  );
}

/** The custom properties the column carries for the length of a turn, and
    nothing longer: at rest it holds none of them. */
const PROPS = [
  '--pane-dx',
  '--pane-span',
  '--pane-side',
  '--pane-top',
  '--pane-left',
  '--pane-width',
  '--pane-height',
];

/**
 * Swipe sideways across the panes under a board to turn to the next one.
 *
 * On a phone the panels beside a board become one pane at a time behind
 * PaneTabs (see components/pane-tabs), and reaching the strip means a trip
 * back to the top of the column with a thumb that is already down on the
 * panel. This is the accelerator for that: the same page turn, made where
 * the reading is happening. The strip stays the visible switcher — it is
 * what says how many panes there are and which one is open — so a swipe
 * and a tap are the same act.
 *
 * The panes travel as a ROW. The pane being left and the pane arriving are
 * both on screen for the whole gesture, a gutter apart, and they follow the
 * finger one to one across the full width of the column; letting go pulls
 * in whatever gap is left, or puts the row back where it was. Before this
 * the pane leaned 32px and swapped on release, which is a different claim
 * about what these panels are: a row you are holding, rather than a panel
 * that nods at you and then changes.
 *
 * Two things make that possible without gathering the panes into one
 * sliding track — which cannot be done, because they are separate elements
 * at separate heights in a column whose geometry every board page has
 * tuned (see components/layout), and three of the five pages do not keep
 * the closed ones mounted at all:
 *
 *  - The page is asked to SHOW the neighbour for the length of the
 *    gesture. `shows(id)` answers for the open pane and for the one being
 *    dragged in, and each column asks it in its own idiom — a class that
 *    hides, or a condition that renders. It changes twice in a turn, not
 *    sixty times a second.
 *  - The neighbour is then lifted out of the column's flow and stood at
 *    the open pane's own box, one span to the side, by the rule in
 *    index.css that `data-pane-peek` switches on. The column carries the
 *    numbers as custom properties, so a column that has never laid out two
 *    panes at once still does not.
 *
 * Which child is which is not read from the DOM order — it cannot be, the
 * trainers render their panes in a different order from their strip — but
 * from what was on screen before the neighbour was asked for.
 *
 * The offsets are written straight to the node rather than held in state:
 * these columns ARE the board pages — a move tree, an engine, an explorer
 * — and a render per touchmove would re-run all of that sixty times a
 * second to change one transform.
 *
 * Touch only. A mouse has the strip, and a horizontal mouse drag is a
 * selection.
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
  /** Spread on the COLUMN, never on the board — a drag on the board moves
      a piece. */
  column: {
    // Typed to the element rather than to `Element`, because the column is
    // what the offsets are written on and only an HTMLElement has a
    // `style`.
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
  /** Whether a pane has to be on screen right now: the open one always,
      and the neighbour for as long as a turn is being dragged. Every
      column asks this where it used to compare against the open pane's id
      — the same comparison, with the gesture allowed a say. */
  shows: (id: T) => boolean;
} {
  /** The pane being dragged in, and which side of the open one it stands
      on (+1 right, -1 left). State, because only the page can put a pane on
      screen. It moves when a turn starts, when the finger crosses back over
      where it began, and when the turn completes. */
  const [beside, setBeside] = useState<{ id: T; side: 1 | -1 } | null>(null);

  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'x' | 'y' | null>(null);
  const dx = useRef(0);
  /** The tail of the finger's path, for the flick test. */
  const path = useRef<{ x: number; t: number }[]>([]);
  /** The column the handlers are spread on, kept because the settle
      outlives the gesture that started it. */
  const column = useRef<HTMLElement | null>(null);
  /** The two panes on screen. The open one is noted before the neighbour is
      asked for, which is what makes the neighbour identifiable. */
  const open = useRef<HTMLElement | null>(null);
  const peek = useRef<HTMLElement | null>(null);
  /** The open pane's box within the column, measured at the same moment —
      which has to be BEFORE the neighbour is asked for. A neighbour that
      arrives is in the column's flow for the one render it takes to lift it
      out, and a column laid out with two panes down it has already squeezed
      the first: measured after, the row would stand itself up at half the
      height it is about to go back to. */
  const geom = useRef<{ top: number; left: number; width: number; height: number } | null>(null);
  /** The whole trip: the pane's width plus the gutter. 0 while there is no
      neighbour to travel to, which is what `dragOffset` reads as a wall. */
  const span = useRef(0);
  const settling = useRef<number | null>(null);
  /** Which turn the pending frame belongs to. Anything that ends a turn —
      the backstop below, a new gesture — moves it on, and a frame that
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

  /** Take the row off the neighbour and off the column: at rest neither
      carries anything of this hook's, so nothing about them belongs to it
      until a finger says so. */
  const unwire = (): void => {
    open.current?.removeAttribute('data-pane-open');
    peek.current?.removeAttribute('data-pane-peek');
    open.current = null;
    peek.current = null;
    geom.current = null;
    span.current = 0;
    const node = column.current;
    if (!node) return;
    node.removeAttribute('data-pane-swipe');
    for (const prop of PROPS) node.style.removeProperty(prop);
  };

  /** Move the row. */
  const paint = (mode: 'drag' | 'settle', offset: number): void => {
    const node = column.current;
    if (!node) return;
    node.dataset.paneSwipe = mode;
    node.style.setProperty('--pane-dx', `${offset}px`);
  };

  /**
   * Note which pane is open and how big it is, while that is still a
   * question with one answer: as soon as the neighbour is asked for there
   * are two panes on screen and neither of them says which it is.
   *
   * Re-read on every frame that has no row standing yet, rather than once
   * per gesture, so a pane switched at the strip during the last turn's
   * settle cannot leave this pointing at the wrong panel.
   */
  const noteOpenPane = (col: HTMLElement): void => {
    const shown = panesOnScreen(col);
    if (shown.length !== 1) {
      open.current = null;
      geom.current = null;
      return;
    }
    const node = shown[0]!;
    const colBox = col.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    open.current = node;
    // Against the column's own content, not the viewport: the neighbour
    // will be positioned inside a box that may itself be scrolled.
    geom.current = {
      top: box.top - colBox.top + col.scrollTop,
      left: box.left - colBox.left + col.scrollLeft,
      width: box.width,
      height: box.height,
    };
  };

  /**
   * Stand the neighbour beside the open pane: the open pane's own box,
   * lifted out of the column's flow, one span to the given side.
   *
   * That box rather than the neighbour's own, because the panes are not
   * interchangeable — an explorer with a dragged height and a move panel
   * that fills the column are different sizes in the same slot — and a
   * neighbour arriving at its own height is a panel of a different shape
   * sliding in rather than the same slot turning over.
   */
  const standBeside = (node: HTMLElement, side: 1 | -1): void => {
    const col = column.current;
    const from = open.current;
    const box = geom.current;
    if (!col || !from || !box) return;
    span.current = box.width + GAP_PX;
    col.style.setProperty('--pane-span', `${span.current}px`);
    col.style.setProperty('--pane-side', String(side));
    col.style.setProperty('--pane-top', `${box.top}px`);
    col.style.setProperty('--pane-left', `${box.left}px`);
    col.style.setProperty('--pane-width', `${box.width}px`);
    col.style.setProperty('--pane-height', `${box.height}px`);
    from.dataset.paneOpen = '';
    node.dataset.panePeek = '';
    peek.current = node;
  };

  // The neighbour has just been put on screen by the page: find it — it is
  // the pane that is on screen and was not — stand it beside the open one,
  // and only then move the row. Layout, not effect: a frame in which the
  // neighbour is still in the column's flow is the column laid out with two
  // panes down it, and that must never be painted.
  useLayoutEffect(() => {
    const col = column.current;
    if (!col || beside === null || peek.current || !open.current) return;
    const found = panesOnScreen(col).find((el) => el !== open.current);
    // Nothing arrived: no row to hold, so the gesture keeps the wall it has
    // had since the first frame — it gives a little and stops.
    if (!found) return;
    standBeside(found, beside.side);
    paint('drag', dragOffset(dx.current, span.current));
    // The arrival of `beside` is the whole trigger; re-running on a changed
    // handler would re-measure the box mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beside]);

  /** Take the column back to rest once the motion has had its time.
      Armed the moment the row is put off to one side, not only when the
      transition that walks it home starts — a tab backgrounded on the
      release frame never runs that frame, and what it left behind was a
      panel parked half off the column until the next gesture. */
  const clearLater = (): void => {
    stopSettling();
    settling.current = window.setTimeout(() => {
      settling.current = null;
      turn.current++;
      unwire();
      setBeside(null);
    }, SETTLE_MS);
  };

  /** Hand the offset to the transition, and clear up behind it. */
  const settle = (): void => {
    paint('settle', 0);
    clearLater();
  };

  const forget = (): void => {
    start.current = null;
    axis.current = null;
    dx.current = 0;
    path.current = [];
  };

  /** A gesture that ends without turning a pane: put the row back. */
  const springBack = (): void => {
    if (column.current?.hasAttribute('data-pane-swipe')) settle();
    else setBeside(null);
    forget();
  };

  /** How fast the finger was moving when it left, over the last 100ms of
      its path — a window, because the number between two touchmoves is
      noise, and the whole gesture's average calls a finger that raced out
      and then rested a flick. */
  const velocity = (): number => {
    const trail = path.current;
    const last = trail.at(-1);
    if (!last) return 0;
    const from = trail.find((p) => last.t - p.t <= 100) ?? trail[0]!;
    const ms = last.t - from.t;
    return ms > 0 ? (last.x - from.x) / ms : 0;
  };

  // A column unmounted mid-settle leaves a timer pointing at a node that is
  // no longer on the page.
  useEffect(() => stopSettling, []);

  return {
    shows: (id) => id === value || beside?.id === id,
    column: {
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
        path.current = [{ x: touch.clientX, t: performance.now() }];
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
        path.current.push({ x: touch.clientX, t: performance.now() });
        if (path.current.length > 8) path.current.shift();
        // Reduced motion keeps the instant swap this gesture had before it
        // moved at all: nothing on screen until the finger lifts. The trip
        // is still the column's width, because that is what the release
        // reads its share against.
        if (still.current) {
          span.current = paneBeside(ids, value, moveX) ? (column.current?.clientWidth ?? 0) : 0;
          return;
        }
        // The last gesture's settle must not wipe this one's offset out
        // from under it.
        stopSettling();
        // Which neighbour the finger is pulling on. It changes when the
        // finger crosses back over where it started, and the pane that was
        // being dragged in goes off screen again.
        if (!peek.current) noteOpenPane(e.currentTarget);
        // A column that is not showing exactly one pane is not a row this
        // gesture can turn, whatever the strip says.
        const next = open.current ? paneBeside(ids, value, moveX) : null;
        if (next !== (beside?.id ?? null)) {
          peek.current?.removeAttribute('data-pane-peek');
          peek.current = null;
          span.current = 0;
          setBeside(next === null ? null : { id: next, side: moveX < 0 ? 1 : -1 });
          // The row is stood up by the layout effect above, which paints its
          // first frame. Painting here would move the open pane across a gap
          // the neighbour has not arrived in yet.
          if (next !== null) return;
        }
        paint('drag', dragOffset(moveX, span.current));
      },
      onTouchEnd: () => {
        const next =
          axis.current === 'x'
            ? paneAfterSwipe(ids, value, dx.current, span.current, velocity())
            : null;
        if (next === null || next === value) return springBack();
        // Reduced motion, or a neighbour the page never put on screen:
        // there is no row to walk home, so the swap is the whole turn.
        if (still.current || !peek.current || !open.current) {
          onChange(next);
          return springBack();
        }
        // The turn completes by RE-ANCHORING rather than by moving. The two
        // panes are already where they are: the arriving one is made the
        // open one, the one being left becomes the neighbour on the other
        // side, and the offset is restated from the new pane's point of
        // view. Nothing on screen changes by that — which is the point,
        // because it lets the strip fill on the release frame while the
        // transition below pulls in only the gap that is left.
        const side = dx.current < 0 ? 1 : -1;
        const offset = dragOffset(dx.current, span.current) + side * span.current;
        const leaving = open.current;
        const arriving = peek.current;
        open.current = arriving;
        peek.current = leaving;
        arriving.removeAttribute('data-pane-peek');
        arriving.dataset.paneOpen = '';
        leaving.removeAttribute('data-pane-open');
        leaving.dataset.panePeek = '';
        column.current?.style.setProperty('--pane-side', String(-side));
        paint('drag', offset);
        setBeside({ id: value, side: -side as 1 | -1 });
        onChange(next);
        forget();
        const mine = ++turn.current;
        requestAnimationFrame(() => {
          // A frame that arrives late enough for the backstop to have tidied
          // up, or for another gesture to have started, is not this turn's
          // any more.
          if (turn.current !== mine || !column.current) return;
          // Reading `offsetWidth` is what makes the restated offset a real
          // computed style — without it the row has never been laid out
          // where it now stands, and the browser has nothing to transition
          // from.
          void column.current.offsetWidth;
          settle();
        });
      },
      onTouchCancel: springBack,
    },
  };
}
