import type { Gray, Point, Quad } from './image';

/**
 * Find chess diagrams on a rendered book page. Print pages are ideal
 * input — axis-aligned, crisp, dark ink on a light background — so plain
 * connected-component analysis is enough: a diagram's border, grid,
 * shading and pieces form one big square-ish blob of ink.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ink threshold: comfortably darker than paper, tolerant of gray shading. */
function inkThreshold(page: Gray): number {
  // Paper dominates the page, so a high percentile approximates its shade.
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(page.data.length / 5000));
  for (let i = 0; i < page.data.length; i += step) sample.push(page.data[i]!);
  sample.sort((a, b) => a - b);
  const paper = sample[Math.floor(sample.length * 0.9)]!;
  return paper * 0.72;
}

/**
 * Diagram candidates as page-space rectangles, largest first. `minFrac`
 * is the minimum edge length as a fraction of the page's short side.
 */
export function detectDiagrams(page: Gray, minFrac = 0.18): Rect[] {
  const threshold = inkThreshold(page);

  // Work at a coarse scale: fast, and it fuses grid lines, shading and
  // pieces into one component even when they do not quite touch.
  const scale = Math.max(1, Math.floor(Math.min(page.w, page.h) / 250));
  const w = Math.floor(page.w / scale);
  const h = Math.floor(page.h / scale);
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // A coarse pixel is dark when ANY sampled source pixel is inked.
      let inked = 0;
      for (let sy = 0; sy < scale && !inked; sy += 2) {
        for (let sx = 0; sx < scale && !inked; sx += 2) {
          if (page.data[(y * scale + sy) * page.w + (x * scale + sx)]! < threshold) inked = 1;
        }
      }
      dark[y * w + x] = inked;
    }
  }

  const rects: Rect[] = [];
  for (const c of components(dark, w, h)) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const minEdge = Math.min(page.w, page.h) * minFrac;
    const aspect = bw / bh;
    if (bw * scale < minEdge || bh * scale < minEdge) continue;
    if (aspect < 0.82 || aspect > 1.22) continue;
    if (bw >= w * 0.98 && bh >= h * 0.98) continue; // whole-page blob
    rects.push({ x: c.minX * scale, y: c.minY * scale, w: bw * scale, h: bh * scale });
  }

  rects.sort((a, b) => b.w * b.h - a.w * a.h);
  return rects.map((r) => refine(page, r, threshold));
}

interface Component {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /**
   * Corner-most pixels: extremes of x+y and x−y. Unlike the bounding box
   * these stay on the shape's actual corners when it is tilted, which is
   * what a photographed board always is.
   */
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

/**
 * Connected components over a coarse ink mask (iterative flood fill).
 * Print pages use 4-connectivity; photos/screenshots use 8, because a
 * borderless board's dark squares touch only at their corners.
 */
function components(dark: Uint8Array, w: number, h: number, eightConnected = false): Component[] {
  const labels = new Int32Array(w * h).fill(-1);
  const out: Component[] = [];
  const stack: number[] = [];
  let nextLabel = 0;
  for (let start = 0; start < w * h; start++) {
    if (!dark[start] || labels[start] !== -1) continue;
    const c: Component = {
      minX: w,
      maxX: 0,
      minY: h,
      maxY: 0,
      tl: { x: 0, y: 0 },
      tr: { x: 0, y: 0 },
      br: { x: 0, y: 0 },
      bl: { x: 0, y: 0 },
    };
    let minSum = Infinity;
    let maxSum = -Infinity;
    let minDiff = Infinity;
    let maxDiff = -Infinity;
    stack.push(start);
    labels[start] = nextLabel;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const ax = at % w;
      const ay = Math.floor(at / w);
      if (ax < c.minX) c.minX = ax;
      if (ax > c.maxX) c.maxX = ax;
      if (ay < c.minY) c.minY = ay;
      if (ay > c.maxY) c.maxY = ay;
      const sum = ax + ay;
      const diff = ax - ay;
      if (sum < minSum) {
        minSum = sum;
        c.tl = { x: ax, y: ay };
      }
      if (sum > maxSum) {
        maxSum = sum;
        c.br = { x: ax, y: ay };
      }
      if (diff > maxDiff) {
        maxDiff = diff;
        c.tr = { x: ax, y: ay };
      }
      if (diff < minDiff) {
        minDiff = diff;
        c.bl = { x: ax, y: ay };
      }
      const neighbours = eightConnected
        ? [at - 1, at + 1, at - w, at + w, at - w - 1, at - w + 1, at + w - 1, at + w + 1]
        : [at - 1, at + 1, at - w, at + w];
      for (const n of neighbours) {
        if (n < 0 || n >= w * h) continue;
        if (Math.abs((n % w) - ax) > 1) continue; // no row wrap
        if (dark[n] && labels[n] === -1) {
          labels[n] = nextLabel;
          stack.push(n);
        }
      }
    }
    nextLabel++;
    out.push(c);
  }
  return out;
}

