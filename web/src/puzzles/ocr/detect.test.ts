import { describe, expect, it } from 'vitest';
import { detectBoardQuad, detectDiagrams, type Rect } from './detect';
import type { Gray, Point, Quad } from './image';

/** A white "page" with helpers to draw print-like content. */
function makePage(w: number, h: number): Gray {
  return { w, h, data: new Uint8ClampedArray(w * h).fill(252) };
}

/** A book-style diagram: outer border, grid, shaded dark squares, "pieces". */
function drawDiagram(page: Gray, rect: Rect): void {
  const cell = rect.w / 8;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const px = rect.x + x;
      const py = rect.y + y;
      const col = Math.min(7, Math.floor(x / cell));
      const row = Math.min(7, Math.floor(y / cell));
      const border = x < 2 || y < 2 || x >= rect.w - 2 || y >= rect.h - 2;
      // Dark squares shaded with a light hatch, like most print diagrams.
      const hatch = (col + row) % 2 === 1 && (x + y) % 4 === 0;
      // A blobby "piece" on a few squares.
      const cx = (x % cell) / cell - 0.5;
      const cy = (y % cell) / cell - 0.5;
      const piece = (col * 3 + row) % 5 === 0 && cx * cx + cy * cy < 0.08;
      if (border || hatch || piece) page.data[py * page.w + px] = 30;
    }
  }
}

/** Lines of fake body text: short dark dashes. */
function drawText(page: Gray, x: number, y: number, w: number, lines: number): void {
  for (let line = 0; line < lines; line++) {
    const ly = y + line * 14;
    for (let lx = x; lx < x + w; lx++) {
      if (lx % 23 > 3 && ly < page.h) {
        page.data[ly * page.w + lx] = 40;
        page.data[(ly + 1) * page.w + lx] = 40;
      }
    }
  }
}

const overlap = (a: Rect, b: Rect): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const union = a.w * a.h + b.w * b.h - ix * iy;
  return (ix * iy) / union;
};

describe('diagram detection on rendered pages', () => {
  it('finds two diagrams on a text page, ignoring the prose', () => {
    const page = makePage(1000, 1400);
    const top: Rect = { x: 120, y: 100, w: 360, h: 360 };
    const bottom: Rect = { x: 520, y: 800, w: 320, h: 320 };
    drawDiagram(page, top);
    drawDiagram(page, bottom);
    drawText(page, 100, 520, 800, 12);
    drawText(page, 100, 1200, 800, 8);

    const found = detectDiagrams(page);
    expect(found).toHaveLength(2);
    expect(overlap(found[0]!, top)).toBeGreaterThan(0.9);
    expect(overlap(found[1]!, bottom)).toBeGreaterThan(0.9);
  });

  it('finds nothing on a pure text page', () => {
    const page = makePage(1000, 1400);
    drawText(page, 100, 100, 800, 60);
    expect(detectDiagrams(page)).toHaveLength(0);
  });

  it('rejects tall text blocks and accepts a lone diagram', () => {
    const page = makePage(900, 1300);
    const rect: Rect = { x: 250, y: 350, w: 400, h: 400 };
    drawDiagram(page, rect);
    drawText(page, 80, 80, 700, 15);
    const found = detectDiagrams(page);
    expect(found).toHaveLength(1);
    expect(overlap(found[0]!, rect)).toBeGreaterThan(0.9);
  });
});

/**
 * A diagram rotated `deg` about its centre — border, hatch and pieces like
 * drawDiagram, drawn by inverse-rotating each candidate pixel. Returns the
 * true corner quad (TL, TR, BR, BL in the rotated frame).
 */
