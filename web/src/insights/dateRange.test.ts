import { describe, expect, it } from 'vitest';
import { DATE_RANGES, rangeFrom } from './dateRange';

describe('quick date ranges', () => {
  const today = new Date(2026, 8, 11); // 11 September 2026, local

  it('counts today as one of the days', () => {
    expect(rangeFrom('7d', today)).toBe('2026-09-05');
    expect(rangeFrom('30d', today)).toBe('2026-08-13');
  });

  it('steps calendar months, across a year end', () => {
    expect(rangeFrom('3m', today)).toBe('2026-06-11');
    expect(rangeFrom('6m', today)).toBe('2026-03-11');
    expect(rangeFrom('12m', today)).toBe('2025-09-11');
  });

  it('sets no bound for any time or custom dates', () => {
    expect(rangeFrom('any', today)).toBeNull();
    expect(rangeFrom('custom', today)).toBeNull();
  });

  it('pads single-digit months and days', () => {
    expect(rangeFrom('7d', new Date(2026, 0, 3))).toBe('2025-12-28');
    for (const range of DATE_RANGES) {
      const from = rangeFrom(range, today);
      if (from) expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