/**
 * Tighten a coarse box to the diagram's exact ink extents at full
 * resolution, so the crop's corners are the board's corners.
 */
function refine(page: Gray, rect: Rect, threshold: number): Rect {
  const margin = Math.round(Math.min(rect.w, rect.h) * 0.05);
  const x0 = Math.max(0, rect.x - margin);
  const y0 = Math.max(0, rect.y - margin);
  const x1 = Math.min(page.w - 1, rect.x + rect.w + margin);
  const y1 = Math.min(page.h - 1, rect.y + rect.h + margin);

  const colInk = new Int32Array(x1 - x0 + 1);
  const rowInk = new Int32Array(y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (page.data[y * page.w + x]! < threshold) {
        colInk[x - x0] = colInk[x - x0]! + 1;
        rowInk[y - y0] = rowInk[y - y0]! + 1;
      }
    }
  }
  // The border/grid lines make edge rows/cols heavily inked; a few stray
  // pixels (previews, hyphens) must not count as an edge.
  const colBar = Math.max(3, (y1 - y0) * 0.05);
  const rowBar = Math.max(3, (x1 - x0) * 0.05);
  let left = 0;
  while (left < colInk.length - 1 && colInk[left]! < colBar) left++;
  let right = colInk.length - 1;
  while (right > 0 && colInk[right]! < colBar) right--;
  let top = 0;
  while (top < rowInk.length - 1 && rowInk[top]! < rowBar) top++;
  let bottom = rowInk.length - 1;
  while (bottom > 0 && rowInk[bottom]! < rowBar) bottom--;

  return { x: x0 + left, y: y0 + top, w: right - left + 1, h: bottom - top + 1 };
}

// --- board-corner detection for photos ---------------------------------------

const TILE_GRID = 4;

/**
 * Per-tile ink thresholds. A photographed page is unevenly lit, so one
 * global paper estimate misreads the darker half; every tile of a board
 * still contains light squares, so a tile's high percentile tracks the
 * LOCAL paper shade.
 */
function tiledThresholds(photo: Gray): (x: number, y: number) => number {
  const grid = new Float64Array(TILE_GRID * TILE_GRID);
  const tileW = Math.ceil(photo.w / TILE_GRID);
  const tileH = Math.ceil(photo.h / TILE_GRID);
  for (let ty = 0; ty < TILE_GRID; ty++) {
    for (let tx = 0; tx < TILE_GRID; tx++) {
      const x1 = Math.min(photo.w, (tx + 1) * tileW);
      const y1 = Math.min(photo.h, (ty + 1) * tileH);
      const sample: number[] = [];
      const stepX = Math.max(1, Math.floor(tileW / 40));
      const stepY = Math.max(1, Math.floor(tileH / 40));
      for (let y = ty * tileH; y < y1; y += stepY) {
        for (let x = tx * tileW; x < x1; x += stepX) {
          sample.push(photo.data[y * photo.w + x]!);
        }
      }
      sample.sort((a, b) => a - b);
      grid[ty * TILE_GRID + tx] = sample[Math.floor(sample.length * 0.9)]! * 0.72;
    }
  }
  return (x, y) =>
    grid[
      Math.min(TILE_GRID - 1, Math.floor(y / tileH)) * TILE_GRID +
        Math.min(TILE_GRID - 1, Math.floor(x / tileW))
    ]!;
}

/**
 * Guess the board's four corners in a photo, to pre-place the alignment
 * handles. Same blob idea as detectDiagrams, adapted to camera reality:
 * tiled thresholds for uneven lighting, and corner-extreme pixels rather
 * than a bounding box so a tilted board's corners land right. Returns
 * null when nothing board-like is found; the caller keeps its default.
 */
