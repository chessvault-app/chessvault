import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { suppressNextClick } from '@/lib/suppressNextClick';

/**
 * Where a floating layer goes.
 *
 * Eight places in this app open a box next to something: the Select's
 * listbox, the row-actions popover, the opening picker, the `?` tip, the
 * title tooltip, and four peek cards. Every one of them worked out its
 * own coordinates, and they disagreed — three copies of the same
 * arithmetic across two files, and one popover with no horizontal clamp
 * at all, which is a list that runs off the right edge of the window.
 *
 * The geometry is a pure function of two rectangles and a viewport, so
 * it is tested rather than eyeballed (floating.test.ts). Nothing here
 * reads the DOM: the caller measures, this decides.
 */

/** A rectangle in viewport coordinates. A DOMRect satisfies this. */
export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Which side of the anchor the layer wants to be on. */
export type Side = 'top' | 'bottom' | 'left' | 'right';

/** Where it sits along the anchor's other axis. */
export type Align = 'start' | 'center' | 'end';

export interface PlaceOptions {
  /** Default 'bottom' — where a dropdown is expected to go. */
  side?: Side;
  /** Default 'start'. */
  align?: Align;
  /** Between the anchor and the layer. Default 4. */
  gap?: number;
  /** How close to the viewport edge the layer may come. Default 8. */
  margin?: number;
  /**
   * Take the opposite side when the preferred one cannot hold the layer
   * AND the opposite one holds more. Default true.
   *
   * Ties go to the preferred side: a dropdown belongs below its trigger,
   * and a rule that flips on "below is past the middle of the screen"
   * rather than on "below has no room" opens lists upward over the very
   * thing they came from.
   */
  flip?: boolean;
  /** Defaults to the window. Passed explicitly by the tests. */
  viewport?: Size;
}

