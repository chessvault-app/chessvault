import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refGamesApi } from './refgames.ts';
import { tune } from '../scripts/lib/db-tuning.ts';

describe('reference games api', () => {
  let dir: string;
  let app: Hono;
  let refgames: ReturnType<typeof refGamesApi>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'refgames-api-'));
    const dbPath = join(dir, 'refgames.sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        white TEXT NOT NULL COLLATE NOCASE, black TEXT NOT NULL COLLATE NOCASE,
        white_elo INTEGER NOT NULL, black_elo INTEGER NOT NULL,
        result TEXT NOT NULL, date TEXT, event TEXT, eco TEXT, opening TEXT,
        moves TEXT NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('games', '3'), ('sources', 'test.pgn');
    `);
    const insert = db.prepare(
      'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('Carlsen', 'Nepo', 2850, 2790, '1-0', '2021.12.03', 'WCh', 'C88', 'Ruy Lopez', 'e4 e5 Nf3');
    insert.run('Nepo', 'Carlsen', 2790, 2850, '1/2-1/2', '2021.12.04', 'WCh', 'B90', 'Sicilian', 'e4 c5 Nf3');
    insert.run('Ding', 'Firouzja', 2800, 2780, '0-1', '2022.01.01', 'Tata', 'D02', 'London System', 'd4 d5 Bf4');
    // The API expects the tuned schema; build it the same way a real
    // database gets it, so a drift in db-tuning.ts fails here.
    tune(db);
    db.close();
    refgames = refGamesApi(dbPath);
    app = new Hono().route('/api', refgames);
  });

  afterAll(() => {
    refgames.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  const search = async (q: string, offset = 0): Promise<{ total: number | null; rows: { id: number; white: string }[] }> =>
    (await (await app.request(`/api/refgames/search?q=${encodeURIComponent(q)}&offset=${offset}`)).json());

  it('reports readiness from meta', async () => {
    const body = await (await app.request('/api/refgames')).json();
    expect(body).toMatchObject({ ready: true, games: 3, sources: 'test.pgn' });
  });

  it('searches players, opening names and ECO prefixes', async () => {
    expect((await search('carlsen')).rows).toHaveLength(2);
    expect((await search('london')).rows.map((r) => r.white)).toEqual(['Ding']);
    expect((await search('B9')).rows.map((r) => r.white)).toEqual(['Nepo']);
    expect((await search('nobody')).rows).toEqual([]);
  });

  it('counts only where counting is cheap', async () => {
    // Whole table: the build already tallied it, no scan needed.
    expect((await search('')).total).toBe(3);
    expect((await search('', 50)).total).toBe(3);
    // A real query scans, so only the first page pays for it — later pages
    // send null and the client keeps the total it was given.
    expect((await search('carlsen')).total).toBe(2);
    expect((await search('carlsen', 50)).total).toBeNull();
  });

  it('finds a game by its players', async () => {
    const hit = await (await app.request('/api/refgames/find?white=Carlsen&black=Nepo')).json();
    expect(hit.id).toBe(1);

    // Player names are matched case-insensitively, like the column collates.
    expect((await (await app.request('/api/refgames/find?white=carlsen&black=nepo')).json()).id).toBe(1);

    const filtered = await app.request('/api/refgames/find?white=Carlsen&black=Nepo&result=0-1');
    expect(filtered.status).toBe(404);

    expect((await app.request('/api/refgames/find?white=Carlsen')).status).toBe(400);
  });

  it('renders a game as PGN', async () => {
    const { pgn } = await (await app.request('/api/refgames/3/pgn')).json();
    expect(pgn).toContain('[White "Ding"]');
    expect(pgn).toContain('[ECO "D02"]');
    expect(pgn.trimEnd().endsWith('d4 d5 Bf4 0-1')).toBe(true);

    expect((await app.request('/api/refgames/99/pgn')).status).toBe(404);
  });
});
