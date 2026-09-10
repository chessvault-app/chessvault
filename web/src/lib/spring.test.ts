import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_V0, springAt, springTrace } from './spring';

/**
 * The motion tokens in index.css are the rest trace of the spring in
 * spring.ts, written down twice because one is CSS and one is a
 * function the swipe hook calls with a velocity. This holds them
 * together the way board-accent.test.ts holds BOARD_ACCENT to the CSS.
 */
describe('spring', () => {
  const css = readFileSync(resolve(__dirname, '..', 'index.css'), 'utf-8');

  it('is what the tokens hold', () => {
    const rest = springTrace(0);
    expect(css).toContain(`--pane-turn: ${rest.ms}ms;`);
    expect(css).toContain(`--pane-turn-ease: ${rest.easing};`);
    expect(css).toContain(`--pane-turn-ease-out: ${rest.exit};`);
  });

  it('exits on the same trace run backwards', () => {
    const rest = springTrace(0);
    const points = (easing: string): number[] =>
      easing
        .slice('linear('.length, -1)
        .split(', ')
        .map((s) => Number(s.split(' ')[0]));
    const enter = points(rest.easing);
    const exit = points(rest.exit);
    expect(exit).toHaveLength(enter.length);
    for (let i = 0; i < enter.length; i++) {
      expect(exit[i]).toBeCloseTo(1 - (enter[enter.length - 1 - i] ?? NaN), 4);
    }
    // Slow off the mark, most of the trip in the second half: the mirror
    // of an entrance that has 88% done by halfway.
    expect(exit[1]).toBeLessThan(0.02);
    expect(exit[Math.floor(exit.length / 2)]).toBeLessThan(0.15);
  });

  it('starts at 0, ends at 1, and does not visibly overshoot within the clamp', () => {
    for (const v0 of [0, 5, 10, MAX_V0, -5]) {
      const t = springTrace(v0);
      expect(springAt(0, v0)).toBeCloseTo(0, 6);
      expect(Math.abs(1 - springAt(t.ms / 1000, v0))).toBeLessThanOrEqual(0.001);
      expect(t.overshoot).toBeLessThan(0.01);
    }
  });

  it('leaves at the speed it was given', () => {
    // dx/dt at t=0 is v0, whatever the damping.
    const h = 1e-5;
    expect((springAt(h, 8) - springAt(0, 8)) / h).toBeCloseTo(8, 2);
    expect((springAt(h, 8, { stiffness: 380, ratio: 1 }) - springAt(0, 8, { stiffness: 380, ratio: 1 })) / h).toBeCloseTo(8, 2);
    expect((springAt(h, 8, { stiffness: 380, ratio: 1.3 }) - springAt(0, 8, { stiffness: 380, ratio: 1.3 })) / h).toBeCloseTo(8, 2);
  });

  it('arrives sooner when released towards the end, and clamps a wild flick', () => {
    expect(springTrace(10).ms).toBeLessThan(springTrace(0).ms);
    expect(springTrace(100)).toBe(springTrace(MAX_V0));
  });
});
