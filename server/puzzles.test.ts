import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { puzzlesApi, sweepUnfinishedPuzzleBuild } from './puzzles.ts';

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

  const drawMany = async (query: string, n = 60): Promise<Set<string>> => {
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const res = await app.request(`/api/puzzles/next${query}`);
      expect(res.status).toBe(200);
      seen.add((await res.json()).puzzle.id);
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

  it('is a no-op with nothing to sweep', () => {
    sweepUnfinishedPuzzleBuild(dbPath);
    expect(existsSync(dbPath)).toBe(false);
  });
});
