import { describe, expect, it } from 'vitest';
import { computeGaps } from './gaps';

const move = (san: string, total: number) => ({ uci: san, san, total });

describe('computeGaps', () => {
  it('flags popular unmet replies, most popular first', () => {
    const field = [move('c5', 500), move('e5', 300), move('c6', 120), move('d5', 60), move('a6', 20)];
    const { games, metShare, gaps } = computeGaps(field, new Set(['c5', 'e5']));
    expect(games).toBe(1000);
    expect(metShare).toBeCloseTo(0.8);
    // c6 (12%) and d5 (6%) are homework; a6 (2%) is below the threshold.
    expect(gaps).toEqual([
      { san: 'c6', share: 0.12 },
      { san: 'd5', share: 0.06 },
    ]);
  });

  it('everything met is a clean bill', () => {
    const { metShare, gaps } = computeGaps([move('c5', 10)], new Set(['c5']));
    expect(metShare).toBe(1);
    expect(gaps).toEqual([]);
  });

  it('an empty field answers zeros, never NaN', () => {
    expect(computeGaps([], new Set())).toEqual({ games: 0, metShare: 0, gaps: [] });
    expect(computeGaps([move('c5', 0)], new Set())).toEqual({ games: 0, metShare: 0, gaps: [] });
  });
});
