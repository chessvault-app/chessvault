import { describe, expect, it } from 'vitest';
import { placeLabels, textWidth, type LabelCandidate } from './labels';

const dot = (id: string, x: number, y: number, extra: Partial<LabelCandidate> = {}): LabelCandidate => ({
  id,
  x,
  y,
  r: 5,
  move: '2. Nf3',
  caption: 'C40 King’s Knight Opening',
  weight: 1,
  ...extra,
});

describe('placeLabels', () => {
  it('draws every label of dots that stand apart', () => {
    const out = placeLabels([dot('a', 100, 100), dot('b', 400, 100), dot('c', 100, 300)]);
    for (const id of ['a', 'b', 'c']) expect(out.get(id)).toEqual({ move: true, caption: true });
  });

  it('drops a caption, even the heavier dot’s, before any move label', () => {
    // 24px apart vertically: the heavy dot's caption sits where the light
    // dot's move label does. Move labels are placed first, so it is the
    // heavy caption that goes, and the light dot keeps both of its own.
    const out = placeLabels([dot('heavy', 100, 100, { weight: 5 }), dot('light', 100, 124, { weight: 1 })]);
    expect(out.get('heavy')).toEqual({ move: true, caption: false });
    expect(out.get('light')).toEqual({ move: true, caption: true });
  });

  it('drops the lighter move label when even that collides', () => {
    const out = placeLabels([dot('heavy', 100, 100, { weight: 5 }), dot('light', 104, 103, { weight: 1 })]);
    expect(out.get('heavy')).toEqual({ move: true, caption: true });
    expect(out.get('light')).toEqual({ move: false, caption: false });
  });

  it('keeps a kept label whatever it overlaps, and places it first', () => {
    const out = placeLabels([
      dot('heavy', 100, 100, { weight: 5 }),
      dot('hit', 104, 103, { weight: 1, keep: true }),
    ]);
    expect(out.get('hit')).toEqual({ move: true, caption: true });
    // The heavy dot is now the one that lost: it was placed after the hit.
    expect(out.get('heavy')).toEqual({ move: false, caption: false });
  });

  it('never draws a caption under a move label it dropped', () => {
    const out = placeLabels([dot('a', 100, 100, { weight: 2 }), dot('b', 100, 100, { weight: 1 })]);
    expect(out.get('b')).toEqual({ move: false, caption: false });
  });

  it('places no labels that would cross, over a dense random field', () => {
    // Property: whatever the input, no two placed boxes overlap unless one
    // was kept. Checked with the module's own geometry, so this pins the
    // greedy pass, not the width estimate.
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const cands: LabelCandidate[] = [];
    for (let i = 0; i < 120; i++) {
      cands.push(dot(`n${i}`, rnd() * 600, rnd() * 400, { weight: rnd(), caption: rnd() < 0.7 ? 'B30 Sicilian Defense: Old' : '' }));
    }
    const out = placeLabels(cands);
    const boxes: { l: number; t: number; r: number; b: number }[] = [];
    for (const c of cands) {
      const p = out.get(c.id)!;
      if (p.move) {
        const w = textWidth(c.move, 12, true);
        boxes.push({ l: c.x - w / 2, r: c.x + w / 2, t: c.y + c.r + 12 - 10.8, b: c.y + c.r + 12 + 3 });
      }
      if (p.caption) {
        const w = textWidth(c.caption, 10);
        boxes.push({ l: c.x - w / 2, r: c.x + w / 2, t: c.y + c.r + 24 - 9, b: c.y + c.r + 24 + 2.5 });
      }
    }
    expect(boxes.length).toBeGreaterThan(20);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const cross = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        expect(cross).toBe(false);
      }
    }
  });
});

describe('textWidth', () => {
  it('is wider for Hangul than for the same count of Latin letters', () => {
    expect(textWidth('시작', 12)).toBeGreaterThan(textWidth('St', 12));
  });
  it('grows with the size', () => {
    expect(textWidth('1. e4', 12)).toBeCloseTo(textWidth('1. e4', 6) * 2);
  });
});
