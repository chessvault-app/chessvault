import { describe, expect, it } from 'vitest';
import { BOARD_PX, boardFeatures, normalizeContrast, warpQuad, type Gray, type Quad } from './image';
import {
  classifyBoard,
  fenToLabels,
  harvestTemplates,
  labelsToFen,
  type CellLabel,
  type Template,
} from './classify';

/**
 * Synthetic "book diagrams": each piece is drawn as a distinct pixel
 * glyph so the whole pipeline (warp → slice → features → templates →
 * classify → FEN) is exercised without a canvas or a real photo.
 */

const GLYPHS: Record<string, (u: number, v: number) => boolean> = {
  // Each returns true where ink goes, on unit-square cell coordinates.
  P: (u, v) => (u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.04, // small disc
  p: (u, v) => (u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.12, // large disc
  R: (u, v) => Math.abs(u - 0.5) < 0.08 && v > 0.2 && v < 0.8, // bar
  r: (u, v) => Math.abs(v - 0.5) < 0.08 && u > 0.2 && u < 0.8, // horizontal bar
  K: (u, v) => Math.abs(u - v) < 0.09 && u > 0.15 && u < 0.85, // diagonal
  k: (u, v) => Math.abs(u + v - 1) < 0.09 && u > 0.15 && u < 0.85, // anti-diagonal
  Q: (u, v) => Math.abs(u - 0.5) < 0.07 || Math.abs(v - 0.5) < 0.07, // cross
  q: (u, v) =>
    ((u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.14 && (u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.07), // ring
  N: (u, v) => v > 0.7 - 0.5 * u && v < 0.95 - 0.5 * u, // slanted band
  n: (u, v) => v > 0.2 + 0.5 * u && v < 0.45 + 0.5 * u,
  B: (u, v) => Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.22, // diamond
  b: (u, v) =>
    Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.32 && Math.abs(u - 0.5) + Math.abs(v - 0.5) > 0.18,
};

/** Render a diagram: light/dark checkering plus glyph ink. */
function renderDiagram(fen: string, size: number = BOARD_PX): Gray {
  const labels = fenToLabels(fen, false);
  const data = new Uint8ClampedArray(size * size);
  const cell = size / 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = Math.floor(x / cell);
      const row = Math.floor(y / cell);
      const shade = (col + row) % 2 === 0 ? 250 : 205; // light/dark squares
      const label = labels[row * 8 + col]!;
      const u = (x - col * cell) / cell;
      const v = (y - row * cell) / cell;
      const ink = label !== 'empty' && GLYPHS[label]!(u, v);
      data[y * size + x] = ink ? 20 : shade;
    }
  }
  return { w: size, h: size, data };
}

const CALIBRATION_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const TARGET_FEN = '6k1/5ppp/1q6/8/3N4/8/PP3PPP/3R2K1 w - - 0 1';

describe('diagram OCR pipeline', () => {
  it('round-trips labels ↔ FEN, both orientations', () => {
    const labels = fenToLabels(TARGET_FEN, false);
    expect(labelsToFen(labels, false).split(' ')[0]).toBe(TARGET_FEN.split(' ')[0]);
    const flipped = fenToLabels(TARGET_FEN, true);
    expect(labelsToFen(flipped, true).split(' ')[0]).toBe(TARGET_FEN.split(' ')[0]);
    expect(flipped[0]).toBe(labels[63]);
  });

  it('reads a new diagram after calibrating on one confirmed position', () => {
    const calibration = renderDiagram(CALIBRATION_FEN);
    const templates = harvestTemplates(
      boardFeatures(calibration),
      CALIBRATION_FEN,
      false,
      [],
    );

    const readings = classifyBoard(boardFeatures(renderDiagram(TARGET_FEN)), templates);
    const fen = labelsToFen(
      readings.map((r) => r.label),
      false,
    );
    expect(fen.split(' ')[0]).toBe(TARGET_FEN.split(' ')[0]);
    // Every cell should be confidently decided on clean synthetic input.
    expect(Math.min(...readings.map((r) => r.confidence))).toBeGreaterThan(0.3);
  });

  it('reads a skewed photo once the quad is aligned', () => {
    // Paste the diagram into a larger "page" with a perspective skew, then
    // warp it back out via the quad a user would drag onto the corners.
    const diagram = renderDiagram(CALIBRATION_FEN);
    const page: Gray = { w: 700, h: 700, data: new Uint8ClampedArray(700 * 700).fill(235) };
    const quad: Quad = [
      { x: 80, y: 60 },
      { x: 640, y: 90 },
      { x: 610, y: 630 },
      { x: 110, y: 600 },
    ];
    // Inverse-paste: for each page pixel inside the quad, sample the diagram.
    // Cheap approximation — warp the DIAGRAM into the page via the forward
    // map on a fine grid.
    for (let v = 0; v < 1400; v++) {
      for (let u = 0; u < 1400; u++) {
        const uu = u / 1400;
        const vv = v / 1400;
        const top = {
          x: quad[0].x + (quad[1].x - quad[0].x) * uu,
          y: quad[0].y + (quad[1].y - quad[0].y) * uu,
        };
        const bottom = {
          x: quad[3].x + (quad[2].x - quad[3].x) * uu,
          y: quad[3].y + (quad[2].y - quad[3].y) * uu,
        };
        const x = Math.round(top.x + (bottom.x - top.x) * vv);
        const y = Math.round(top.y + (bottom.y - top.y) * vv);
        const sx = Math.min(BOARD_PX - 1, Math.floor(uu * BOARD_PX));
        const sy = Math.min(BOARD_PX - 1, Math.floor(vv * BOARD_PX));
        page.data[y * 700 + x] = diagram.data[sy * BOARD_PX + sx]!;
      }
    }

    const rectified = warpQuad(page, quad);
    const templates = harvestTemplates(boardFeatures(rectified), CALIBRATION_FEN, false, []);
    // Recognise the SAME skewed photo — templates learned through the warp
    // must classify through the warp.
    const readings = classifyBoard(boardFeatures(rectified), templates);
    const fen = labelsToFen(
      readings.map((r) => r.label),
      false,
    );
    expect(fen.split(' ')[0]).toBe(CALIBRATION_FEN.split(' ')[0]);
  });

  it('caps templates per label and skips near-duplicates', () => {
    const board = renderDiagram(CALIBRATION_FEN);
    const cells = boardFeatures(board);
    let templates: Template[] = [];
    for (let i = 0; i < 5; i++) {
      templates = harvestTemplates(cells, CALIBRATION_FEN, false, templates);
    }
    // Re-harvesting identical cells adds nothing.
    const counts = new Map<CellLabel, number>();
    for (const t of templates) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
    expect(counts.get('empty')!).toBeLessThanOrEqual(16);
    for (const [, n] of counts) expect(n).toBeLessThanOrEqual(16);
    expect(templates.length).toBeLessThan(80);
  });
});

describe('contrast normalisation of a faint board', () => {
  const board = (low: number, high: number): Gray => {
    const data = new Uint8ClampedArray(64 * 64);
    for (let i = 0; i < data.length; i++) data[i] = i % 2 === 0 ? low : high;
    return { w: 64, h: 64, data };
  };

  it('leaves a board that already spans the range byte for byte alone', () => {
    // Identity, not "scaled by about one": this is what makes the change
    // provably free of regression on books that read correctly today.
    const clean = board(10, 255);
    const out = normalizeContrast(clean);
    expect(out).toBe(clean);
  });

  it('pulls a faint board out to the full range', () => {
    const out = normalizeContrast(board(160, 225));
    expect(Math.min(...out.data)).toBe(0);
    expect(Math.max(...out.data)).toBe(255);
  });

  it('does not read the source array as it writes', () => {
    const faint = board(160, 225);
    const before = Uint8ClampedArray.from(faint.data);
    normalizeContrast(faint);
    expect(faint.data).toEqual(before);
  });

  it('leaves a board of one flat shade alone rather than dividing by zero', () => {
    const flat: Gray = { w: 8, h: 8, data: new Uint8ClampedArray(64).fill(200) };
    expect(normalizeContrast(flat)).toBe(flat);
  });
});
