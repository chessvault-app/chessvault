import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LIMIT,
  ACTIVITY_WEEKS,
  activityGrid,
  activityStep,
  dayKey,
  type ActivityAttempt,
} from './activity';

/** A Wednesday, so the grid's last column is a part-week and the three
    days after it are in the future. Local noon, so the local day is the
    same one whatever the runner's offset. */
const NOW = new Date(2026, 8, 16, 12, 0, 0);

const at = (y: number, m: number, d: number, hour = 12): string =>
  new Date(y, m, d, hour).toISOString();

const win = (iso: string): ActivityAttempt => ({ win: true, counted: true, at: iso });

const cell = (grid: ReturnType<typeof activityGrid>, date: string) =>
  grid.weeks.flat().find((c) => c.date === date);

describe('activityGrid', () => {
  it('is 26 columns of 7, Sunday first, ending in the week today is in', () => {
    const grid = activityGrid([], NOW);
    expect(grid.weeks).toHaveLength(ACTIVITY_WEEKS);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    // 2026-09-16 is a Wednesday: its column opens on Sunday the 13th.
    expect(grid.weeks.at(-1)![0]!.date).toBe('2026-09-13');
    expect(grid.weeks.at(-1)![3]!.date).toBe(dayKey(NOW));
  });

  it('draws the days after today as future, not as idle days', () => {
    const grid = activityGrid([], NOW);
    expect(cell(grid, '2026-09-16')!.kind).toBe('day');
    expect(cell(grid, '2026-09-17')!.kind).toBe('future');
    expect(cell(grid, '2026-09-19')!.kind).toBe('future');
  });

  it('counts clean counted wins per local day and ignores the rest', () => {
    const grid = activityGrid(
      [
        win(at(2026, 8, 16, 9)),
        win(at(2026, 8, 16, 21)),
        { win: false, counted: true, at: at(2026, 8, 16) },
        { win: true, counted: false, at: at(2026, 8, 16) },
        win(at(2026, 8, 10)),
      ],
      NOW,
    );
    expect(cell(grid, '2026-09-16')!.count).toBe(2);
    expect(cell(grid, '2026-09-11')!.count).toBe(0);
    expect(grid.total).toBe(3);
    expect(grid.days).toBe(2);
  });

  it('counts the last seven days inclusive of today', () => {
    const grid = activityGrid(
      [win(at(2026, 8, 16)), win(at(2026, 8, 10)), win(at(2026, 8, 9))],
      NOW,
    );
    // 10 Sep is six days back and inside; 9 Sep is seven and outside.
    expect(grid.last7).toBe(2);
  });

  it('drops an attempt outside the window from the totals', () => {
    const grid = activityGrid([win(at(2026, 0, 5))], NOW);
    expect(grid.total).toBe(0);
    expect(grid.weeks.flat().some((c) => c.date === '2026-01-05')).toBe(false);
  });

  it('marks days older than a full tail unknown rather than empty', () => {
    const attempts = Array.from({ length: ACTIVITY_LIMIT }, () => win(at(2026, 8, 14)));
    const grid = activityGrid(attempts, NOW);
    expect(grid.capped).toBe(true);
    expect(cell(grid, '2026-09-13')!.kind).toBe('unknown');
    expect(cell(grid, '2026-09-14')!.kind).toBe('day');
  });

  it('knows the whole window when the tail is short', () => {
    const grid = activityGrid([win(at(2026, 8, 14))], NOW);
    expect(grid.capped).toBe(false);
    expect(grid.weeks.flat().some((c) => c.kind === 'unknown')).toBe(false);
  });

  it('dates a failed attempt too, so a bad day is not hidden by the cap', () => {
    const attempts: ActivityAttempt[] = [
      { win: false, counted: true, at: at(2026, 8, 1) },
      ...Array.from({ length: ACTIVITY_LIMIT - 1 }, () => win(at(2026, 8, 14))),
    ];
    const grid = activityGrid(attempts, NOW);
    expect(cell(grid, '2026-09-01')!.kind).toBe('day');
    expect(cell(grid, '2026-09-01')!.count).toBe(0);
  });

  it('ignores an unparseable timestamp', () => {
    const grid = activityGrid([{ win: true, counted: true, at: 'not a date' }], NOW);
    expect(grid.total).toBe(0);
  });
});

describe('activityStep', () => {
  it('rises in five fixed steps', () => {
    expect([0, 1, 2, 3, 5, 6, 10, 11, 400].map(activityStep)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });
});
