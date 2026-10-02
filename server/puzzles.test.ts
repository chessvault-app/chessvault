import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { PUZZLE_DUMP_DOWNLOAD, REPO_ROOT } from './paths.ts';
import { buildFailure, puzzlesApi, ratingBound, sweepUnfinishedPuzzleBuild } from './puzzles.ts';

describe('puzzles api', () => {
  let dir: string;
  let app: Hono;
  let puzzles: ReturnType<typeof puzzlesApi>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'puzzles-api-'));
    const dbPath = join(dir, 'puzzles.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE puzzles (
        id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL,
        rating INTEGER NOT NULL, rd INTEGER NOT NULL, popularity INTEGER NOT NULL,
        plays INTEGER NOT NULL, themes TEXT NOT NULL, game_url TEXT, opening_tags TEXT
      );
      CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('puzzles', '3');
      INSERT INTO puzzles VALUES
        ('aaa', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1500, 80, 90, 10, 'endgame short', NULL, NULL),
        ('bbb', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1520, 80, 90, 10, 'fork short', NULL, NULL),
        ('ccc', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 2400, 80, 90, 10, 'endgame long', NULL, NULL);
      INSERT INTO themes VALUES
        ('endgame', 1500, 'aaa'), ('short', 1500, 'aaa'),
        ('fork', 1520, 'bbb'), ('short', 1520, 'bbb'),
        ('endgame', 2400, 'ccc'), ('long', 2400, 'ccc');
    `);
    db.close();
    puzzles = puzzlesApi(dbPath, join(dir, 'state'));
    app = new Hono().route('/api', puzzles);
  });

  afterAll(() => {
    puzzles.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  const attempt = (id: string, win: boolean, counted?: boolean): Promise<Response> | Response =>
    app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(counted === undefined ? { id, win } : { id, win, counted }),
    });

  it('keeps the rating window to whole ratings on the scale', () => {
    // The window keys a cache, and an unbounded float was an unbounded
    // cache: every distinct value a new entry.
    expect(ratingBound('1500.0001', 0)).toBe(1500);
    expect(ratingBound('-40', 0)).toBe(0);
    expect(ratingBound('1e9', 9999)).toBe(9999);
    expect(ratingBound('abc', 9999)).toBe(9999);
    expect(ratingBound(undefined, 0)).toBe(0);
  });

  it('answers the history for a negative limit with one row, not the whole file', async () => {
    await attempt('aaa', true);
    await attempt('bbb', false);
    const all = await (await app.request('/api/puzzles/history?limit=-1')).json();
    expect(all.attempts).toHaveLength(1);
    const two = await (await app.request('/api/puzzles/history?limit=2')).json();
    expect(two.attempts).toHaveLength(2);
    // Newest first, each with its puzzle's tags joined in by id, so the
    // dashboard can name a row by its motif rather than by "#bbb".
    expect(two.attempts.map((a: { themes?: string[] }) => a.themes)).toEqual([
      ['fork', 'short'],
      ['endgame', 'short'],
    ]);
    // The counters the tests below start from are the defaults.
    await app.request('/api/puzzles/reset', { method: 'POST' });
  });

  it('reports meta with default counters', async () => {
    const res = await app.request('/api/puzzles/meta');
    const body = await res.json();
    expect(body.ready).toBe(true);
    expect(body.puzzles).toBe(3);
    expect(body.user).toEqual({ attempts: 0, wins: 0, streak: 0 });
    expect(body.themes.find((t: { theme: string }) => t.theme === 'fork').count).toBe(1);
  });

  it('filters by difficulty range and theme', async () => {
    const easy = await (await app.request('/api/puzzles/next?max=1600')).json();
    expect(['aaa', 'bbb']).toContain(easy.puzzle.id);

    const expert = await (await app.request('/api/puzzles/next?min=2000')).json();
    expect(expert.puzzle.id).toBe('ccc');

    const fork = await (await app.request('/api/puzzles/next?theme=fork')).json();
    expect(fork.puzzle.id).toBe('bbb');

    expect((await app.request('/api/puzzles/next?theme=nosuchtheme')).status).toBe(404);
  });

  it('counts attempts, wins and streaks', async () => {
    const win = await (await attempt('aaa', true)).json();
    expect(win.user).toEqual({ attempts: 1, wins: 1, streak: 1 });

    const loss = await (await attempt('bbb', false)).json();
    expect(loss.user).toEqual({ attempts: 2, wins: 1, streak: 0 });
  });

  it('never re-serves attempted puzzles while others remain', async () => {
    // aaa and bbb are attempted; every fresh pick must be ccc.
    for (let i = 0; i < 5; i++) {
      const { puzzle } = await (await app.request('/api/puzzles/next')).json();
      expect(puzzle.id).toBe('ccc');
    }
    // With every puzzle in the range attempted, repeats are allowed
    // rather than dead-ending.
    const { puzzle } = await (await app.request('/api/puzzles/next?max=1600')).json();
    expect(['aaa', 'bbb']).toContain(puzzle.id);
  });

  it('tracks failed puzzles and retires them after an uncounted review solve', async () => {
    const meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.failed).toBe(1); // bbb

    const next = await app.request('/api/puzzles/next?mode=failed');
    expect(next.status).toBe(200);
    expect((await next.json()).puzzle.id).toBe('bbb');

    // Review solve: counters stay put …
    const before = (await (await app.request('/api/puzzles/meta')).json()).user;
    const body = await (await attempt('bbb', true, false)).json();
    expect(body.user).toEqual(before);

    // … but the clean solve empties the pool.
    const after = await (await app.request('/api/puzzles/meta')).json();
    expect(after.failed).toBe(0);
    expect((await app.request('/api/puzzles/next?mode=failed')).status).toBe(404);
  });

  it('uncounted attempts never introduce new puzzles to the review pool', async () => {
    // ccc has no counted attempt yet — a failed uncounted replay of it must
    // not enter the pool, or 'to review' could exceed 'attempts'.
    await attempt('ccc', false, false);
    let meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.failed).toBe(0);

    // A counted fail makes it reviewable like any trained puzzle.
    await attempt('ccc', false);
    meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.failed).toBe(1);
  });

  it('reset wipes counters, history and the review pool', async () => {
    // Ensure there is something to wipe.
    await attempt('ccc', false);
    let meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.user.attempts).toBeGreaterThan(0);
    expect(meta.failed).toBeGreaterThan(0);

    const res = await app.request('/api/puzzles/reset', { method: 'POST' });
    expect(res.status).toBe(200);

    meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.user).toEqual({ attempts: 0, wins: 0, streak: 0 });
    expect(meta.failed).toBe(0);
    const history = await (await app.request('/api/puzzles/history')).json();
    expect(history.attempts).toEqual([]);
  });

  it('tolerates a damaged history line instead of failing every route', async () => {
    // A crash mid-append leaves a partial last line. That line is one lost
    // attempt; it must never 500 the trainer until someone edits the file
    // by hand.
    await attempt('bbb', false);
    appendFileSync(join(dir, 'state', 'history.jsonl'), '{"id":"aaa","wi');

    const history = await (await app.request('/api/puzzles/history')).json();
    expect(history.attempts.map((a: { id: string }) => a.id)).toEqual(['bbb']);

    const meta = await app.request('/api/puzzles/meta');
    expect(meta.status).toBe(200);
    expect((await meta.json()).failed).toBe(1);

    const failed = await app.request('/api/puzzles/next?mode=failed');
    expect(failed.status).toBe(200);

    await app.request('/api/puzzles/reset', { method: 'POST' });
  });

  it('rejects malformed attempts and unknown puzzles', async () => {
    const bad = await app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'aaa' }),
    });
    expect(bad.status).toBe(400);

    const unknown = await attempt('zzz', true);
    expect((await unknown).status).toBe(404);
  });
});

/**
 * The review schedule (shared/review.ts) as the API wears it: meta's due
 * counts and review mode's due-first serving. Attempts are written into
 * history.jsonl directly because the route always stamps "now" and a
 * schedule is only observable from a back-dated log.
 */
describe('puzzles review schedule', () => {
  let dir: string;
  let app: Hono;
  let puzzles: ReturnType<typeof puzzlesApi>;

  const DAY_MS = 86_400_000;
  const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString();
  const writeHistory = (
    lines: { id: string; win: boolean; at: string; counted?: boolean }[],
  ): void => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'history.jsonl'),
      lines
        .map((l) => JSON.stringify({ counted: true, puzzleRating: 1500, ...l }))
        .join('\n') + '\n',
    );
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'puzzles-review-'));
    const dbPath = join(dir, 'puzzles.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE puzzles (
        id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL,
        rating INTEGER NOT NULL, rd INTEGER NOT NULL, popularity INTEGER NOT NULL,
        plays INTEGER NOT NULL, themes TEXT NOT NULL, game_url TEXT, opening_tags TEXT
      );
      CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('puzzles', '2');
      INSERT INTO puzzles VALUES
        ('aaa', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1500, 80, 90, 10, 'endgame short', NULL, NULL),
        ('bbb', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1520, 80, 90, 10, 'fork short', NULL, NULL);
      INSERT INTO themes VALUES
        ('endgame', 1500, 'aaa'), ('fork', 1520, 'bbb');
    `);
    db.close();
    puzzles = puzzlesApi(dbPath, join(dir, 'state'));
    app = new Hono().route('/api', puzzles);
  });

  afterAll(() => {
    puzzles.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a day-old fail is due; a fresh fail is only in the pool', async () => {
    writeHistory([
      { id: 'aaa', win: false, at: daysAgo(2) },
      { id: 'bbb', win: false, at: daysAgo(0) },
    ]);
    const meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.failed).toBe(2);
    expect(meta.due).toBe(1); // aaa's day has come; bbb's is tomorrow
    expect(meta.nextDue).not.toBeNull();

    // Review serves the due puzzle ahead of the merely failed one.
    const next = await (await app.request('/api/puzzles/next?mode=failed')).json();
    expect(next.puzzle.id).toBe('aaa');
  });

  it('a clean solve mid-ladder leaves rotation pending, not due', async () => {
    writeHistory([
      { id: 'aaa', win: false, at: daysAgo(10) },
      { id: 'aaa', win: true, at: daysAgo(1), counted: false },
    ]);
    const meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.failed).toBe(0); // latest attempt won — out of the pool
    expect(meta.due).toBe(0); // …but back in 3 days
    expect(meta.nextDue).not.toBeNull();
    // Nothing due and nothing failed: review has nothing to serve yet.
    expect((await app.request('/api/puzzles/next?mode=failed')).status).toBe(404);
  });

  it('the ladder brings a solved review back when its date comes', async () => {
    writeHistory([
      { id: 'aaa', win: false, at: daysAgo(10) },
      { id: 'aaa', win: true, at: daysAgo(4), counted: false },
    ]);
    const meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.failed).toBe(0);
    expect(meta.due).toBe(1); // 3 days after the solve have passed
    const next = await (await app.request('/api/puzzles/next?mode=failed')).json();
    expect(next.puzzle.id).toBe('aaa');
  });

  it('a clean solve at every step graduates the puzzle for good', async () => {
    writeHistory([
      { id: 'aaa', win: false, at: daysAgo(40) },
      { id: 'aaa', win: true, at: daysAgo(38), counted: false },
      { id: 'aaa', win: true, at: daysAgo(30), counted: false },
      { id: 'aaa', win: true, at: daysAgo(20), counted: false },
      { id: 'aaa', win: true, at: daysAgo(2), counted: false },
    ]);
    const meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.due).toBe(0);
    expect(meta.nextDue).toBeNull();
    expect((await app.request('/api/puzzles/next?mode=failed')).status).toBe(404);
  });

  it('uncounted attempts alone never put a puzzle into rotation', async () => {
    writeHistory([{ id: 'aaa', win: false, at: daysAgo(5), counted: false }]);
    const meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.due).toBe(0);
    expect(meta.nextDue).toBeNull();
  });
});

