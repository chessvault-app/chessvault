/**
 * Pixel plumbing for book-diagram OCR. Everything here is pure math over
 * grayscale arrays so it unit-tests without a canvas; the UI layer only
 * decodes the photo and hands over an ImageData.
 */

export interface Gray {
  w: number;
  h: number;
  /** Row-major luminance, 0 (black) .. 255 (white). */
  data: Uint8ClampedArray;
}

export interface Point {
  x: number;
  y: number;
}

/** Corners of the board in the photo: TL, TR, BR, BL. */
export type Quad = [Point, Point, Point, Point];

/** Warped board edge length; divides evenly into 64 cells of 64 px. */
export const BOARD_PX = 512;
/** Cell features are mean-pooled to FEATURE_PX² bytes. */
export const FEATURE_PX = 16;

export function grayscaleFrom(image: ImageData): Gray {
  const { width: w, height: h, data } = image;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    // Rec. 601 luma — book pages are near-monochrome anyway.
    out[i] = 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
  }
  return { w, h, data: out };
}

/**
 * Projective map from the unit square to `quad` (the classic 4-point
 * homography in closed form). Returns (u,v) in [0,1]² → photo coords.
 */
function homography(quad: Quad): (u: number, v: number) => Point {
  const [p0, p1, p2, p3] = quad; // (0,0) (1,0) (1,1) (0,1)
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;

  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

/** Bilinear sample, clamped at the edges. */
function sample(src: Gray, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), src.w - 1.001);
  const cy = Math.min(Math.max(y, 0), src.h - 1.001);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const at = (xx: number, yy: number): number => src.data[yy * src.w + xx]!;
  return (
    at(x0, y0) * (1 - fx) * (1 - fy) +
    at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy +
    at(x0 + 1, y0 + 1) * fx * fy
  );
}

/** Rectify the quad the user aligned to the board into a square image. */
export function warpQuad(src: Gray, quad: Quad, size: number = BOARD_PX): Gray {
  const map = homography(quad);
  const out = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = map((x + 0.5) / size, (y + 0.5) / size);
      out[y * size + x] = sample(src, p.x, p.y);
    }
  }
  return { w: size, h: size, data: out };
}

/**
 * Mean-pool one board cell into a FEATURE_PX² byte vector. A 12.5% inset
 * crops away grid lines and neighbouring-cell bleed before pooling.
 */
export function cellFeature(board: Gray, col: number, row: number): Uint8Array {
  const cell = board.w / 8;
  const inset = cell * 0.125;
  const x0 = col * cell + inset;
  const y0 = row * cell + inset;
  const span = cell - 2 * inset;
  const step = span / FEATURE_PX;

  const out = new Uint8Array(FEATURE_PX * FEATURE_PX);
  for (let fy = 0; fy < FEATURE_PX; fy++) {
    for (let fx = 0; fx < FEATURE_PX; fx++) {
      // Average a small grid of samples inside this pooled pixel.
      let sum = 0;
      const n = 3;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          sum += sample(
            board,
            x0 + (fx + (sx + 0.5) / n) * step,
            y0 + (fy + (sy + 0.5) / n) * step,
          );
        }
      }
      out[fy * FEATURE_PX + fx] = sum / (n * n);
    }
  }
  return out;
}

/** All 64 cell features, row-major from the top-left corner of the image. */
export function boardFeatures(board: Gray): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) out.push(cellFeature(board, col, row));
  }
  return out;
}

/**
 * Below this ink-to-paper span a board is treated as a faint scan and
 * stretched to the full range.
 *
 * The two books measured sit far apart and nothing lands between them: a
 * clean scan's boards span 202..252 (median 245 over 240 crops), a faint
 * one's span 149..162 over 30. Anywhere in 162..202 separates them, so the
 * threshold is the middle of that gap rather than the edge of either
 * book's range — the next faint scan will not be exactly this faint.
 */
const FAINT_SPAN = 190;

/**
 * A board's shades pulled out to the full range, when it needs it.
 *
 * CellNet takes raw luminance — cellTile divides by 255 and normalises
 * nothing — so how dark the ink is changes what it reads, not just how
 * clearly. On a scan whose dark squares sit at ~160 against ~225 paper
 * every cell falls in its "empty" basin at 0.94 confidence, and a whole
 * 448-page book read as 1054 empty boards. Stretched, the same crops read
 * 26 pieces a board.
 *
 * Percentiles, not min and max, so one speck of dither does not set the
 * range. 2/98 and 5/95 both worked on the faint book; 10/90 overshot and
 * turned it into rooks everywhere, so this is not a knob to widen.
 *
 * A board already spanning the range is returned UNTOUCHED, not merely
 * scaled by roughly one. That is what keeps this provably free of
 * regression on books that read correctly today: they never enter the
 * branch, so their pixels are the same pixels.
 */
export function normalizeContrast(board: Gray): Gray {
  const sorted = Uint8ClampedArray.from(board.data).sort();
  const low = sorted[Math.floor(sorted.length * 0.02)]!;
  const high = sorted[Math.floor(sorted.length * 0.98)]!;
  // A board of one flat shade has nothing to stretch and would divide
  // by zero; blank paper is left as blank paper.
  if (high - low >= FAINT_SPAN || high === low) return board;
  const data = new Uint8ClampedArray(board.data.length);
  for (let i = 0; i < data.length; i++) data[i] = ((board.data[i]! - low) / (high - low)) * 255;
  return { w: board.w, h: board.h, data };
}
