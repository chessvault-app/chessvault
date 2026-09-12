/**
 * Which of the map's labels to draw, as arithmetic the canvas can be
 * tested without.
 *
 * A label is drawn at full ink or not at all. The map used to fade every
 * label together as the view pulled back, and a mid-size map on a desktop
 * arrived INSIDE that fade: 60 labels at 57% ink, captions at 2.4:1,
 * four of them printed over each other. Half-drawn text is neither the
 * shape nor the names. So the names that fit are drawn whole, and the
 * ones that would collide are dropped, heaviest first:
 *
 * - the move labels are placed first, in weight order, each one kept if
 *   it overlaps nothing placed before it;
 * - then the captions, in the same order, against everything placed so
 *   far, so a caption is always the first thing to go and a move label
 *   never loses its place to a caption.
 *
 * `keep` labels are placed unconditionally and ahead of the rest: the
 * selection and the search hits are the labels the reader asked for,
 * and a hit that hid its name because a neighbour got there first would
 * be a search that lost its answer.
 *
 * Widths are estimated, not measured: measuring 400 SVG texts per render
 * is a forced layout each, and the estimate only has to be generous
 * enough that "does not overlap" stays true on screen. Estimated boxes
 * carry a margin for that.
 */

export interface LabelCandidate {
  id: string;
  /** The dot's centre on screen, in CSS px. */
  x: number;
  y: number;
  /** The dot's drawn radius on screen, in CSS px. */
  r: number;
  /** The move label, already clipped to what the canvas will draw. */
  move: string;
  /** The caption under it, already clipped; empty for none. */
  caption: string;
  /** Higher is placed earlier. */
  weight: number;
  /** Placed whatever it overlaps: the selection, a search hit. */
  keep?: boolean;
}

export interface Placed {
  move: boolean;
  caption: boolean;
}

/** The label rung and the micro rung, in screen px (DESIGN.md typography). */
export const MOVE_PX = 12;
export const CAPTION_PX = 10;
/** Baselines below the dot's edge, in screen px, as MapCanvas draws them. */
export const MOVE_BASELINE = 12;
export const CAPTION_BASELINE = 24;
/** How much clear air two boxes keep between them, in screen px. */
const GAP = 2;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The width of `text` at `px`, estimated per character class. The
 * factors are generous for a sans face: a capital or a figure at 0.68em,
 * a lowercase letter at 0.56em, a Hangul or CJK glyph at a full em, so
 * the box errs wide rather than narrow.
 */
export function textWidth(text: string, px: number, bold = false): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      em += 1;
    } else if (ch === ' ') {
      em += 0.28;
    } else if (/[.,:;'’|!il1\-…]/.test(ch)) {
      em += 0.34;
    } else if (/[A-Z0-9]/.test(ch)) {
      em += 0.68;
    } else if (/[a-z]/.test(ch)) {
      em += 0.56;
    } else {
      em += 0.62;
    }
  }
  return em * px * (bold ? 1.06 : 1);
}

/** An SVG text's box: the baseline at `y`, centred at `x`. */
function textBox(x: number, baseline: number, width: number, px: number): Box {
  return {
    left: x - width / 2 - GAP,
    right: x + width / 2 + GAP,
    top: baseline - px * 0.9 - GAP,
    bottom: baseline + px * 0.25 + GAP,
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Decide which of `cands`' labels are drawn. */
export function placeLabels(cands: readonly LabelCandidate[]): Map<string, Placed> {
  const order = [...cands].sort((a, b) => {
    if (!!a.keep !== !!b.keep) return a.keep ? -1 : 1;
    return b.weight - a.weight;
  });
  const placed: Box[] = [];
  const out = new Map<string, Placed>();
  /** Which placed box is each dot's own move label: a caption sits right
      under its own move label by design, and must not count that as a
      collision. */
  const own = new Map<string, Box>();
  const tryPlace = (box: Box, keep: boolean, self?: Box): boolean => {
    if (!keep && placed.some((p) => p !== self && overlaps(p, box))) return false;
    placed.push(box);
    return true;
  };
  for (const c of order) {
    const box = textBox(c.x, c.y + c.r + MOVE_BASELINE, textWidth(c.move, MOVE_PX, true), MOVE_PX);
    const move = tryPlace(box, !!c.keep);
    if (move) own.set(c.id, box);
    out.set(c.id, { move, caption: false });
  }
  for (const c of order) {
    const got = out.get(c.id)!;
    if (!got.move || !c.caption) continue;
    const box = textBox(c.x, c.y + c.r + CAPTION_BASELINE, textWidth(c.caption, CAPTION_PX), CAPTION_PX);
    got.caption = tryPlace(box, !!c.keep, own.get(c.id));
  }
  return out;
}