/**
 * The fast draw path. Databases built since the rating_counts tables exist
 * resolve a random offset through them instead of walking the index; this
 * must be indistinguishable from the walk — same rows in, same rows out,
 * every one of them reachable. Two puzzles share rating 1500 so the offset
 * *inside* a bucket is exercised too.
 */
describe('puzzles api (rating_counts fast path)', () => {
  let dir: string;
  let app: Hono;
  let puzzles: ReturnType<typeof puzzlesApi>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'puzzles-buckets-'));
    const dbPath = join(dir, 'puzzles.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE puzzles (
        id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL,
        rating INTEGER NOT NULL, rd INTEGER NOT NULL, popularity INTEGER NOT NULL,
        plays INTEGER NOT NULL, themes TEXT NOT NULL, game_url TEXT, opening_tags TEXT
      );
      CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('puzzles', '4');
      INSERT INTO puzzles VALUES
        ('aaa', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1500, 80, 90, 10, 'endgame short', NULL, NULL),
        ('aab', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1500, 80, 90, 10, 'endgame short', NULL, NULL),
        ('bbb', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1520, 80, 90, 10, 'fork short', NULL, NULL),
        ('ccc', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 2400, 80, 90, 10, 'endgame long', NULL, NULL);
      INSERT INTO themes VALUES
        ('endgame', 1500, 'aaa'), ('short', 1500, 'aaa'),
        ('endgame', 1500, 'aab'), ('short', 1500, 'aab'),
        ('fork', 1520, 'bbb'), ('short', 1520, 'bbb'),
        ('endgame', 2400, 'ccc'), ('long', 2400, 'ccc');
      CREATE TABLE rating_counts AS
        SELECT rating, COUNT(*) AS n FROM puzzles GROUP BY rating;
      CREATE TABLE theme_rating_counts AS
        SELECT theme, rating, COUNT(*) AS n FROM themes GROUP BY theme, rating;
    `);
    db.close();
    puzzles = puzzlesApi(dbPath, join(dir, 'state'));
    app = new Hono().route('/api', puzzles);
  });

  afterAll(() => {
    puzzles.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  // Each ask skips the last answer: a question asked twice is answered
  // with the same puzzle until it is attempted or skipped, and this is
  // about what the PICKER can reach, not about what stands.
  const drawMany = async (query: string, n = 60): Promise<Set<string>> => {
    const seen = new Set<string>();
    let last = '';
    for (let i = 0; i < n; i++) {
      const res = await app.request(`/api/puzzles/next${query}${last && `&skip=${last}`}`);
      expect(res.status).toBe(200);
      last = (await res.json()).puzzle.id;
      seen.add(last);
    }
    return seen;
  };

  it('honours the rating range, including inside a shared rating', async () => {
    expect(await drawMany('?max=1600')).toEqual(new Set(['aaa', 'aab', 'bbb']));
    expect(await drawMany('?min=2000')).toEqual(new Set(['ccc']));
    expect(await drawMany('?min=1500&max=1500')).toEqual(new Set(['aaa', 'aab']));
  });

  it('honours the theme filter', async () => {
    expect(await drawMany('?theme=short')).toEqual(new Set(['aaa', 'aab', 'bbb']));
    expect(await drawMany('?theme=fork')).toEqual(new Set(['bbb']));
    expect(await drawMany('?theme=endgame&min=2000')).toEqual(new Set(['ccc']));
  });

  it('404s on a filter that matches nothing', async () => {
    expect((await app.request('/api/puzzles/next?theme=nosuchtheme')).status).toBe(404);
    expect((await app.request('/api/puzzles/next?min=3000')).status).toBe(404);
  });
});

describe('adaptive difficulty', () => {
  let dir: string;
  let app: Hono;
  let puzzles: ReturnType<typeof puzzlesApi>;
  let statePath: string;

  const makeDb = (path: string): void => {
    const db = new Database(path);
    db.exec(`
      CREATE TABLE puzzles (
        id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL,
        rating INTEGER NOT NULL, rd INTEGER NOT NULL, popularity INTEGER NOT NULL,
        plays INTEGER NOT NULL, themes TEXT NOT NULL, game_url TEXT, opening_tags TEXT
      );
      CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('puzzles', '3');
      INSERT INTO puzzles VALUES
        ('low1', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1000, 80, 90, 10, 'endgame', NULL, NULL),
        ('mid1', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1500, 80, 90, 10, 'endgame', NULL, NULL),
        ('high1', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 2400, 80, 90, 10, 'endgame', NULL, NULL);
    `);
    db.close();
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'puzzles-adaptive-'));
    const dbPath = join(dir, 'puzzles.sqlite');
    makeDb(dbPath);
    statePath = join(dir, 'state', 'state.json');
    puzzles = puzzlesApi(dbPath, join(dir, 'state'));
    app = new Hono().route('/api', puzzles);
  });

  afterAll(() => {
    puzzles.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  const readSkill = (): { skill?: number; skillAttempts?: number } =>
    JSON.parse(readFileSync(statePath, 'utf-8'));

  it('seeds the estimate mid-pool and serves near it', async () => {
    const res = await app.request('/api/puzzles/next?adaptive=1');
    const { puzzle } = await res.json();
    // A fresh estimate is 1500; the first window is [1400, 1700].
    expect(puzzle.id).toBe('mid1');
    expect(readSkill().skill).toBe(1500);
    expect(readSkill().skillAttempts).toBe(0);
  });

  it('serves around a stored estimate, widening when the window is empty', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({ attempts: 0, wins: 0, streak: 0, skill: 2400, skillAttempts: 50 }),
    );
    const at2400 = await (await app.request('/api/puzzles/next?adaptive=1')).json();
    expect(at2400.puzzle.id).toBe('high1');
    // 1800: [1700, 2000] holds nothing, [1500, 2200] catches mid1.
    writeFileSync(
      statePath,
      JSON.stringify({ attempts: 0, wins: 0, streak: 0, skill: 1800, skillAttempts: 50 }),
    );
    const at1800 = await (await app.request('/api/puzzles/next?adaptive=1')).json();
    expect(at1800.puzzle.id).toBe('mid1');
  });

  it('moves the estimate on counted attempts and never reveals it', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({ attempts: 0, wins: 0, streak: 0, skill: 1500, skillAttempts: 50 }),
    );
    const win = await app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'high1', win: true }),
    });
    const winBody = await win.json();
    expect(winBody.user).toEqual({ attempts: 1, wins: 1, streak: 1 });
    const afterWin = readSkill();
    // Beating a 2400 puzzle from 1500 is worth nearly the whole K of 20.
    expect(afterWin.skill!).toBeGreaterThan(1515);
    expect(afterWin.skillAttempts).toBe(51);

    await app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'low1', win: false }),
    });
    // Losing to a 1000 puzzle costs nearly the whole K.
    expect(readSkill().skill!).toBeLessThan(afterWin.skill! - 15);

    const meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.user).toEqual({ attempts: 2, wins: 1, streak: 0 });
  });

  it('seeds from the attempt history when no estimate is stored yet', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'puzzles-adaptive-seed-'));
    const dbPath = join(dir2, 'puzzles.sqlite');
    makeDb(dbPath);
    mkdirSync(join(dir2, 'state'), { recursive: true });
    const lines = Array.from({ length: 10 }, () =>
      JSON.stringify({ id: 'old', win: true, counted: true, puzzleRating: 2400 }),
    );
    // An uncounted replay and a prehistoric line without a rating fold in as nothing.
    lines.push(JSON.stringify({ id: 'old', win: false, counted: false, puzzleRating: 2400 }));
    lines.push(JSON.stringify({ id: 'older', win: false }));
    writeFileSync(join(dir2, 'state', 'history.jsonl'), `${lines.join('\n')}\n`);
    const seeded = puzzlesApi(dbPath, join(dir2, 'state'));
    const app2 = new Hono().route('/api', seeded);
    await app2.request('/api/puzzles/next?adaptive=1');
    const state = JSON.parse(readFileSync(join(dir2, 'state', 'state.json'), 'utf-8'));
    expect(state.skill).toBeGreaterThan(1700);
    expect(state.skillAttempts).toBe(10);
    seeded.closeDb();
    rmSync(dir2, { recursive: true, force: true });
  });
});

/**
 * A build the app was quit in the middle of leaves 2.6 GB nothing lists
 * and no page can delete. Startup is the only moment when it is known to
 * be dead.
 */
describe('sweepUnfinishedPuzzleBuild', () => {
  let data: string;
  let dbPath: string;

  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'puzzles-sweep-'));
    dbPath = join(data, 'puzzles.sqlite');
  });

  afterEach(() => {
    rmSync(data, { recursive: true, force: true });
  });

  /** The builder's temp file, at the point the child would have been
      killed: `finished` false is one that never wrote its closing rows. */
  const building = (finished: boolean, id = 'aaa'): string => {
    const path = `${dbPath}.building`;
    const db = new Database(path);
    db.exec(`
      CREATE TABLE puzzles (
        id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL,
        rating INTEGER NOT NULL, rd INTEGER NOT NULL, popularity INTEGER NOT NULL,
        plays INTEGER NOT NULL, themes TEXT NOT NULL, game_url TEXT, opening_tags TEXT
      );
      CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO puzzles VALUES
        ('${id}', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1500, 80, 90, 10, 'short', NULL, NULL);
      INSERT INTO themes VALUES ('short', 1500, '${id}');
    `);
    if (finished) {
      db.exec(`
        CREATE TABLE theme_counts AS SELECT theme, COUNT(*) AS count FROM themes GROUP BY theme;
        INSERT INTO meta VALUES
          ('schema_version', '1'), ('puzzles', '1'),
          ('built_at', '2026-08-16T00:00:00.000Z'), ('source', 'lichess_db_puzzle.csv.zst');
      `);
    }
    db.close();
    return path;
  };

  const idIn = (path: string): string => {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    const row = db.prepare('SELECT id FROM puzzles LIMIT 1').get() as { id: string };
    db.close();
    return row.id;
  };

  it('renames in a build that finished and only missed its rename', () => {
    const path = building(true, 'done');
    sweepUnfinishedPuzzleBuild(dbPath);
    expect(existsSync(path)).toBe(false);
    expect(idIn(dbPath)).toBe('done');
  });

  it('discards one killed before it wrote its closing rows', () => {
    const path = building(false);
    sweepUnfinishedPuzzleBuild(dbPath);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dbPath)).toBe(false);
  });

  it('discards rubble that is not a database at all', () => {
    const path = `${dbPath}.building`;
    writeFileSync(path, 'half a gigabyte of nothing');
    sweepUnfinishedPuzzleBuild(dbPath);
    expect(existsSync(path)).toBe(false);
  });

  it('leaves the database in place when the part-built one is discarded', () => {
    writeFileSync(dbPath, 'the database this test never reads');
    building(false);
    sweepUnfinishedPuzzleBuild(dbPath);
    expect(readFileSync(dbPath, 'utf-8')).toBe('the database this test never reads');
  });

  it('drops a half-finished download but keeps the dump itself', () => {
    const dump = join(data, 'lichess_db_puzzle.csv.zst');
    writeFileSync(`${dump}.part`, 'interrupted');
    writeFileSync(dump, 'the user put this here');
    sweepUnfinishedPuzzleBuild(dbPath);
    expect(existsSync(`${dump}.part`)).toBe(false);
    expect(existsSync(dump)).toBe(true);
  });

  it('drops a whole download too: a build re-fetches rather than reuse one', () => {
    const ours = join(data, PUZZLE_DUMP_DOWNLOAD);
    writeFileSync(`${ours}.part`, 'interrupted');
    writeFileSync(ours, 'downloaded by a build that then died');
    writeFileSync(join(data, 'lichess_db_puzzle.csv.zst'), 'the user put this here');
    sweepUnfinishedPuzzleBuild(dbPath);
    expect(existsSync(`${ours}.part`)).toBe(false);
    expect(existsSync(ours)).toBe(false);
    expect(existsSync(join(data, 'lichess_db_puzzle.csv.zst'))).toBe(true);
  });

  it('is a no-op with nothing to sweep', () => {
    sweepUnfinishedPuzzleBuild(dbPath);
    expect(existsSync(dbPath)).toBe(false);
  });
});

describe('buildFailure', () => {
  it('names a kill by its signal, before anything the child last said', () => {
    expect(buildFailure(null, 'SIGKILL', 'indexing…')).toMatch(/killed \(SIGKILL\).*out of memory/);
    expect(buildFailure(null, 'SIGTERM', '')).toBe('the build was stopped (SIGTERM)');
  });

  it('otherwise says what the child last wrote, or its exit code', () => {
    expect(buildFailure(1, null, 'unexpected header: x')).toBe('unexpected header: x');
    expect(buildFailure(3, null, '')).toBe('the build stopped unexpectedly (exit 3)');
  });
});

/**
 * A dump in the Lichess layout, zstd-compressed as the real one is: the
 * real builder reads it, so these tests run the same child process the
 * app's button does, on a few hundred rows instead of 6.1 million.
 */
const dumpOf = (rows: { id: string; rating: number }[]): Buffer =>
  zstdCompressSync(
    `${[
      'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags',
      ...rows.map((r) => `${r.id},8/8/8/8/8/8/8/K6k w - - 0 1,a1a2 h1h2,${r.rating},80,90,10,short,,`),
    ].join('\n')}\n`,
  );

/**
 * Replacing a database the server is already serving: the build runs
 * beside it, and whatever the old file answered must be forgotten when
 * the new one lands.
 */
describe('puzzles api (rebuilding a working database)', () => {
  let data: string;
  let dump: string;
  let app: Hono;
  let puzzles: ReturnType<typeof puzzlesApi>;
  const savedData = process.env.CHESS_VAULT_DATA;

  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'puzzles-rebuild-'));
    // A dump already in the data directory is the one the builder uses,
    // so no test downloads anything. The builder is a child process that
    // finds that directory the way the server does, from the environment.
    dump = join(data, 'lichess_db_puzzle.csv.zst');
    process.env.CHESS_VAULT_DATA = data;
    puzzles = puzzlesApi(join(data, 'puzzles.sqlite'), join(data, 'state'));
    app = new Hono().route('/api', puzzles);
  });

  afterEach(() => {
    puzzles.closeDb();
    if (savedData === undefined) delete process.env.CHESS_VAULT_DATA;
    else process.env.CHESS_VAULT_DATA = savedData;
    rmSync(data, { recursive: true, force: true });
  });

  /** Start a build and wait for it to end, returning its last status. */
  const build = async (): Promise<{ running: boolean; error?: string | null }> => {
    expect((await app.request('/api/puzzles/build', { method: 'POST' })).status).toBe(200);
    for (;;) {
      const status = (await (await app.request('/api/puzzles/build')).json()) as {
        running: boolean;
        error?: string | null;
      };
      if (!status.running) return status;
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  /** A fresh draw: asking past the standing offer makes it go through the counts. */
  const draw = async (skip: string): Promise<{ status: number; id?: string }> => {
    const res = await app.request(`/api/puzzles/next?skip=${skip}`);
    if (res.status !== 200) return { status: res.status };
    const body = (await res.json()) as { puzzle?: { id: string } };
    return { status: res.status, id: body.puzzle?.id };
  };

  it('says whether the next build would download, for the Rebuild question', async () => {
    const dumpInPlace = async (): Promise<unknown> =>
      ((await (await app.request('/api/puzzles/build')).json()) as { dumpInPlace?: unknown }).dumpInPlace;
    expect(await dumpInPlace()).toBe(false);
    writeFileSync(dump, dumpOf([{ id: 'a0', rating: 1500 }]));
    expect(await dumpInPlace()).toBe(true);
    // And still after a build from it, which keeps it.
    expect((await build()).error ?? null).toBeNull();
    expect(await dumpInPlace()).toBe(true);
  }, 60_000);

  it('says it is building, never downloading, while it builds from a dump in place', async () => {
    writeFileSync(dump, dumpOf(Array.from({ length: 300 }, (_, i) => ({ id: `a${i}`, rating: 1500 }))));
    expect((await app.request('/api/puzzles/build', { method: 'POST' })).status).toBe(200);
    // The first answer is the server's own, before the child has said a
    // word, and it was the download's.
    const phases: string[] = [];
    for (;;) {
      const status = (await (await app.request('/api/puzzles/build')).json()) as { running: boolean; phase: string };
      if (!status.running) break;
      phases.push(status.phase);
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(phases[0]).toBe('building');
    expect(phases).not.toContain('downloading');
  }, 60_000);

  it('has the builder say it is building as it starts, and count every 10,000 rows', async () => {
    writeFileSync(dump, dumpOf(Array.from({ length: 25_000 }, (_, i) => ({ id: `a${i}`, rating: 1000 + (i % 1000) }))));
    // The builder alone, as the server spawns it, so every line is seen
    // rather than the last one a poll happens to catch.
    const events = await new Promise<{ phase: string; rows?: number; puzzles?: number }[]>((done, fail) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/build-puzzles.ts', '--progress-json'], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.on('error', fail);
      child.on('close', () =>
        done(
          out
            .split('\n')
            .filter((line) => line.startsWith('{'))
            .map((line) => JSON.parse(line) as { phase: string; rows?: number; puzzles?: number }),
        ),
      );
    });
    expect(events[0]).toEqual({ phase: 'building', rows: 0 });
    expect(events.filter((e) => e.phase === 'building').map((e) => e.rows)).toEqual([0, 10_000, 20_000]);
    expect(events.at(-1)).toMatchObject({ phase: 'done', puzzles: 25_000 });
  }, 60_000);

  it('draws from the new file straight after the swap, never from the old counts', async () => {
    // 300 puzzles at one rating: past SMALL_POOL, so a draw resolves its
    // offset through the per-rating counts, which are cached per file.
    writeFileSync(dump, dumpOf(Array.from({ length: 300 }, (_, i) => ({ id: `a${i}`, rating: 1500 }))));
    expect((await build()).error ?? null).toBeNull();
    const first = await draw('');
    expect(first.id).toMatch(/^a/);
    await app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: first.id, win: false }),
    });

    // The newer set keeps one puzzle at the rating the old counts said
    // held 300, so an offset from those counts lands past its end.
    writeFileSync(
      dump,
      dumpOf([
        { id: 'b0', rating: 1500 },
        ...Array.from({ length: 299 }, (_, i) => ({ id: `b${i + 1}`, rating: 1600 })),
      ]),
    );
    expect((await build()).error ?? null).toBeNull();
    // What Settings shows of it: how many, and when they were built.
    const meta = (await (await app.request('/api/puzzles/meta')).json()) as { puzzles: number; builtAt: string | null };
    expect(meta.puzzles).toBe(300);
    expect(Date.parse(meta.builtAt ?? '')).toBeGreaterThan(Date.now() - 60_000);

    let last = first.id!;
    for (let i = 0; i < 20; i++) {
      const next = await draw(last);
      expect(next.status).toBe(200);
      expect(next.id).toMatch(/^b/);
      last = next.id!;
    }
    // Attempts are the vault's, keyed by id, and outlive the file.
    const history = (await (await app.request('/api/puzzles/history')).json()) as { attempts: { id: string }[] };
    expect(history.attempts.map((a) => a.id)).toContain(first.id);
  }, 60_000);

  it('keeps serving the old database when a rebuild fails, and leaves nothing of the new one', async () => {
    writeFileSync(dump, dumpOf(Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, rating: 1500 }))));
    expect((await build()).error ?? null).toBeNull();
    expect((await draw('')).id).toMatch(/^a/);

    // A dump the builder refuses after it has created its temp database:
    // the header is read from the stream, by which time the file exists.
    writeFileSync(dump, zstdCompressSync('not,a,puzzle,dump\n'));
    const failed = await build();
    expect(failed.error).toMatch(/unexpected header/);
    expect(existsSync(join(data, 'puzzles.sqlite.building'))).toBe(false);

    const meta = (await (await app.request('/api/puzzles/meta')).json()) as { ready: boolean; puzzles: number };
    expect(meta).toMatchObject({ ready: true, puzzles: 10 });
    expect((await draw('a0')).status).toBe(200);
  }, 60_000);

  it('says why a build that threw half way failed, not which Node.js ran it', async () => {
    writeFileSync(dump, dumpOf(Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, rating: 1500 }))));
    expect((await build()).error ?? null).toBeNull();

    // One id twice: the second insert throws from inside the stream, past
    // the header, where a full disk's write throws too.
    writeFileSync(
      dump,
      dumpOf([...Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, rating: 1500 })), { id: 'b0', rating: 1500 }]),
    );
    const failed = await build();
    expect(failed.error).toBe('UNIQUE constraint failed: puzzles.id');
    expect(existsSync(join(data, 'puzzles.sqlite.building'))).toBe(false);
    expect((await draw('a0')).status).toBe(200);
  }, 60_000);

  it('reviews only the failed puzzles the new file still has', async () => {
    writeFileSync(dump, dumpOf(Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, rating: 1500 }))));
    expect((await build()).error ?? null).toBeNull();
    // Two failed long ago, so both are due, a0 the more overdue.
    mkdirSync(join(data, 'state'), { recursive: true });
    writeFileSync(
      join(data, 'state', 'history.jsonl'),
      `${[
        { id: 'a0', win: false, counted: true, puzzleRating: 1500, at: '2025-01-01T00:00:00.000Z' },
        { id: 'a1', win: false, counted: true, puzzleRating: 1500, at: '2025-01-01T00:01:00.000Z' },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n')}\n`,
    );
    const meta = async (): Promise<{ failed: number; due: number }> =>
      (await (await app.request('/api/puzzles/meta')).json()) as { failed: number; due: number };
    expect(await meta()).toMatchObject({ failed: 2, due: 2 });

    // The newer set has a1 and not a0.
    writeFileSync(dump, dumpOf(Array.from({ length: 10 }, (_, i) => ({ id: `a${i + 1}`, rating: 1500 }))));
    expect((await build()).error ?? null).toBeNull();
    expect(await meta()).toMatchObject({ failed: 1, due: 1 });
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/api/puzzles/next?mode=failed');
      expect(res.status).toBe(200);
      expect(((await res.json()) as { puzzle: { id: string } }).puzzle.id).toBe('a1');
    }
    // The log is the vault's, and keeps the attempt the file cannot serve.
    const history = (await (await app.request('/api/puzzles/history')).json()) as { attempts: { id: string }[] };
    expect(history.attempts.map((a) => a.id)).toEqual(['a1', 'a0']);
  }, 60_000);
});

