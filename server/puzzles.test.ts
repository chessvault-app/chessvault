import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eloDelta, puzzlesApi } from './puzzles.ts';

describe('elo', () => {
  it('is zero-sum-ish around equal ratings', () => {
    expect(eloDelta(1500, 1500, true)).toBe(16);
    expect(eloDelta(1500, 1500, false)).toBe(-16);
  });

  it('pays little for beating weak puzzles, much for strong ones', () => {
    expect(eloDelta(1500, 1100, true)).toBeLessThan(5);
    expect(eloDelta(1500, 1900, true)).toBeGreaterThan(27);
    expect(eloDelta(1500, 1100, false)).toBeLessThan(-27);
  });
});

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

  it('reports meta with default user state', async () => {
    const res = await app.request('/api/puzzles/meta');
    const body = await res.json();
    expect(body.ready).toBe(true);
    expect(body.puzzles).toBe(3);
    expect(body.user.rating).toBe(1500);
    expect(body.themes.find((t: { theme: string }) => t.theme === 'fork').count).toBe(1);
  });

  it('serves a puzzle near the user rating', async () => {
    const res = await app.request('/api/puzzles/next');
    const { puzzle } = await res.json();
    // 1500-centred window catches aaa/bbb but not ccc at 2400.
    expect(['aaa', 'bbb']).toContain(puzzle.id);
  });

  it('filters by theme', async () => {
    const res = await app.request('/api/puzzles/next?theme=fork');
    const { puzzle } = await res.json();
    expect(puzzle.id).toBe('bbb');
  });

  it('404s a theme with no puzzles', async () => {
    const res = await app.request('/api/puzzles/next?theme=nosuchtheme');
    expect(res.status).toBe(404);
  });

  it('applies an attempt to the rating, streak and history', async () => {
    const win = await app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'aaa', win: true }),
    });
    const winBody = await win.json();
    expect(winBody.delta).toBe(16);
    expect(winBody.user.rating).toBe(1516);
    expect(winBody.user.streak).toBe(1);

    // Losing to the 2400 puzzle from ~1516 would round to 0 (expected score
    // ≈ 0.006) — use the near-rated one for a meaningful loss.
    const loss = await app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'bbb', win: false }),
    });
    const lossBody = await loss.json();
    expect(lossBody.delta).toBeLessThan(0);
    expect(lossBody.user.streak).toBe(0);
    expect(lossBody.user.attempts).toBe(2);

    const history = await app.request('/api/puzzles/history');
    const { attempts } = await history.json();
    expect(attempts).toHaveLength(2);
    expect(attempts[0].id).toBe('bbb'); // newest first
  });

  it('tracks failed puzzles and serves them for unrated review', async () => {
    // From the previous test: aaa was won, bbb was lost → pool is [bbb].
    const meta = await (await app.request('/api/puzzles/meta')).json();
    expect(meta.failed).toBe(1);

    const next = await app.request('/api/puzzles/next?mode=failed');
    expect(next.status).toBe(200);
    const { puzzle } = await next.json();
    expect(puzzle.id).toBe('bbb');

    // Practice solve: unrated, so the rating and counters stay put …
    const before = (await (await app.request('/api/puzzles/meta')).json()).user;
    const attempt = await app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'bbb', win: true, rated: false }),
    });
    const body = await attempt.json();
    expect(body.delta).toBe(0);
    expect(body.user).toEqual(before);

    // … but the clean solve empties the failed pool.
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

    const unknown = await app.request('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'zzz', win: true }),
    });
    expect(unknown.status).toBe(404);
  });
});
