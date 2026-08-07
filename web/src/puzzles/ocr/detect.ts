import type { Gray } from './image';

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

  // Connected components over the coarse ink mask (4-connected, iterative).
  const labels = new Int32Array(w * h).fill(-1);
  const rects: Rect[] = [];
  const stack: number[] = [];
  let nextLabel = 0;
  for (let start = 0; start < w * h; start++) {
    if (!dark[start] || labels[start] !== -1) continue;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    stack.push(start);
    labels[start] = nextLabel;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const ax = at % w;
      const ay = Math.floor(at / w);
      if (ax < minX) minX = ax;
      if (ax > maxX) maxX = ax;
      if (ay < minY) minY = ay;
      if (ay > maxY) maxY = ay;
      const neighbours = [at - 1, at + 1, at - w, at + w];
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

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const minEdge = Math.min(page.w, page.h) * minFrac;
    const aspect = bw / bh;
    if (bw * scale < minEdge || bh * scale < minEdge) continue;
    if (aspect < 0.82 || aspect > 1.22) continue;
    if (bw >= w * 0.98 && bh >= h * 0.98) continue; // whole-page blob
    rects.push({ x: minX * scale, y: minY * scale, w: bw * scale, h: bh * scale });
  }

  rects.sort((a, b) => b.w * b.h - a.w * a.h);
  return rects.map((r) => refine(page, r, threshold));
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