/**
 * The weakest theme is the one thing on the hub that names a judgement
 * about the solver, so the two rules that keep it honest are worth
 * pinning: enough attempts to mean anything, and worse than this vault's
 * own average rather than merely imperfect.
 */
describe('puzzles api (weakest theme)', () => {
  let dir: string;
  let app: Hono;
  let puzzles: ReturnType<typeof puzzlesApi>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'puzzles-weak-'));
    const dbPath = join(dir, 'puzzles.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE puzzles (
        id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL,
        rating INTEGER NOT NULL, rd INTEGER NOT NULL, popularity INTEGER NOT NULL,
        plays INTEGER NOT NULL, themes TEXT NOT NULL, game_url TEXT, opening_tags TEXT
      );
      CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('puzzles', '2');
      INSERT INTO puzzles VALUES
        ('aaa', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1500, 80, 90, 10, 'endgame short', NULL, NULL),
        ('bbb', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', 1520, 80, 90, 10, 'fork short', NULL, NULL);
      INSERT INTO themes VALUES
        ('endgame', 1500, 'aaa'), ('short', 1500, 'aaa'),
        ('fork', 1520, 'bbb'), ('short', 1520, 'bbb');
    `);
    db.close();
    puzzles = puzzlesApi(dbPath, join(dir, 'state'));
    app = new Hono().route('/api', puzzles);
  });

  afterEach(() => {
    puzzles.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  const log = (id: string, win: boolean, times: number): void => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    for (let i = 0; i < times; i++) {
      appendFileSync(
        join(dir, 'state', 'history.jsonl'),
        `${JSON.stringify({ id, win, at: '2026-01-01T00:00:00Z' })}
`,
      );
    }
  };

  const weak = async (): Promise<{ theme: string; attempts: number; wins: number } | null> =>
    (await (await app.request('/api/puzzles/meta')).json()).weakTheme;

  it('names the theme that loses most, against the vault-wide rate', async () => {
    // fork 1/6; endgame 6/6; short 7/12, which is exactly the overall rate
    // and therefore not a weakness.
    log('bbb', true, 1);
    log('bbb', false, 5);
    log('aaa', true, 6);
    expect(await weak()).toEqual({ theme: 'fork', attempts: 6, wins: 1 });
  });

  it('says nothing about a theme with too little behind it', async () => {
    // Four losses is a bad afternoon, not a weakness.
    log('bbb', false, 4);
    log('aaa', true, 6);
    expect(await weak()).toBeNull();
  });

  it('says nothing when nothing is worse than average', async () => {
    log('aaa', true, 6);
    log('bbb', true, 6);
    expect(await weak()).toBeNull();
  });

  it('ignores attempts that were not counted', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    for (let i = 0; i < 6; i++) {
      appendFileSync(
        join(dir, 'state', 'history.jsonl'),
        `${JSON.stringify({ id: 'bbb', win: false, counted: false })}
`,
      );
    }
    log('aaa', true, 6);
    expect(await weak()).toBeNull();
  });
});

describe('puzzles api (standing offer)', () => {
  let dir: string;
  let app: Hono;
  let puzzles: ReturnType<typeof puzzlesApi>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'puzzles-offer-'));
    const dbPath = join(dir, 'puzzles.sqlite');
    const db = new Database(dbPath);
    // Twelve puzzles in one window: a random draw that changed between
    // two asks would show up here about eleven times in twelve.
    const rows = Array.from({ length: 12 }, (_, i) =>
      `('p${i}', '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', ${1500 + i}, 80, 90, 10, 'fork', NULL, NULL)`,
    ).join(',\n');
    db.exec(`
      CREATE TABLE puzzles (
        id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL,
        rating INTEGER NOT NULL, rd INTEGER NOT NULL, popularity INTEGER NOT NULL,
        plays INTEGER NOT NULL, themes TEXT NOT NULL, game_url TEXT, opening_tags TEXT
      );
      CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('puzzles', '12');
      INSERT INTO puzzles VALUES ${rows};
    `);
    db.close();
    puzzles = puzzlesApi(dbPath, join(dir, 'state'));
    app = new Hono().route('/api', puzzles);
  });

  afterEach(() => {
    puzzles.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  const next = async (query = ''): Promise<string> => {
    const res = await app.request(`/api/puzzles/next${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { puzzle: { id: string } }).puzzle.id;
  };
  const attempt = (id: string, win: boolean, counted?: boolean): Promise<Response> | Response =>
    app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(counted === undefined ? { id, win } : { id, win, counted }),
    });

  it('answers the same question with the same puzzle until it is attempted', async () => {
    // The hub draws on every visit and shows the result on a board; the
    // board must not change between two visits with nothing solved.
    const first = await next();
    for (let i = 0; i < 6; i++) expect(await next()).toBe(first);
    await attempt(first, true);
    const second = await next();
    expect(second).not.toBe(first);
    expect(await next()).toBe(second);
  });

  it('keeps one offer per question, so the theme trainer does not redraw the hub', async () => {
    const hub = await next();
    const easy = await next('?max=1505');
    const adaptive = await next('?adaptive=1');
    expect(await next('?max=1505')).toBe(easy);
    expect(await next('?adaptive=1')).toBe(adaptive);
    expect(await next()).toBe(hub);
  });

  it('asks past a skipped puzzle and then stands on the new one', async () => {
    const first = await next();
    const after = await next(`?skip=${first}`);
    expect(after).not.toBe(first);
    expect(await next()).toBe(after);
    // The skipped puzzle is not attempted, so a later draw may still
    // reach it; it just is not the standing offer any more.
    expect(await next(`?skip=${after}`)).not.toBe(after);
  });

  it('is answered by an attempt made after the offer, not by one before it', async () => {
    // Every puzzle attempted: the pool falls back to repeats, and a
    // repeat offered now is answered by the NEXT attempt, not the old one.
    for (let i = 0; i < 12; i++) await attempt(`p${i}`, true);
    const offered = await next();
    expect(await next()).toBe(offered);
    await attempt(offered, false);
    // Answered; the draw is free again (and may land on the same id by
    // chance among twelve, so only the standing is asserted).
    const state = JSON.parse(readFileSync(join(dir, 'state', 'state.json'), 'utf-8')) as {
      offered: Record<string, { id: string; at: string; seen: number }>;
    };
    const again = await next();
    const after = JSON.parse(readFileSync(join(dir, 'state', 'state.json'), 'utf-8')) as {
      offered: Record<string, { id: string; at: string; seen: number }>;
    };
    const key = Object.keys(state.offered)[0]!;
    expect(after.offered[key]!.id).toBe(again);
    // Thirteen attempts logged by now, against twelve at the first offer.
    expect(after.offered[key]!.seen).toBe(state.offered[key]!.seen + 1);
  });

  it('tells an attempt before the offer from one after it inside one millisecond', async () => {
    // A fast machine logs the twelve attempts and makes the offer in the
    // same millisecond, and a timestamp cannot order them: the old attempt
    // read as the answer and the offer was redrawn (seen once in CI as
    // "expected 'p4' to be 'p11'"). The clock is held still so every run
    // is that run.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T00:00:00.000Z') });
    try {
      for (let i = 0; i < 12; i++) await attempt(`p${i}`, true);
      const offered = await next();
      for (let i = 0; i < 6; i++) expect(await next()).toBe(offered);
      // And the attempt that follows still answers it, same millisecond or not.
      await attempt(offered, false);
      const again = await next();
      for (let i = 0; i < 6; i++) expect(await next()).toBe(again);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the review offer while it is still in the queue', async () => {
    // Two failed puzzles: the fallback pool is random between them.
    await attempt('p0', false);
    await attempt('p1', false);
    const first = await next('?mode=failed');
    for (let i = 0; i < 6; i++) expect(await next('?mode=failed')).toBe(first);
    // Solving it in review retires it from the pool: the other one is left.
    await attempt(first, true, false);
    const other = first === 'p0' ? 'p1' : 'p0';
    expect(await next('?mode=failed')).toBe(other);
  });

  it('survives a state file written before offers existed', async () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(join(dir, 'state', 'state.json'), JSON.stringify({ attempts: 3, wins: 2, streak: 1, offered: 'junk' }));
    const first = await next();
    expect(await next()).toBe(first);
    // The counters were kept; only the unreadable offers were dropped.
    const state = JSON.parse(readFileSync(join(dir, 'state', 'state.json'), 'utf-8')) as { attempts: number };
    expect(state.attempts).toBe(3);
  });
});
