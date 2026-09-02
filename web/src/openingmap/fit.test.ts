import { describe, expect, it } from 'vitest';
import { fitView, LABELS_FADE_OUT, LABELS_LEGIBLE, labelOpacity } from './fit';

const box = { width: 1072, height: 587 };

/** Where each edge of `bounds` lands on screen under `v`. */
function onScreen(v: { x: number; y: number; k: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) {
  return {
    left: v.x + b.minX * v.k,
    right: v.x + b.maxX * v.k,
    top: v.y + b.minY * v.k,
    bottom: v.y + b.maxY * v.k,
  };
}

describe('labelOpacity', () => {
  it('is gone at the fade-out zoom and whole from the legible zoom in', () => {
    expect(labelOpacity(LABELS_FADE_OUT)).toBe(0);
    expect(labelOpacity(0.1)).toBe(0);
    expect(labelOpacity(LABELS_LEGIBLE)).toBe(1);
    expect(labelOpacity(2)).toBe(1);
    expect(labelOpacity((LABELS_FADE_OUT + LABELS_LEGIBLE) / 2)).toBeCloseTo(0.5);
  });
});

describe('fitView', () => {
  it('centres a small picture at the zoom that fits it, legible or not', () => {
    const bounds = { minX: -200, minY: -100, maxX: 200, maxY: 100 };
    const plain = fitView(box, bounds);
    const legible = fitView(box, bounds, { legible: true, anchor: { x: 0, y: 0 } });
    expect(legible).toEqual(plain);
    expect(plain.k).toBe(2);
    const edges = onScreen(plain, bounds);
    expect(edges.left).toBeCloseTo(box.width / 2 - 400);
    expect(edges.top).toBeCloseTo(box.height / 2 - 200);
  });

  it('shows the whole of a big picture when asked plainly', () => {
    // The demo's white map at 1280x720: 1652 units square, fitting at k≈0.32.
    const bounds = { minX: -826, minY: -826, maxX: 826, maxY: 826 };
    const v = fitView(box, bounds);
    expect(v.k).toBeCloseTo((0.92 * box.height) / 1652);
    expect(v.k).toBeLessThan(LABELS_FADE_OUT + 0.05);
    const edges = onScreen(v, bounds);
    expect(edges.top).toBeGreaterThan(0);
    expect(edges.bottom).toBeLessThan(box.height);
  });

  it('floors an arriving fit at the legible zoom, on the anchor, without margin on the overflowing axis', () => {
    const bounds = { minX: -826, minY: -826, maxX: 826, maxY: 826 };
    const v = fitView(box, bounds, { legible: true, anchor: { x: 0, y: 0 } });
    expect(v.k).toBe(LABELS_LEGIBLE);
    expect(labelOpacity(v.k)).toBe(1);
    // 1652 * 0.54 = 892: narrower than the box, so centred on the root
    // horizontally; taller than it, so the root is centred vertically and
    // the picture runs off both the top and the bottom.
    expect(v.x).toBeCloseTo(box.width / 2);
    expect(v.y).toBeCloseTo(box.height / 2);
    const edges = onScreen(v, bounds);
    expect(edges.top).toBeLessThan(0);
    expect(edges.bottom).toBeGreaterThan(box.height);
  });

  it('clamps a root at the edge so the picture, not the margin, fills the box', () => {
    // A lateral tree: the root is the leftmost dot. Centring it would put
    // half a screen of nothing to its left.
    const bounds = { minX: -60, minY: -300, maxX: 4000, maxY: 300 };
    const v = fitView(box, bounds, { legible: true, anchor: { x: 0, y: 0 } });
    expect(v.k).toBe(LABELS_LEGIBLE);
    const edges = onScreen(v, bounds);
    expect(edges.left).toBeCloseTo(0);
    expect(edges.right).toBeGreaterThan(box.width);
    // Not overflowing vertically: centred there as a plain fit would be.
    expect(v.y).toBeCloseTo(box.height / 2);
  });
});
