import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { puzzlesApi } from './puzzles.ts';

describe('puzzles api', () => {
  let dir: string;
  let app: Hono;

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
    app = new Hono().route('/api', puzzlesApi(dbPath, join(dir, 'state')));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