export interface Placement {
  top: number;
  left: number;
  /** The side actually used, which `flip` may have changed. */
  side: Side;
  /**
   * How much room that side has between the anchor and the margin —
   * what a scrolling layer should cap its height (or width) to.
   */
  room: number;
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** Room between the anchor and the far edge, less the gap and the margin. */
function roomOn(side: Side, anchor: Box, view: Size, gap: number, margin: number): number {
  const raw =
    side === 'bottom'
      ? view.height - anchor.bottom
      : side === 'top'
        ? anchor.top
        : side === 'right'
          ? view.width - anchor.right
          : anchor.left;
  return Math.max(0, raw - gap - margin);
}

/** Keep a span of `length` inside [margin, extent - margin] where it can. */
function clamp(start: number, length: number, extent: number, margin: number): number {
  // A layer bigger than the space it must fit in is pinned to the near
  // edge rather than centred on nothing: the top-left corner is the part
  // worth keeping, because that is where a list starts reading.
  const last = Math.max(margin, extent - length - margin);
  return Math.min(Math.max(start, margin), last);
}

/**
 * Put a `size` box next to an `anchor` box, inside the viewport.
 *
 * Pure: no DOM, no window unless the caller omits `viewport`.
 */
export function placeNear(anchor: Box, size: Size, opts: PlaceOptions = {}): Placement {
  const {
    side: wanted = 'bottom',
    align = 'start',
    gap = 4,
    margin = 8,
    flip = true,
    viewport = { width: window.innerWidth, height: window.innerHeight },
  } = opts;

  let side = wanted;
  if (flip) {
    const need = wanted === 'top' || wanted === 'bottom' ? size.height : size.width;
    const here = roomOn(wanted, anchor, viewport, gap, margin);
    const there = roomOn(OPPOSITE[wanted], anchor, viewport, gap, margin);
    if (here < need && there > here) side = OPPOSITE[wanted];
  }
  const room = roomOn(side, anchor, viewport, gap, margin);

  // The main axis: hard against the anchor, on the chosen side.
  const main =
    side === 'bottom'
      ? anchor.bottom + gap
      : side === 'top'
        ? anchor.top - gap - size.height
        : side === 'right'
          ? anchor.right + gap
          : anchor.left - gap - size.width;

  // The cross axis: lined up with the anchor's near edge, its centre, or
  // its far edge.
  const vertical = side === 'top' || side === 'bottom';
  const anchorStart = vertical ? anchor.left : anchor.top;
  const anchorSize = vertical ? anchor.width : anchor.height;
  const crossSize = vertical ? size.width : size.height;
  const cross =
    align === 'start'
      ? anchorStart
      : align === 'center'
        ? anchorStart + (anchorSize - crossSize) / 2
        : anchorStart + anchorSize - crossSize;

  return vertical
    ? {
        side,
        room,
        top: clamp(main, size.height, viewport.height, margin),
        left: clamp(cross, size.width, viewport.width, margin),
      }
    : {
        side,
        room,
        top: clamp(cross, size.height, viewport.height, margin),
        left: clamp(main, size.width, viewport.width, margin),
      };
}

/**
 * Place a layer whose size only the browser knows.
 *
 * Every remaining floating layer in the app is content-sized — a listbox
 * is `w-max max-w-72`, a tip is as tall as its sentence — which is why
 * they anchored themselves with `bottom` and `right` and let the browser
 * resolve the rest. That works and it cannot flip, cap or clamp: nothing
 * in CSS knows whether the box fits.
 *
 * So: render it, measure it, place it, all before the browser paints.
 * `useLayoutEffect` is the whole trick — React re-renders synchronously
 * inside it, so the provisional position is never on screen. ActionSheet
 * has done this by hand for its vertical clamp since it was written;
 * this is that, generalised and with the geometry shared.
 *
 * Returns `hidden` for the one frame before the measurement exists.
 * Callers paint it anyway (`visibility: hidden`) rather than skipping
 * the render, because a layer that is not in the DOM cannot be measured.
 */
export function useFloating(
  anchor: Box | null,
  opts: PlaceOptions = {},
): {
  ref: (node: HTMLElement | null) => void;
  placement: Placement | null;
  /** position/top/left, plus visibility until the measurement lands. */
  style: CSSProperties;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const { side, align, gap, margin, flip, viewport } = opts;

  useLayoutEffect(() => {
    if (!anchor || !node) {
      setPlacement(null);
      return;
    }
    const seen = node.getBoundingClientRect();
    const natural = { width: seen.width, height: seen.height };
    const first = placeNear(anchor, natural, opts);
    // A layer taller than the room it has will be capped by the caller's
    // own max-height, so place the capped size rather than the natural
    // one: placing the tall version and letting the clamp pull it back
    // slides it over the anchor it belongs under. Same side as the first
    // pass, and no second flip — the decision has been made.
    const vertical = first.side === 'top' || first.side === 'bottom';
    const fitted = vertical
      ? { width: natural.width, height: Math.min(natural.height, first.room) }
      : { width: Math.min(natural.width, first.room), height: natural.height };
    setPlacement(placeNear(anchor, fitted, { ...opts, side: first.side, flip: false }));
    // The options are spread into the deps by hand: a caller writes them
    // as a literal, so the object is new on every render and depending on
    // it would re-measure forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, node, side, align, gap, margin, flip, viewport?.width, viewport?.height]);

  return {
    ref: setNode,
    placement,
    style: placement
      ? { position: 'fixed', top: placement.top, left: placement.left }
      : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' },
  };
}

/**
 * Close a floating layer when the press lands outside it.
 *
 * mousedown AND touchstart, because iOS synthesizes no mouse event for a
 * document listener when a tap lands on dead space — without the touch
 * half, a tap outside could not dismiss. And a dismissing TAP may only
 * dismiss: its synthesized click is swallowed, or it presses whatever it
 * landed on as well. Three of the six hand-written versions of this had
 * that second half and three did not, which is how a tap on an iPad
 * could close the opening picker and pick an opening underneath it in
 * the same gesture.
 *
 * `inside` is everything a press may land in without dismissing — the
 * layer, and usually the control that opened it.
 */
export function useDismiss(
  active: boolean,
  onDismiss: () => void,
  inside: Array<RefObject<HTMLElement | null>>,
  opts: {
    /**
     * What a scroll ANYWHERE ELSE means. A layer placed from a measured
     * rectangle points at a stale position the moment the page moves
     * under it, so 'close' is the default; 'ignore' is for a layer that
     * is not anchored to anything. A scroll INSIDE the layer is never
     * either — a long list scrolls itself.
     */
    scroll?: 'close' | 'ignore';
    /** Called instead of closing, for a layer that follows its anchor. */
    onScroll?: (e: Event) => void;
  } = {},
): void {
  // Through a ref, so a caller may pass a fresh array and fresh closures
  // every render without re-arming the listeners each time.
  const latest = useRef({ onDismiss, inside, opts });
  latest.current = { onDismiss, inside, opts };

  useEffect(() => {
    if (!active) return;
    const within = (target: Node | null): boolean =>
      target !== null && latest.current.inside.some((r) => r.current?.contains(target));

    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (within(e.target as Node)) return;
      latest.current.onDismiss();
      if (e.type === 'touchstart') suppressNextClick();
    };
    const onScroll = (e: Event): void => {
      if (within(e.target as Node)) return;
      const { onScroll: follow, scroll = 'close' } = latest.current.opts;
      if (follow) follow(e);
      else if (scroll === 'close') latest.current.onDismiss();
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    // Capture: the thing that scrolls is usually a pane rather than the
    // window, and a scroll event does not bubble.
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [active]);
}
