import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import { runBox, searchPage } from './pdfSearch';

/** A scale-1, unrotated viewport: y up in the page, y down on screen. */
const upright = (height: number) => ({ convertToViewportPoint: (x: number, y: number) => [x, height - y] });

describe('a text run box', () => {
  it('takes the reported advance as is, not scaled by the font size again', () => {
    // The demo book's first "bishop" run: 10.5pt, at (48.9, 525) on a
    // 396x612 page, 101 units wide. The width is already in page units.
    const [x1, y1, x2, y2] = runBox([10.5, 0, 0, 10.5, 48.949, 525], 100.996, 10.5, upright(612));
    expect(x1).toBeCloseTo(48.949, 3);
    expect(x2).toBeCloseTo(48.949 + 100.996, 3);
    expect(y2).toBeCloseTo(612 - 525, 3);
    expect(y1).toBeCloseTo(612 - 525 - 10.5, 3);
  });

  it('follows a rotated run along its own baseline', () => {
    // Text running up the page: the matrix's columns point up and left.
    const [x1, y1, x2, y2] = runBox([0, 12, -12, 0, 100, 200], 50, 12, upright(612));
    expect([x1, x2]).toEqual([88, 100]);
    expect([y1, y2]).toEqual([612 - 250, 612 - 200]);
  });
});

describe('searching the demo book', () => {
  it('puts the first "bishop" box on the word, inside the page', async () => {
    const file = fileURLToPath(new URL('../../demo-assets/books/sample.pdf', import.meta.url));
    const doc = await getDocument({ data: new Uint8Array(await readFile(file)) }).promise;
    try {
      const hits = await searchPage(doc, 2, 'bishop');
      expect(hits.length).toBeGreaterThan(0);
      // "1. The Spanish bishop": the word measured on the rendered text
      // layer sits at x 0.28, w 0.066, y 0.126 of the page. The box is cut
      // from the run by character proportion, which is what puts it a
      // glyph or so off; before the fix it began two page widths to the
      // right (x 2.04, w 0.77).
      const r = hits[0]!.rects[0]!;
      expect(r.x).toBeGreaterThan(0.27);
      expect(r.x).toBeLessThan(0.33);
      expect(r.w).toBeGreaterThan(0.05);
      expect(r.w).toBeLessThan(0.09);
      expect(r.y).toBeGreaterThan(0.11);
      expect(r.y).toBeLessThan(0.14);
      expect(r.h).toBeLessThan(0.03);
      for (const hit of hits) {
        for (const b of hit.rects) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(1);
          expect(b.y + b.h).toBeLessThanOrEqual(1);
        }
      }
    } finally {
      await doc.cleanup();
    }
  });
});
