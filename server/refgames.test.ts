import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GAMES_WHERE_KEYS,
  gamesWhere,
  migrateLegacyRefgames,
  parseNativeCapabilities,
  refGamesApi,
  seedBundledRefgames,
  sweepUnfinishedBuilds,
  undeclaredFilters,
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

  const search = async (
    q: string,
    cursor: number | null = null,
  ): Promise<{ total: number | null; nextCursor: number | null; rows: { id: number; white: string }[] }> =>
    (await (
      await app.request(
        `/api/refgames/search?q=${encodeURIComponent(q)}${cursor !== null ? `&cursor=${cursor}` : ''}`,
      )
    ).json());

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
    // A real query scans, so only the first page pays for it — a page
    // asked for with a cursor sends null and the client keeps the total
    // it was given.
    expect((await search('carlsen')).total).toBe(2);
    expect((await search('carlsen', 1)).total).toBeNull();
  });

  it('pages by keyset cursor, newest id first', async () => {
    // Three games, page size 50: one short page, so no next cursor.
    const first = await search('');
    expect(first.rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(first.nextCursor).toBeNull();
    // A cursor seeks strictly below the id it names.
    const after = await search('', 2);
    expect(after.rows.map((r) => r.id)).toEqual([1]);
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

  it('seeks the search through the derived lookup tables', async () => {
    // tune() derived players/openings into these files, so the q box and
    // the player filter run through hash-set INs — and must answer
    // exactly what the plain LIKEs answer, case-insensitivity included
    // (the IN takes the games column's NOCASE collation).
    const q = async (params: string): Promise<{ white: string }[]> =>
      (await (await app.request(`/api/refgames/search?${params}`)).json()).rows;
    expect((await q('q=alphaplay')).map((r) => r.white)).toEqual(['AlphaPlayer']);
    expect(await q('q=sicil')).toHaveLength(1);
    expect(await q('q=B9')).toHaveLength(1);
    expect(await q('q=nobody')).toEqual([]);
    expect(await q('q=&player=alphaplay&side=white')).toHaveLength(1);
    expect(await q('q=&player=alphaplay&side=black')).toEqual([]);
    expect(await q('q=&player=alphaplay&outcome=won')).toHaveLength(1);
  });

  it('deep-searches a database that predates the reachability columns', async () => {
    // These hand-made files never ran the index pass, so games carries
    // no final_wmen/ply_count — the scan must run unprefiltered rather
    // than erroring at prepare time (found live on a pre-upgrade file).
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const res = await app.request(
      `/api/refgames/deep-search?db=alpha&fen=${encodeURIComponent(START_FEN)}`,
    );
    expect(res.status).toBe(200);
    const frames = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(frames.at(-1)).toMatchObject({ type: 'done', matched: 1 });
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

  it('stores no sums for thin positions, and answers them live all the same', async () => {
    // Every position in this three-game fixture is reached by fewer than
    // MOVE_COUNT_MIN_GAMES games, so indexPositions stored nothing — the
    // table exists, empty, and the explorer answers through the live
    // fallback, identically by construction.
    const before = await explore(`fen=${encodeURIComponent(START)}`);
    expect(before.moves.length).toBeGreaterThan(0);
    const db = new Database(dbPath);
    expect((db.prepare('SELECT COUNT(*) AS n FROM move_counts').get() as { n: number }).n).toBe(0);
    // An older file has no sums table at all until its next tune — same
    // fallback, same answers.
    db.exec('DROP INDEX idx_move_counts_pos; DROP TABLE move_counts;');
    db.close();
    refgames.closeDb();
    const without = await explore(`fen=${encodeURIComponent(START)}`);
    expect(without).toEqual(before);
    // And the deploy-time tune is what puts the table back.
    const restore = new Database(dbPath);
    expect(tune(restore)).toContain('move_counts');
    restore.close();
    refgames.closeDb();
    const restored = await explore(`fen=${encodeURIComponent(START)}`);
    expect(restored).toEqual(before);
  });

  it('precomputes the sums where enough games pay for them', async () => {
    // Six games through the start position crosses MOVE_COUNT_MIN_GAMES:
    // the start rows are stored, deeper thin positions still are not,
    // and both kinds answer alike.
    const wideDir = mkdtempSync(join(tmpdir(), 'refgames-wide-'));
    const widePath = join(wideDir, 'games.sqlite');
    const db = new Database(widePath);
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        white TEXT NOT NULL COLLATE NOCASE, black TEXT NOT NULL COLLATE NOCASE,
        white_elo INTEGER NOT NULL, black_elo INTEGER NOT NULL,
        result TEXT NOT NULL, date TEXT, event TEXT, eco TEXT, opening TEXT,
        moves TEXT NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('games', '6'), ('sources', 'wide.pgn');
    `);
    const insert = db.prepare(
      'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    // Three e4 games at 2500-level, two at 1600-level: the level bands
    // below have something to disagree about.
    for (let i = 0; i < 3; i += 1) {
      insert.run(`W${i}`, `B${i}`, 2500, 2560, '1-0', '2026.01.01', 'T', 'C20', 'Open', 'e4 e5');
    }
    for (let i = 3; i < 5; i += 1) {
      insert.run(`W${i}`, `B${i}`, 1650, 1600, '1-0', '2026.01.01', 'T', 'C20', 'Open', 'e4 e5');
    }
    insert.run('W5', 'B5', 2500, 2500, '0-1', '2026.01.01', 'T', 'A40', 'Queen', 'd4 d5');
    db.close();
    indexPositions(widePath);

    const wide = refGamesApi(widePath);
    const wideApp = new Hono().route('/api', wide);
    try {
      const stored = new Database(widePath, { readonly: true });
      // The start position (6 games) and the one after e4 (5) are
      // stored; the position after d4 has one game and is not.
      const perPos = stored
        .prepare('SELECT pos, SUM(w + d + b) AS n FROM move_counts GROUP BY pos ORDER BY n DESC')
        .all() as { n: number }[];
      stored.close();
      expect(perPos.map((p) => p.n)).toEqual([6, 5]);

      const start = (await (
        await wideApp.request(`/api/refgames/explore?fen=${encodeURIComponent(START)}`)
      ).json()) as { games: number; moves: { san: string; total: number }[] };
      expect(start.games).toBe(6);
      expect(start.moves.map((m) => [m.san, m.total])).toEqual([
        ['e4', 5],
        ['d4', 1],
      ]);
      // A thin position (one game reaches it) answers through the fallback.
      const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
      const deep = (await (
        await wideApp.request(`/api/refgames/explore?fen=${encodeURIComponent(AFTER_D4)}`)
      ).json()) as { moves: { san: string; total: number }[] };
      expect(deep.moves.map((m) => [m.san, m.total])).toEqual([['d5', 1]]);

      // Level bands: the game's LOWER rating inside the band. Aligned
      // bands read the precomputed buckets; a band off the 200-point
      // edges takes the live join — same semantics either way.
      const band = async (q: string): Promise<{ moves: { san: string; total: number }[] }> =>
        (await (
          await wideApp.request(`/api/refgames/explore?fen=${encodeURIComponent(START)}&band=${q}`)
        ).json()) as { moves: { san: string; total: number }[] };
      expect((await band('1600-1999')).moves.map((m) => [m.san, m.total])).toEqual([['e4', 2]]);
      expect((await band('2400-')).moves.map((m) => [m.san, m.total])).toEqual([
        ['e4', 3],
        ['d4', 1],
      ]);
      // Off the bucket edges: 1700 excludes the 1600-floor games.
      expect((await band('1700-1999')).moves).toEqual([]);
    } finally {
      wide.closeDb();
      rmSync(wideDir, { recursive: true, force: true });
    }
  });

  it('deep-searches the whole database for a position, any depth', async () => {
    // The start position: every game passes through it at ply 0.
    const run = async (query: string): Promise<Record<string, unknown>[]> => {
      const res = await app.request(`/api/refgames/deep-search?${query}`);
      expect(res.status).toBe(200);
      return (await res.text())
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    };
    const all = await run(`fen=${encodeURIComponent(START)}`);
    const games = all.filter((f) => f.type === 'game');
    expect(games).toHaveLength(3);
    expect(games.every((g) => g.ply === 0)).toBe(true);
    const done = all.at(-1)!;
    expect(done).toMatchObject({ type: 'done', matched: 3, exhaustive: true });

    // A FINAL position matches too — the position after 1.e4 e5 is the
    // end of the Carlsen game's stored line... none here run that deep,
    // so take the position after 1.e4 (ply 1, black to move): two games.
    const afterE4 = await run(`fen=${encodeURIComponent(AFTER_E4)}`);
    expect(afterE4.filter((f) => f.type === 'game')).toHaveLength(2);

    // Composes with the game filters: only Carlsen's e4 game as White.
    const filtered = await run(`fen=${encodeURIComponent(AFTER_E4)}&player=carlsen&side=white`);
    const hits = filtered.filter((f) => f.type === 'game');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ white: 'Carlsen' });
  });

  it('abandons a deep search whose reader has gone', async () => {
    // A cancelled request must not scan the database for nobody: the
    // loop checks the abort signal per batch, so an aborted reader gets
    // no frames instead of a completed scan.
    const ac = new AbortController();
    ac.abort();
    const res = await app.request(
      `/api/refgames/deep-search?fen=${encodeURIComponent(START)}`,
      { signal: ac.signal },
    );
    expect((await res.text()).trim()).toBe('');
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

/**
 * The filter-capability negotiation: the native binary declares which
 * gamesWhere filters it supports, and deep search uses it only for
 * requests inside that declaration. These are the pure pieces; the
 * spawn wrapper around them is exercised against the real binary
 * (npm run build:native, then a filtered deep search with and without
 * CHESS_NATIVE=0 must answer identically).
 */
describe('native filter negotiation', () => {
  /** A value each filter accepts — with every key answered, the whole
      of gamesWhere runs, including the keys it only reads behind
      another (outcome behind player). Throwing on an unknown key IS the
      failure being tested for. The Rust twin (native/src/filters.rs)
      records its consulted set the same way. */
  const sample = (key: string): string => {
    const values: Record<string, string> = {
      result: '1-0',
      minElo: '2500',
      band: '1600-1999',
      player: 'Carlsen',
      side: 'white',
      outcome: 'won',
      opening: 'B90',
      event: 'Tata Steel',
      from: '2020-01-01',
      to: '2020-01-01',
    };
    const value = values[key];
    if (value === undefined) {
      throw new Error(`gamesWhere consults a key GAMES_WHERE_KEYS does not list: ${key}`);
    }
    return value;
  };

  it('GAMES_WHERE_KEYS is exactly what gamesWhere consults', () => {
    // Recorded from the getter itself, not asserted from memory: a key
    // gamesWhere reads but the list lacks would never be forwarded to
    // the binary NOR counted in negotiation — the native path would run
    // unfiltered where the JS path filters, which is the silent-drift
    // class this whole arrangement exists to prevent.
    const asked = new Set<string>();
    gamesWhere((key) => {
      asked.add(key);
      return sample(key);
    });
    expect([...asked].sort()).toEqual([...GAMES_WHERE_KEYS].sort());
  });

  it('parses a declaration and rejects everything else', () => {
    expect(parseNativeCapabilities('{"filters":["result","player"]}\n')).toEqual(
      new Set(['result', 'player']),
    );
    expect(parseNativeCapabilities('{"filters":[]}')).toEqual(new Set());
    expect(parseNativeCapabilities('')).toBeNull();
    expect(parseNativeCapabilities('not json')).toBeNull();
    expect(parseNativeCapabilities('{"filters":"result"}')).toBeNull();
    expect(parseNativeCapabilities('{"filters":[1,2]}')).toBeNull();
    expect(parseNativeCapabilities('{}')).toBeNull();
  });

  it('routes a request using an undeclared filter down the JS path', () => {
    const declared = new Set(GAMES_WHERE_KEYS.filter((k) => k !== 'opening'));
    const query = (q: Record<string, string>) => (k: string) => q[k];
    // Nothing asked, nothing undeclared — the unfiltered scan is native.
    expect(undeclaredFilters(declared, query({}))).toEqual([]);
    // Declared filters ride the binary.
    expect(undeclaredFilters(declared, query({ player: 'Carlsen', side: 'white' }))).toEqual([]);
    // One undeclared filter poisons the whole request, even beside
    // declared ones: half-filtered fast is wrong, filtered slow is not.
    expect(undeclaredFilters(declared, query({ player: 'Carlsen', opening: 'B90' }))).toEqual([
      'opening',
    ]);
    // Present-but-empty still counts: both sides may ignore it today,
    // but "present means asked" is the one rule that needs no smarts.
    expect(undeclaredFilters(declared, query({ opening: '' }))).toEqual(['opening']);
    // A key that is not a filter never counts, whatever the binary says.
    expect(undeclaredFilters(new Set(), query({ fen: 'x', db: 'y' }))).toEqual([]);
  });
});
