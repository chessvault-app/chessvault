import { describe, expect, it } from 'vitest';
import { cycleAttempt, reviewDueAt, REVIEW_LADDER_DAYS } from './review.ts';

const DAY_MS = 86_400_000;
const at = (daysAgo: number): string => new Date(Date.parse('2026-08-24T12:00:00.000Z') - daysAgo * DAY_MS).toISOString();

describe('reviewDueAt', () => {
  it('never attempted, or never failed, is not in rotation', () => {
    expect(reviewDueAt([])).toBeNull();
    expect(reviewDueAt([{ win: true, at: at(2) }])).toBeNull();
    expect(reviewDueAt([{ win: true, at: at(5) }, { win: true, at: at(2) }])).toBeNull();
  });

  it('a fail is due a day after the fail', () => {
    expect(reviewDueAt([{ win: false, at: at(0) }])).toBe(at(-1));
  });

  it('each clean solve since the fail climbs the ladder from the latest attempt', () => {
    const fail = { win: false, at: at(30) };
    expect(reviewDueAt([fail, { win: true, at: at(10) }])).toBe(at(10 - 3));
    expect(reviewDueAt([fail, { win: true, at: at(20) }, { win: true, at: at(10) }])).toBe(
      at(10 - 7),
    );
    expect(
      reviewDueAt([
        fail,
        { win: true, at: at(25) },
        { win: true, at: at(20) },
        { win: true, at: at(10) },
      ]),
    ).toBe(at(10 - 21));
  });

  it('a clean solve at every step graduates the puzzle out of rotation', () => {
    const wins = REVIEW_LADDER_DAYS.map((_, i) => ({ win: true, at: at(20 - i) }));
    expect(reviewDueAt([{ win: false, at: at(30) }, ...wins])).toBeNull();
  });

  it('a new fail resets the ladder', () => {
    const climbed = [
      { win: false, at: at(30) },
      { win: true, at: at(25) },
      { win: true, at: at(20) },
      { win: false, at: at(2) },
    ];
    expect(reviewDueAt(climbed)).toBe(at(1));
  });

  it('an undated latest attempt is due immediately, like the old failed pool', () => {
    expect(reviewDueAt([{ win: false }])).toBe(new Date(0).toISOString());
    expect(reviewDueAt([{ win: false, at: 'not a date' }])).toBe(new Date(0).toISOString());
  });
});

describe('cycleAttempt', () => {
  const history = [
    { win: false, at: at(20) },
    { win: true, at: at(5) },
    { win: false, at: at(4) },
    { win: true, at: at(1) },
  ];

  it('scores by the FIRST attempt inside the window', () => {
    expect(cycleAttempt(history, { startedAt: at(6) })).toEqual({ win: true, at: at(5) });
  });

  it('a closed window excludes attempts after it finished', () => {
    expect(cycleAttempt(history, { startedAt: at(6), finishedAt: at(3) })).toEqual({
      win: true,
      at: at(5),
    });
    expect(cycleAttempt([history[3]!], { startedAt: at(6), finishedAt: at(3) })).toBeNull();
  });

  it('a puzzle the cycle has not reached answers null', () => {
    expect(cycleAttempt(history, { startedAt: at(0.5) })).toBeNull();
    expect(cycleAttempt([], { startedAt: at(6) })).toBeNull();
    expect(cycleAttempt([{ win: true }], { startedAt: at(6) })).toBeNull();
  });
});
