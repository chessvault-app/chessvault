import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  migrateLegacyRefgames,
  refGamesApi,
  seedBundledRefgames,
  sweepUnfinishedBuilds,
} from './refgames.ts';
import { indexPositions } from './refgamesIndex.ts';
import { tune } from '../scripts/lib/db-tuning.ts';

/**
 * The big dumps often carry no [Opening] header, so a built database
 * lists bare ECO codes — the name is derived from the moves at query
 * time, against the vendored opening set, on databases already built.
 */
describe('opening names derived from moves', () => {
  let dir: string;
  let refgames: ReturnType<typeof refGamesApi>;
  let app: Hono;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'refgames-derive-'));
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
      INSERT INTO meta VALUES ('games', '1'), ('sources', 'bare.pgn');
    `);
    db.prepare(
      'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('Bare', 'Headers', 2600, 2600, '1-0', '2026.02.02', null, null, null, 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6');
    tune(db);
    db.close();
    refgames = refGamesApi(dbPath);
    app = new Hono().route('/api', refgames);
  });

  afterAll(() => {
    refgames.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('names a game whose source PGN never did', async () => {
    const { rows } = await (
      await app.request('/api/refgames/search?q=Bare&offset=0')
    ).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].opening).toContain('Najdorf');
    expect(rows[0].eco).toBe('B90');
    expect(rows[0].moves).toBeUndefined(); // rides along server-side only
  });
});

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

describe('seedBundledRefgames', () => {
  let assets: string;
  let data: string;

  beforeEach(() => {
    assets = mkdtempSync(join(tmpdir(), 'refgames-assets-'));
    data = mkdtempSync(join(tmpdir(), 'refgames-data-'));
  });

  afterEach(() => {
    rmSync(assets, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  });

  const target = (name: string): string => join(data, 'refgames', `${name}.sqlite`);
  const marker = (): string => join(data, '.seeded-refgames');

  it('copies the bundled file in under its asset-derived name', () => {
    writeFileSync(join(assets, 'refgames-elite-2025-11.sqlite'), 'bundled-games');
    seedBundledRefgames(data, assets);
    expect(readFileSync(target('elite-2025-11'), 'utf-8')).toBe('bundled-games');
    expect(existsSync(marker())).toBe(true);
  });

  it('never overwrites a database already carrying the name', () => {
    writeFileSync(join(assets, 'refgames-elite.sqlite'), 'bundled-games');
    mkdirSync(join(data, 'refgames'), { recursive: true });
    writeFileSync(target('elite'), 'their-own-build');
    seedBundledRefgames(data, assets);
    expect(readFileSync(target('elite'), 'utf-8')).toBe('their-own-build');
    expect(existsSync(marker())).toBe(true);
  });

  it('does not bring back a database that was deleted after seeding', () => {
    writeFileSync(join(assets, 'refgames-elite.sqlite'), 'bundled-games');
    seedBundledRefgames(data, assets);
    rmSync(target('elite'));
    seedBundledRefgames(data, assets);
    expect(existsSync(target('elite'))).toBe(false);
  });

  it('ignores an unprefixed database sitting in the same directory', () => {
    // Only the refgames- prefix marks an asset as ours to seed.
    writeFileSync(join(assets, 'lichess-elite-2025-11.sqlite'), 'not-ours');
    seedBundledRefgames(data, assets);
    expect(existsSync(target('lichess-elite-2025-11'))).toBe(false);
    // And no marker: an install that gains the asset later still seeds.
    expect(existsSync(marker())).toBe(false);
  });

  it('is a no-op without an assets directory, leaving no marker', () => {
    seedBundledRefgames(data, join(assets, 'does-not-exist'));
    expect(existsSync(join(data, 'refgames'))).toBe(false);
    expect(existsSync(marker())).toBe(false);
  });
});

describe('migrateLegacyRefgames', () => {
  let data: string;

  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'refgames-migrate-'));
  });

  afterEach(() => {
    rmSync(data, { recursive: true, force: true });
  });

  const legacyDb = (sources: string): void => {
    const db = new Database(join(data, 'refgames.sqlite'));
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO meta VALUES (?, ?)').run('sources', sources);
    db.close();
  };

  it('renames the single database in, named after its one source', () => {
    legacyDb('elite-2025-11.pgn');
    migrateLegacyRefgames(data);
    expect(existsSync(join(data, 'refgames.sqlite'))).toBe(false);
    expect(existsSync(join(data, 'refgames', 'elite-2025-11.sqlite'))).toBe(true);
  });

  it('falls back to a plain name when the meta names several sources', () => {
    legacyDb('a.pgn, b.pgn');
    migrateLegacyRefgames(data);
    // "a.pgn," fails the name pattern (trailing comma), so the fallback.
    expect(existsSync(join(data, 'refgames', 'refgames.sqlite'))).toBe(true);
  });

  it('is a no-op without a legacy file', () => {
    migrateLegacyRefgames(data);
    expect(existsSync(join(data, 'refgames'))).toBe(false);
  });
});

/**
 * A build the app was quit in the middle of leaves a `.building` file
 * nothing lists and nothing can delete. Startup is the only moment when
 * every one of them is known to be dead.
 */
describe('sweepUnfinishedBuilds', () => {
  let data: string;
  let dir: string;

  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'refgames-sweep-'));
    dir = join(data, 'refgames');
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(data, { recursive: true, force: true });
  });

  /** A build's temp file, at the point the indexer would have been killed:
      `indexed` false is a child that never reached the position pass. */
  const building = (name: string, white: string, indexed: boolean): string => {
    const path = join(dir, `${name}.sqlite.building`);
    const db = new Database(path);
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        white TEXT NOT NULL COLLATE NOCASE, black TEXT NOT NULL COLLATE NOCASE,
        white_elo INTEGER NOT NULL, black_elo INTEGER NOT NULL,
        result TEXT NOT NULL, date TEXT, event TEXT, eco TEXT, opening TEXT,
        moves TEXT NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('games', '1'), ('built_at', '2026-08-16T00:00:00.000Z');
    `);
    db.prepare(
      'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(white, 'Opponent', 2600, 2600, '1-0', '2026.08.16', null, null, null, 'e4 e5 Nf3');
    db.close();
    if (indexed) indexPositions(path);
    return path;
  };

  const whiteIn = (path: string): string => {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    const row = db.prepare('SELECT white FROM games LIMIT 1').get() as { white: string };
    db.close();
    return row.white;
  };

  it('renames in a build that finished and only missed its rename', () => {
    const path = building('elite', 'Finished', true);
    sweepUnfinishedBuilds(data);
    expect(existsSync(path)).toBe(false);
    expect(whiteIn(join(dir, 'elite.sqlite'))).toBe('Finished');
  });

  it('lets a finished rebuild replace the database it was rebuilding', () => {
    building('elite', 'Old', true);
    sweepUnfinishedBuilds(data);
    building('elite', 'New', true);
    sweepUnfinishedBuilds(data);
    expect(whiteIn(join(dir, 'elite.sqlite'))).toBe('New');
  });

  it('discards one the indexer never got to the end of', () => {
    const path = building('elite', 'Half', false);
    sweepUnfinishedBuilds(data);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(dir, 'elite.sqlite'))).toBe(false);
  });

  it('discards rubble with its journal sidecars', () => {
    const path = join(dir, 'elite.sqlite.building');
    writeFileSync(path, 'not a database at all');
    writeFileSync(`${path}-wal`, '');
    writeFileSync(`${path}-shm`, '');
    sweepUnfinishedBuilds(data);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });

  it('leaves the databases themselves alone', () => {
    const kept = join(dir, 'elite.sqlite');
    writeFileSync(kept, 'a database this test never reads');
    building('other', 'Half', false);
    sweepUnfinishedBuilds(data);
    expect(readFileSync(kept, 'utf8')).toBe('a database this test never reads');
  });

  it('is a no-op without a refgames directory', () => {
    rmSync(dir, { recursive: true, force: true });
    sweepUnfinishedBuilds(data);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('directory mount', () => {
  let dir: string;
  let app: Hono;
  let api: ReturnType<typeof refGamesApi>;

  const makeDb = (name: string, white: string): void => {
    const db = new Database(join(dir, `${name}.sqlite`));
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        white TEXT NOT NULL COLLATE NOCASE, black TEXT NOT NULL COLLATE NOCASE,
        white_elo INTEGER NOT NULL, black_elo INTEGER NOT NULL,
        result TEXT NOT NULL, date TEXT, event TEXT, eco TEXT, opening TEXT,
        moves TEXT NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('games', '1'), ('sources', '${name}.pgn');
    `);
    db.prepare(
      'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(white, 'Opponent', 2500, 2400, '1-0', '2026.01.01', 'Test', 'B90', 'Sicilian', 'e4 c5');
    tune(db);
    db.close();
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'refgames-dir-'));
    makeDb('alpha', 'AlphaPlayer');
    makeDb('beta', 'BetaPlayer');
    api = refGamesApi({ dir });
    app = new Hono().route('/api', api);
  });

  afterAll(() => {
    api.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists every database with its own count', async () => {
    const body = await (await app.request('/api/refgames')).json();
    expect(body.ready).toBe(true);
    expect(body.databases.map((d: { name: string }) => d.name)).toEqual(['alpha', 'beta']);
    expect(body.databases[0].games).toBe(1);
  });

  it('searches the database the query names, defaulting to the first', async () => {
    const first = await (await app.request('/api/refgames/search?q=')).json();
    expect(first.rows[0].white).toBe('AlphaPlayer');
    const second = await (await app.request('/api/refgames/search?q=&db=beta')).json();
    expect(second.rows[0].white).toBe('BetaPlayer');
  });

  it('finds a game in whichever database holds it, and says which', async () => {
    const found = await (
      await app.request('/api/refgames/find?white=BetaPlayer&black=Opponent')
    ).json();
    expect(found).toEqual({ id: 1, db: 'beta' });
    const pgn = await (await app.request(`/api/refgames/${found.id}/pgn?db=${found.db}`)).json();
    expect(pgn.pgn).toContain('[White "BetaPlayer"]');
  });

  it('offers no build or delete off the real data directory', async () => {
    expect((await app.request('/api/refgames/build', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/refgames/alpha', { method: 'DELETE' })).status).toBe(404);
  });
});

/**
 * The unified index: positions inside the games database, filterable —
 * the property that separates it from an opening book.
 */
describe('position index and explore', () => {
  let dir: string;
  let dbPath: string;
  let app: Hono;
  let refgames: ReturnType<typeof refGamesApi>;

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

  const explore = async (query: string): Promise<{
    indexed: boolean;
    games: number;
    moves: { uci: string; san: string; w: number; d: number; b: number; total: number }[];
    topGames: { white: string; black: string }[];
  }> => (await (await app.request(`/api/refgames/explore?${query}`)).json());

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'refgames-explore-'));
    dbPath = join(dir, 'games.sqlite');
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
    tune(db);
    db.close();
    refgames = refGamesApi(dbPath);
    app = new Hono().route('/api', refgames);
  });

  afterAll(() => {
    refgames.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('says so, without erroring, while the index is missing', async () => {
    const body = await explore(`fen=${encodeURIComponent(START)}`);
    expect(body).toMatchObject({ indexed: false, games: 0, moves: [], topGames: [] });
  });

  it('indexes in place and answers from the start position', async () => {
    const { games, plies } = indexPositions(dbPath);
    expect(games).toBe(3);
    expect(plies).toBe(9); // three games, three plies each
    refgames.closeDb(); // fresh handle sees the new table

    const body = await explore(`fen=${encodeURIComponent(START)}`);
    expect(body.indexed).toBe(true);
    expect(body.games).toBe(3);
    expect(body.moves.map((m) => [m.san, m.total, m.w, m.d, m.b])).toEqual([
      ['e4', 2, 1, 1, 0],
      ['d4', 1, 0, 0, 1],
    ]);
    // Strongest pair first; the two WCh games tie on combined rating and
    // the later id wins the tiebreak.
    expect(body.topGames[0]).toMatchObject({ white: 'Nepo', black: 'Carlsen' });
    expect(body.topGames[2]).toMatchObject({ white: 'Ding', black: 'Firouzja' });
  });

  it('answers many positions in one request, the way the map asks', async () => {
    const res = await app.request('/api/refgames/explore-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fens: [START, AFTER_E4, 'not a fen'] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      indexed: boolean;
      positions: { fen: string; moves: { san: string; total: number }[] }[];
    };
    expect(body.indexed).toBe(true);
    // One entry per position asked for, in the order asked, so the
    // caller can pair them up without matching on anything.
    expect(body.positions.map((p) => p.fen)).toEqual([START, AFTER_E4, 'not a fen']);
    // And each is the same answer the single-position route gives.
    const single = await explore(`fen=${encodeURIComponent(START)}`);
    expect(body.positions[0]!.moves.map((m) => [m.san, m.total])).toEqual(
      single.moves.map((m) => [m.san, m.total]),
    );
    expect(body.positions[1]!.moves.map((m) => m.san).sort()).toEqual(['c5', 'e5']);
    // A position it cannot read is an empty answer, not a failed batch:
    // one bad fen must not cost the other sixty-three.
    expect(body.positions[2]!.moves).toEqual([]);
  });

  it('precomputes the unfiltered sums, and answers the same without them', async () => {
    // indexPositions built move_counts: one row per (position, move), so
    // the two start-position e4 games collapse into one of the 8 rows.
    const before = await explore(`fen=${encodeURIComponent(START)}`);
    const db = new Database(dbPath);
    expect((db.prepare('SELECT COUNT(*) AS n FROM move_counts').get() as { n: number }).n).toBe(8);
    // An older file has no sums until its next tune — the live aggregation
    // must answer identically in the meantime.
    db.exec('DROP INDEX idx_move_counts_pos; DROP TABLE move_counts;');
    db.close();
    refgames.closeDb();
    const without = await explore(`fen=${encodeURIComponent(START)}`);
    expect(without).toEqual(before);
    // And the deploy-time tune is what puts them back.
    const restore = new Database(dbPath);
    expect(tune(restore)).toContain('move_counts');
    restore.close();
    refgames.closeDb();
    const restored = await explore(`fen=${encodeURIComponent(START)}`);
    expect(restored).toEqual(before);
  });

  it('refuses a batch big enough to be a denial of service', async () => {
    const res = await app.request('/api/refgames/explore-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fens: Array.from({ length: 257 }, () => START) }),
    });
    expect(res.status).toBe(400);
  });

  it('follows the line', async () => {
    const body = await explore(`fen=${encodeURIComponent(AFTER_E4)}`);
    expect(body.moves.map((m) => m.san).sort()).toEqual(['c5', 'e5']);
  });

  it('answers filtered — the question a book cannot', async () => {
    const strong = await explore(`fen=${encodeURIComponent(START)}&minElo=2790`);
    expect(strong.games).toBe(2); // Ding–Firouzja's 2780 drops out
    expect(strong.moves).toHaveLength(1);
    expect(strong.moves[0]).toMatchObject({ san: 'e4', total: 2 });

    const carlsenWins = await explore(
      `fen=${encodeURIComponent(START)}&player=Carlsen&outcome=won`,
    );
    expect(carlsenWins.games).toBe(1);
    expect(carlsenWins.moves[0]).toMatchObject({ san: 'e4', w: 1 });

    const decisive = await explore(`fen=${encodeURIComponent(START)}&result=0-1`);
    expect(decisive.moves.map((m) => m.san)).toEqual(['d4']);
  });

  it('composes the structured search: who, side, outcome, event, dates', async () => {
    const rows = async (query: string): Promise<{ white: string; black: string }[]> =>
      (await (await app.request(`/api/refgames/search?${query}`)).json()).rows;

    expect(await rows('player=carlsen&side=black')).toMatchObject([{ white: 'Nepo' }]);
    expect(await rows('player=carlsen&outcome=won')).toMatchObject([{ white: 'Carlsen' }]);
    expect(await rows('player=carlsen&outcome=drawn')).toMatchObject([{ white: 'Nepo' }]);
    expect(await rows('event=Tata')).toMatchObject([{ white: 'Ding' }]);
    expect((await rows('from=2021-12-04&to=2022-01-01')).map((r) => r.white).sort()).toEqual([
      'Ding',
      'Nepo',
    ]);
    expect(await rows('opening=london')).toMatchObject([{ white: 'Ding' }]);
    // Every slot at once, the sentence from the ask: who, opening, side,
    // dates, event, outcome.
    expect(
      await rows('player=nepo&side=white&opening=sicilian&from=2021-12-01&to=2021-12-31&event=WCh&outcome=drawn'),
    ).toMatchObject([{ white: 'Nepo', black: 'Carlsen' }]);
  });
});