function drawRotatedDiagram(page: Gray, cx: number, cy: number, half: number, deg: number): Quad {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const reach = Math.ceil(half * (Math.abs(cos) + Math.abs(sin))) + 2;
  const cell = (half * 2) / 8;
  for (let y = cy - reach; y <= cy + reach; y++) {
    for (let x = cx - reach; x <= cx + reach; x++) {
      if (x < 0 || y < 0 || x >= page.w || y >= page.h) continue;
      const u = (x - cx) * cos + (y - cy) * sin;
      const v = -(x - cx) * sin + (y - cy) * cos;
      if (Math.abs(u) > half || Math.abs(v) > half) continue;
      const lx = u + half;
      const ly = v + half;
      const col = Math.min(7, Math.floor(lx / cell));
      const row = Math.min(7, Math.floor(ly / cell));
      const border = lx < 3 || ly < 3 || lx > 2 * half - 3 || ly > 2 * half - 3;
      const hatch = (col + row) % 2 === 1 && (Math.round(lx) + Math.round(ly)) % 4 === 0;
      const dx = (lx % cell) / cell - 0.5;
      const dy = (ly % cell) / cell - 0.5;
      const piece = (col * 3 + row) % 5 === 0 && dx * dx + dy * dy < 0.08;
      if (border || hatch || piece) page.data[y * page.w + x] = 30;
    }
  }
  const toPage = (u: number, v: number): Point => ({
    x: cx + u * cos - v * sin,
    y: cy + u * sin + v * cos,
  });
  return [toPage(-half, -half), toPage(half, -half), toPage(half, half), toPage(-half, half)];
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('board-corner detection on photos', () => {
  it('lands the handles on an upright diagram', () => {
    const page = makePage(1000, 1400);
    const rect: Rect = { x: 300, y: 400, w: 400, h: 400 };
    drawDiagram(page, rect);
    drawText(page, 100, 900, 800, 10);
    const quad = detectBoardQuad(page);
    expect(quad).not.toBeNull();
    const truth: Quad = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
    ];
    // Coarse-scale quantisation bounds the error to a few source pixels.
    const tolerance = Math.floor(1000 / 250) * 2 + 3;
    truth.forEach((p, i) => expect(distance(quad![i]!, p)).toBeLessThan(tolerance));
  });

  it('follows a tilted board onto its true corners', () => {
    const page = makePage(1200, 1200);
    const truth = drawRotatedDiagram(page, 600, 600, 260, 8);
    const quad = detectBoardQuad(page);
    expect(quad).not.toBeNull();
    const tolerance = Math.floor(1200 / 250) * 2 + 3;
    truth.forEach((p, i) => expect(distance(quad![i]!, p)).toBeLessThan(tolerance));
  });

  it('copes with a lighting gradient across the photo', () => {
    const page = makePage(1000, 1000);
    const rect: Rect = { x: 250, y: 250, w: 480, h: 480 };
    drawDiagram(page, rect);
    // Right side falls to 55% brightness, paper and ink alike.
    for (let y = 0; y < page.h; y++) {
      for (let x = 0; x < page.w; x++) {
        const factor = 1 - 0.45 * (x / page.w);
        page.data[y * page.w + x] = page.data[y * page.w + x]! * factor;
      }
    }
    const quad = detectBoardQuad(page);
    expect(quad).not.toBeNull();
    const tolerance = Math.floor(1000 / 250) * 2 + 3;
    expect(distance(quad![0]!, { x: rect.x, y: rect.y })).toBeLessThan(tolerance);
    expect(distance(quad![2]!, { x: rect.x + rect.w, y: rect.y + rect.h })).toBeLessThan(tolerance);
  });

  it('accepts a tight crop where the board fills the frame', () => {
    const page = makePage(420, 420);
    const rect: Rect = { x: 6, y: 6, w: 408, h: 408 };
    drawDiagram(page, rect);
    const quad = detectBoardQuad(page);
    expect(quad).not.toBeNull();
    expect(distance(quad![0]!, { x: rect.x, y: rect.y })).toBeLessThan(8);
    expect(distance(quad![2]!, { x: rect.x + rect.w, y: rect.y + rect.h })).toBeLessThan(8);
  });

  it('finds a borderless screenshot board (no grid, alternating squares only)', () => {
    // Chessground/chess.com style: no border, no grid lines — dark squares
    // touch each other only diagonally, and the corner squares are light.
    const page = makePage(500, 500);
    const rect: Rect = { x: 50, y: 50, w: 400, h: 400 };
    const cell = rect.w / 8;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const col = Math.min(7, Math.floor(x / cell));
        const row = Math.min(7, Math.floor(y / cell));
        page.data[(rect.y + y) * page.w + rect.x + x] = (col + row) % 2 === 1 ? 120 : 235;
      }
    }
    const quad = detectBoardQuad(page);
    expect(quad).not.toBeNull();
    const tolerance = Math.floor(500 / 250) * 2 + 3;
    expect(distance(quad![0]!, { x: rect.x, y: rect.y })).toBeLessThan(tolerance);
    expect(distance(quad![1]!, { x: rect.x + rect.w, y: rect.y })).toBeLessThan(tolerance);
    expect(distance(quad![2]!, { x: rect.x + rect.w, y: rect.y + rect.h })).toBeLessThan(tolerance);
    expect(distance(quad![3]!, { x: rect.x, y: rect.y + rect.h })).toBeLessThan(tolerance);
  });

  it('returns null on a text-only photo', () => {
    const page = makePage(1000, 1400);
    drawText(page, 100, 100, 800, 60);
    expect(detectBoardQuad(page)).toBeNull();
  });
});
