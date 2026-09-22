import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_MAX_WEEKS,
  ACTIVITY_PITCH,
  ACTIVITY_WEEKS,
  activityGrid,
  activityStep,
  dayKey,
  readActivityReport,
  weeksForWidth,
} from './activity';
import type { ActivityDayTally, ActivityReport } from '@shared/activity';

/** A Wednesday, so the grid's last column is a part-week and the three
    days after it are in the future. Local noon, so the local day is the
    same one whatever the runner's offset. */
const NOW = new Date(2026, 8, 16, 12, 0, 0);

/** A report as the server sends it. `logSince` defaults far enough back
    that the whole window is inside the log, which is the ordinary case;
    the tests about the trainer-only days name their own. */
const report = (days: ActivityDayTally[], over: Partial<ActivityReport> = {}): ActivityReport => ({
  days,
  logSince: '2020-01-01',
  ...over,
});

const cell = (grid: ReturnType<typeof activityGrid>, date: string) =>
  grid.weeks.flat().find((c) => c.date === date);

describe('activityGrid', () => {
  it('is 26 columns of 7, Sunday first, ending in the week today is in', () => {
    const grid = activityGrid(report([]), NOW);
    expect(grid.weeks).toHaveLength(ACTIVITY_WEEKS);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    // 2026-09-16 is a Wednesday: its column opens on Sunday the 13th.
    expect(grid.weeks.at(-1)![0]!.date).toBe('2026-09-13');
    expect(grid.weeks.at(-1)![3]!.date).toBe(dayKey(NOW));
  });

  it('draws the days after today as future, not as idle days', () => {
    const grid = activityGrid(report([]), NOW);
    expect(cell(grid, '2026-09-16')!.kind).toBe('day');
    expect(cell(grid, '2026-09-17')!.kind).toBe('future');
    expect(cell(grid, '2026-09-19')!.kind).toBe('future');
  });

  it('adds every kind of a day up into the one number the tone reads', () => {
    const grid = activityGrid(
      report([
        { date: '2026-09-16', counts: { puzzle: 8, study: 2, game: 1 } },
        { date: '2026-09-10', counts: { drill: 3 } },
      ]),
      NOW,
    );
    expect(cell(grid, '2026-09-16')!.count).toBe(11);
    expect(cell(grid, '2026-09-10')!.count).toBe(3);
    expect(cell(grid, '2026-09-11')!.count).toBe(0);
    expect(grid.total).toBe(14);
    expect(grid.days).toBe(2);
  });

  it('keeps the breakdown on the day, for its tip', () => {
    const grid = activityGrid(
      report([{ date: '2026-09-16', counts: { game: 2 }, moved: { game: 413 } }]),
      NOW,
    );
    const day = cell(grid, '2026-09-16')!;
    // The tone reads two things done; the words read what they moved.
    expect(day.count).toBe(2);
    expect(day.counts).toEqual({ game: 2 });
    expect(day.moved).toEqual({ game: 413 });
  });

  it('counts the last seven days inclusive of today', () => {
    const grid = activityGrid(
      report([
        { date: '2026-09-16', counts: { puzzle: 1 } },
        { date: '2026-09-10', counts: { puzzle: 1 } },
        { date: '2026-09-09', counts: { puzzle: 1 } },
      ]),
      NOW,
    );
    // 10 Sep is six days back and inside; 9 Sep is seven and outside.
    expect(grid.last7).toBe(2);
  });

  it('drops a day outside the window from the totals', () => {
    const grid = activityGrid(report([{ date: '2026-01-05', counts: { puzzle: 4 } }]), NOW);
    expect(grid.total).toBe(0);
    expect(grid.weeks.flat().some((c) => c.date === '2026-01-05')).toBe(false);
  });

  it('draws a day it was told nothing about as a quiet day, not a hollow one', () => {
    // The server reads whole files, so a day missing from the report is a
    // day that held nothing rather than one nobody could see.
    const grid = activityGrid(report([{ date: '2026-09-14', counts: { puzzle: 1 } }]), NOW);
    expect(grid.weeks.flat().every((c) => c.kind === 'day' || c.kind === 'future')).toBe(true);
    expect(cell(grid, '2026-09-13')!.count).toBe(0);
  });

  it('draws an empty frame while the answer is still in the air', () => {
    const grid = activityGrid(null, NOW);
    expect(grid.total).toBe(0);
    expect(grid.logFrom).toBeNull();
  });

  it('names the day the log began, when the window reaches back past it', () => {
    const grid = activityGrid(
      report([{ date: '2026-09-14', counts: { puzzle: 1 } }], { logSince: '2026-09-15' }),
      NOW,
    );
    // Those days are ordinary days holding real trainer counts; what
    // each one carries is a flag for its own tip.
    expect(cell(grid, '2026-09-14')!.kind).toBe('day');
    expect(cell(grid, '2026-09-14')!.partial).toBe(true);
    expect(cell(grid, '2026-09-15')!.partial).toBeUndefined();
    expect(cell(grid, '2026-09-16')!.partial).toBeUndefined();
    // The day the log started, NOT the window's own left edge, which is
    // a fact about how wide the panel is and means nothing to a reader.
    expect(grid.logFrom).toBe('2026-09-15');
  });

  it('says nothing about the log once the window is all inside it', () => {
    expect(activityGrid(report([]), NOW).logFrom).toBeNull();
  });
});

