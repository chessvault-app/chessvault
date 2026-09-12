/**
 * The viewport the map opens on, as arithmetic the canvas can be tested
 * without.
 *
 * Two facts about the labels live here rather than in the canvas, because
 * the fit has to know them: the zoom below which no name is drawn at all,
 * and the zoom the legible fit floors itself at. The canvas draws a label
 * at full ink or not at all (labels.ts decides which, by collision); it
 * used to ramp the opacity between these two zooms, on the premise that
 * the arriving fit never landed inside the ramp. The arriving fit has
 * been the plain, whole-map one since 2026-09-03 (see MapCanvas), so a
 * mid-size map on a desktop rested INSIDE the ramp: every label at 57%
 * ink, captions at 2.4:1, and nobody had revisited it. A label is either
 * readable or absent now; the zoom-out transition is the culling, not a
 * fade.
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
export const LABELS_SHOWN = 0.3;
/** The zoom a legible fit floors at: room for most of a map's names. */
export const LABELS_LEGIBLE = 0.54;
/** A small map is not blown up past this, even if it would fit. */
const FIT_MAX = 2;
/** The margin a fit keeps around the picture. */
const FIT_FILL = 0.92;

/** Whether any label is drawn at zoom `k`. Which ones is labels.ts's call. */
export function labelsShown(k: number): boolean {
  return k >= LABELS_SHOWN;
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