export function detectBoardQuad(photo: Gray): Quad | null {
  const thresholdAt = tiledThresholds(photo);

  const scale = Math.max(1, Math.floor(Math.min(photo.w, photo.h) / 250));
  const w = Math.floor(photo.w / scale);
  const h = Math.floor(photo.h / scale);
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inked = 0;
      for (let sy = 0; sy < scale && !inked; sy += 2) {
        for (let sx = 0; sx < scale && !inked; sx += 2) {
          const px = x * scale + sx;
          const py = y * scale + sy;
          if (photo.data[py * photo.w + px]! < thresholdAt(px, py)) inked = 1;
        }
      }
      dark[y * w + x] = inked;
    }
  }

  // The board: big and square-ish (perspective loosens the bounds vs the
  // print detector). A whole-frame blob is FINE here — a tightly cropped
  // screenshot IS the board.
  const minEdge = Math.min(w, h) * 0.25;
  const best = components(dark, w, h, true)
    .filter((c) => {
      const bw = c.maxX - c.minX + 1;
      const bh = c.maxY - c.minY + 1;
      const aspect = bw / bh;
      return bw >= minEdge && bh >= minEdge && aspect > 0.6 && aspect < 1.65;
    })
    .sort(
      (a, b) =>
        (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1) -
        (a.maxX - a.minX + 1) * (a.maxY - a.minY + 1),
    )[0];
  if (!best) return null;

  // Upright or tilted? An upright board's bounding-box edges are heavily
  // inked along their whole length (border line, or the alternating dark
  // squares of a borderless screenshot); a tilted board only touches its
  // bbox near one vertex per edge. Upright boards take the bbox corners —
  // exact even when the corner square is light, where a corner-extreme
  // would drift a full cell inward.
  const edgeInk = (fixed: number, from: number, to: number, vertical: boolean): number => {
    let inked = 0;
    for (let at = from; at <= to; at++) {
      if (dark[vertical ? at * w + fixed : fixed * w + at]) inked++;
    }
    return inked / (to - from + 1);
  };
  const upright =
    Math.min(
      edgeInk(best.minY, best.minX, best.maxX, false),
      edgeInk(best.maxY, best.minX, best.maxX, false),
      edgeInk(best.minX, best.minY, best.maxY, true),
      edgeInk(best.maxX, best.minY, best.maxY, true),
    ) >= 0.35;
  if (upright) {
    return [
      { x: best.minX * scale, y: best.minY * scale },
      { x: (best.maxX + 1) * scale, y: best.minY * scale },
      { x: (best.maxX + 1) * scale, y: (best.maxY + 1) * scale },
      { x: best.minX * scale, y: (best.maxY + 1) * scale },
    ];
  }

  // Sharpen each coarse corner against full-res ink. Score = the same
  // extreme each corner minimises, so refinement can only push outward
  // toward the true corner, never inward onto a piece.
  const corner = (coarse: Point, score: (x: number, y: number) => number): Point => {
    let bestPoint: Point = { x: (coarse.x + 0.5) * scale, y: (coarse.y + 0.5) * scale };
    let bestScore = Infinity;
    const x0 = Math.max(0, coarse.x * scale - scale);
    const y0 = Math.max(0, coarse.y * scale - scale);
    const x1 = Math.min(photo.w - 1, (coarse.x + 2) * scale);
    const y1 = Math.min(photo.h - 1, (coarse.y + 2) * scale);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (photo.data[y * photo.w + x]! < thresholdAt(x, y) && score(x, y) < bestScore) {
          bestScore = score(x, y);
          bestPoint = { x, y };
        }
      }
    }
    return bestPoint;
  };
  const quad: Quad = [
    corner(best.tl, (x, y) => x + y),
    corner(best.tr, (x, y) => y - x),
    corner(best.br, (x, y) => -x - y),
    corner(best.bl, (x, y) => x - y),
  ];

  // Sanity: a board reads as a rough square from any sane camera angle.
  // L-shaped or straggly blobs produce wildly unequal sides — bail out.
  const side = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
  const sides = [
    side(quad[0], quad[1]),
    side(quad[1], quad[2]),
    side(quad[2], quad[3]),
    side(quad[3], quad[0]),
  ];
  if (Math.min(...sides) < Math.max(...sides) * 0.45) return null;
  return quad;
}
