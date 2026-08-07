import { describe, expect, it } from 'vitest';
import { detectDiagrams, type Rect } from './detect';
import type { Gray } from './image';

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