describe('activityStep', () => {
  it('rises in five fixed steps', () => {
    expect([0, 1, 2, 3, 5, 6, 10, 11, 400].map(activityStep)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });
});

describe('readActivityReport', () => {
  it('takes the server at its word when the shape is right', () => {
    expect(
      readActivityReport({
        days: [{ date: '2026-09-16', counts: { puzzle: 3 } }],
        logSince: '2026-09-01',
      }),
    ).toEqual({
      days: [{ date: '2026-09-16', counts: { puzzle: 3 } }],
      logSince: '2026-09-01',
    });
  });

  it('is null for anything that is not a report, which is how the card hides', () => {
    expect(readActivityReport(null)).toBeNull();
    expect(readActivityReport('nope')).toBeNull();
    expect(readActivityReport({})).toBeNull();
  });

  it('drops a kind this build has never heard of rather than counting it', () => {
    const out = readActivityReport({
      days: [{ date: '2026-09-16', counts: { puzzle: 2, seance: 9 } }],
      logSince: '2026-01-01',
    });
    expect(out!.days[0]!.counts).toEqual({ puzzle: 2 });
  });

  it('drops a day that nothing is left in, and a count that is not one', () => {
    const out = readActivityReport({
      days: [
        { date: '2026-09-16', counts: { puzzle: 'lots' } },
        { date: '2026-09-15', counts: { puzzle: 0 } },
        { date: 7, counts: { puzzle: 1 } },
        { date: '2026-09-14', counts: { note: 1 } },
      ],
    });
    expect(out!.days).toEqual([{ date: '2026-09-14', counts: { note: 1 } }]);
    // An answer with no logSince is one from a server too old to have a
    // log: every day in view is then trainer-only, which is what a floor
    // no day can be before says.
    expect(out!.logSince).toBe('9999-12-31');
  });
});

describe('weeksForWidth', () => {
  it('fills the room it is given, a column at a time', () => {
    // n columns need n * PITCH - 2: the last one carries no gutter.
    const room = (n: number) => n * ACTIVITY_PITCH - 2;
    expect(weeksForWidth(room(30))).toBe(30);
    expect(weeksForWidth(room(40))).toBe(40);
    // One pixel short of the next column is still the current one, and
    // the pixel that completes it takes it.
    expect(weeksForWidth(room(40) + ACTIVITY_PITCH - 1)).toBe(40);
    expect(weeksForWidth(room(41))).toBe(41);
  });

  it('never draws less than the half year, whatever the room', () => {
    // The card's own measured widths, which are what this replaces a
    // fixed 26 for: 648px at a 900px viewport, 480 at 1280, 482 at 1600.
    // 648 has room for 54, which the cap below takes back to a year.
    expect(weeksForWidth(648)).toBe(ACTIVITY_MAX_WEEKS);
    expect(weeksForWidth(480)).toBe(40);
    expect(weeksForWidth(482)).toBe(40);
    // A 390px phone has 334px of room, which is the half year and a
    // couple of columns over.
    expect(weeksForWidth(334)).toBe(28);
    // Narrower than the floor keeps the floor and scrolls sideways.
    expect(weeksForWidth(200)).toBe(ACTIVITY_WEEKS);
    expect(weeksForWidth(0)).toBe(ACTIVITY_WEEKS);
    expect(weeksForWidth(Number.NaN)).toBe(ACTIVITY_WEEKS);
  });

  it('stops at a year, however wide the panel', () => {
    expect(weeksForWidth(5000)).toBe(ACTIVITY_MAX_WEEKS);
  });

  it('hands that count to the grid', () => {
    const grid = activityGrid(report([]), NOW, weeksForWidth(482));
    expect(grid.weeks).toHaveLength(40);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    // Still ends in the week today is in: a wider panel reaches further
    // back, never further forward.
    expect(grid.weeks.at(-1)![0]!.date).toBe('2026-09-13');
  });
});
