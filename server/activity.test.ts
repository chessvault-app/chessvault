import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { activityApi, recordActivity, tallyActivity } from './activity.ts';
import type { ActivityReport } from '../shared/activity.ts';

const dirs: string[] = [];
const vault = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'activity-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ask = async (dir: string, query = ''): Promise<ActivityReport> => {
  const app = new Hono().route('/api', activityApi(dir));
  const res = await app.request(`/api/activity${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ActivityReport;
};

/** A trainer history, written straight to the file the route reads. */
const trainerLog = (dir: string, feature: string, lines: unknown[]): void => {
  mkdirSync(resolve(dir, feature), { recursive: true });
  writeFileSync(
    resolve(dir, feature, 'history.jsonl'),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  );
};

describe('recordActivity', () => {
  it('appends one line per event', () => {
    const dir = vault();
    recordActivity('study', { id: 'Openings/Najdorf' }, dir);
    recordActivity('note', { id: 'Ideas' }, dir);
    const lines = readFileSync(resolve(dir, 'activity.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: 'study', id: 'Openings/Najdorf' });
  });

  it('counts a document once a day however often it is saved', () => {
    const dir = vault();
    for (let n = 0; n < 12; n += 1) recordActivity('study', { id: 'Najdorf' }, dir);
    recordActivity('study', { id: 'Berlin' }, dir);
    const lines = readFileSync(resolve(dir, 'activity.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('counts an event with no id every time, since an import is not a document', () => {
    const dir = vault();
    recordActivity('game', { n: 412 }, dir);
    recordActivity('game', { n: 3 }, dir);
    const lines = readFileSync(resolve(dir, 'activity.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).n).toBe(412);
  });

  it('leaves n off an event that moved one thing', () => {
    const dir = vault();
    recordActivity('game', { n: 1 }, dir);
    const [line] = readFileSync(resolve(dir, 'activity.jsonl'), 'utf-8').trim().split('\n');
    expect(JSON.parse(line!).n).toBeUndefined();
  });

  it('says nothing when the vault cannot be written', () => {
    // A path whose parent is a FILE: mkdirSync and appendFileSync both
    // fail. The caller's own job (saving a document) must still succeed,
    // which is what "never throws" is for.
    const dir = vault();
    const wall = resolve(dir, 'wall');
    writeFileSync(wall, 'not a directory');
    expect(() => {
      recordActivity('study', { id: 'x' }, resolve(wall, 'inside'));
    }).not.toThrow();
  });
});

describe('the activity route', () => {
  it('answers an empty vault with nothing, and says so', async () => {
    const report = await ask(vault());
    expect(report.days).toEqual([]);
    // A log that has recorded nothing begins today, so a vault upgraded
    // from a version without one says every day in view is trainer-only.
    expect(report.logSince).toBe(new Date().toISOString().slice(0, 10));
  });

  it('tallies the log and both trainers into one day', async () => {
    const dir = vault();
    trainerLog(dir, 'puzzles', [
      { id: 'a', win: true, counted: true, at: '2026-09-20T10:00:00.000Z' },
      { id: 'b', win: true, counted: true, at: '2026-09-20T10:05:00.000Z' },
      // A loss dates the day but fills nothing.
      { id: 'c', win: false, counted: true, at: '2026-09-20T10:10:00.000Z' },
      // A review is training, not progress: one puzzle must not darken
      // two squares.
      { id: 'a', win: true, counted: false, at: '2026-09-20T11:00:00.000Z' },
    ]);
    trainerLog(dir, 'repertoire', [
      { key: 'k1', result: 'hit', at: '2026-09-20T12:00:00.000Z' },
      // Neither a miss nor a gap is progress through the study.
      { key: 'k2', result: 'miss', at: '2026-09-20T12:01:00.000Z' },
      { key: 'k3', result: 'gap', at: '2026-09-20T12:02:00.000Z' },
    ]);
    writeFileSync(
      resolve(dir, 'activity.jsonl'),
      `${JSON.stringify({ at: '2026-09-20T13:00:00.000Z', kind: 'study', id: 'Najdorf' })}\n`,
    );
    const report = await ask(dir, '?tz=UTC');
    expect(report.days).toEqual([
      { date: '2026-09-20', counts: { puzzle: 2, drill: 1, study: 1 } },
    ]);
    expect(report.logSince).toBe('2026-09-20');
  });

  it('buckets by the zone it is asked for, not the one it runs in', async () => {
    const dir = vault();
    // 22:30 UTC on the 20th is 07:30 on the 21st in Seoul, and 18:30 on
    // the 20th in New York. The same instant, three different days.
    trainerLog(dir, 'puzzles', [
      { id: 'a', win: true, counted: true, at: '2026-09-20T22:30:00.000Z' },
    ]);
    expect((await ask(dir, '?tz=Asia/Seoul')).days[0]!.date).toBe('2026-09-21');
    expect((await ask(dir, '?tz=America/New_York')).days[0]!.date).toBe('2026-09-20');
    expect((await ask(dir, '?tz=UTC')).days[0]!.date).toBe('2026-09-20');
  });

  it('falls back to this machine rather than failing on a zone it cannot use', async () => {
    const dir = vault();
    trainerLog(dir, 'puzzles', [
      { id: 'a', win: true, counted: true, at: '2026-09-20T12:00:00.000Z' },
    ]);
    const report = await ask(dir, '?tz=Mars/Olympus');
    expect(report.days).toHaveLength(1);
  });

  it('leaves a day that holds only failures out of the list', async () => {
    const dir = vault();
    trainerLog(dir, 'puzzles', [
      { id: 'a', win: false, counted: true, at: '2026-09-18T12:00:00.000Z' },
      { id: 'b', win: true, counted: true, at: '2026-09-20T12:00:00.000Z' },
    ]);
    const report = await ask(dir, '?tz=UTC');
    // A day of nothing but failures is drawn as the quiet day it was.
    expect(report.days.map((d) => d.date)).toEqual(['2026-09-20']);
  });

  it('dates the log by its own first line, whatever the trainers reach back to', async () => {
    const dir = vault();
    trainerLog(dir, 'puzzles', [
      { id: 'a', win: true, counted: true, at: '2026-03-01T12:00:00.000Z' },
    ]);
    writeFileSync(
      resolve(dir, 'activity.jsonl'),
      `${JSON.stringify({ at: '2026-09-20T13:00:00.000Z', kind: 'note', id: 'Ideas' })}\n`,
    );
    expect((await ask(dir, '?tz=UTC')).logSince).toBe('2026-09-20');
  });

  it('reports what a bulk event moved without letting it colour the day', async () => {
    const dir = vault();
    writeFileSync(
      resolve(dir, 'activity.jsonl'),
      [
        JSON.stringify({ at: '2026-09-20T09:00:00.000Z', kind: 'game', n: 412 }),
        JSON.stringify({ at: '2026-09-20T10:00:00.000Z', kind: 'game', id: 'A vs B' }),
        JSON.stringify({ at: '2026-09-20T11:00:00.000Z', kind: 'study', id: 'Najdorf' }),
      ].join('\n'),
    );
    const [day] = (await ask(dir, '?tz=UTC')).days;
    // Two things done, not four hundred and thirteen.
    expect(day!.counts).toEqual({ game: 2, study: 1 });
    // The words, for the tip: the study moved one thing and says nothing.
    expect(day!.moved).toEqual({ game: 413 });
  });

  it('drops a damaged line rather than failing the page', async () => {
    const dir = vault();
    writeFileSync(
      resolve(dir, 'activity.jsonl'),
      [
        JSON.stringify({ at: '2026-09-20T09:00:00.000Z', kind: 'study', id: 'a' }),
        '{"at":"2026-09-20T10:00:00.000Z","kind":"no',
        JSON.stringify({ at: '2026-09-20T11:00:00.000Z', kind: 'invented' }),
        JSON.stringify({ kind: 'note' }),
        JSON.stringify({ at: '2026-09-20T12:00:00.000Z', kind: 'note', id: 'b' }),
      ].join('\n'),
    );
    const [day] = (await ask(dir, '?tz=UTC')).days;
    expect(day!.counts).toEqual({ study: 1, note: 1 });
  });

  it('hands the days back oldest first', async () => {
    const dir = vault();
    writeFileSync(
      resolve(dir, 'activity.jsonl'),
      [
        JSON.stringify({ at: '2026-09-22T09:00:00.000Z', kind: 'note', id: 'c' }),
        JSON.stringify({ at: '2026-09-20T09:00:00.000Z', kind: 'note', id: 'a' }),
        JSON.stringify({ at: '2026-09-21T09:00:00.000Z', kind: 'note', id: 'b' }),
      ].join('\n'),
    );
    const report = await ask(dir, '?tz=UTC');
    expect(report.days.map((d) => d.date)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22']);
  });
});

describe('tallyActivity', () => {
  it('needs no files at all, which is what makes the rule testable', () => {
    const report = tallyActivity(
      [{ at: '2026-09-20T09:00:00.000Z', kind: 'book', id: 'polgar' }],
      [{ at: '2026-09-20T09:00:00.000Z', counted: true }],
      [],
      'UTC',
    );
    expect(report.days).toEqual([{ date: '2026-09-20', counts: { book: 1, puzzle: 1 } }]);
    expect(report.logSince).toBe('2026-09-20');
  });
});
