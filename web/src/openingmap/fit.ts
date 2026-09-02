/**
 * The viewport the map opens on, as arithmetic the canvas can be tested
 * without.
 *
 * Two facts about the labels live here rather than in the canvas, because
 * the fit has to know them: the zoom at which the names have faded out
 * entirely, and the zoom at which they are fully drawn. The canvas ramps
 * label opacity between the two; the automatic fit refuses to land below
 * the second. Kept as one pair so the fit cannot drift to a zoom where
 * the labels it fitted for are not there to read.
 */

export interface Box {
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FitView {
  x: number;
  y: number;
  k: number;
}

/** Pulled back past this, the labels are gone and only the shape reads. */
export const LABELS_FADE_OUT = 0.3;
/** From here in the labels are fully drawn: 12px names, 10px captions. */
export const LABELS_LEGIBLE = 0.54;
/** A small map is not blown up past this, even if it would fit. */
const FIT_MAX = 2;
/** The margin a fit keeps around the picture. */
const FIT_FILL = 0.92;

/** How much of a label to draw at zoom `k`: 0 far out, 1 from LABELS_LEGIBLE in. */
export function labelOpacity(k: number): number {
  return Math.max(0, Math.min(1, (k - LABELS_FADE_OUT) / (LABELS_LEGIBLE - LABELS_FADE_OUT)));
}

/**
 * Fit `bounds` into `box`.
 *
 * Plain, the whole picture is centred at the largest zoom that shows all
 * of it (capped, so three dots do not become three plates). With
 * `legible`, the zoom is floored at LABELS_LEGIBLE as well: a map that
 * only fits further out is shown bigger than the box instead, opened on
 * `anchor` (the root, for a map) and clamped on each axis it overflows so
 * that axis shows map rather than margin. The reader pans or pinches for
 * the rest.
 *
 * The plain fit is what Align does, since a reader pressing it is asking
 * for all of it; the legible fit is what the map arrives on. The whole
 * picture at a zoom where nothing is labelled is a constellation, and a
 * repertoire's first screen should say "1. e4".
 */
export function fitView(
  box: Box,
  bounds: Bounds,
  { legible = false, anchor }: { legible?: boolean; anchor?: { x: number; y: number } } = {},
): FitView {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const fit = FIT_FILL * Math.min(box.width / w, box.height / h);
  const k = Math.min(FIT_MAX, legible ? Math.max(LABELS_LEGIBLE, fit) : fit);
  let x = box.width / 2 - ((bounds.minX + bounds.maxX) / 2) * k;
  let y = box.height / 2 - ((bounds.minY + bounds.maxY) / 2) * k;
  if (k > fit) {
    if (anchor) {
      x = box.width / 2 - anchor.x * k;
      y = box.height / 2 - anchor.y * k;
    }
    // The picture's left edge no further right than the box's, its right
    // edge no further left — where it is wide enough for both to hold.
    if (w * k > box.width) x = Math.min(-bounds.minX * k, Math.max(box.width - bounds.maxX * k, x));
    if (h * k > box.height) y = Math.min(-bounds.minY * k, Math.max(box.height - bounds.maxY * k, y));
  }
  return { x, y, k };
}
