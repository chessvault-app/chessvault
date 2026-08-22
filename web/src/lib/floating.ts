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
