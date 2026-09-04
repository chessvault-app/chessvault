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
import { TOP_GAMES_MIN_GAMES, indexPositions } from './refgamesIndex.ts';
import {
  findCrossImpossible,
  matchesSearchTerms,
  parseSearchQuery,
} from '../shared/searchQuery.ts';
import { tune } from '../scripts/lib/db-tuning.ts';
import { openingKeysNamed } from './openings.ts';

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
    db.prepare(
      'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('Carlsen, Magnus', 'Headers', 2850, 2600, '1-0', '2026.02.03', null, 'B33', null, 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6');
    tune(db);
    db.close();
    indexPositions(dbPath);
    refgames = refGamesApi(dbPath);
    app = new Hono().route('/api', refgames);
  });

  afterAll(async () => {
    await refgames.closeDb();
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

  it('finds a nameless game by the catalogue name the box suggested', async () => {
    // The box offers the vendored catalogue's names; the text column
    // is NULL on this database, as on the big dumps. The name answers
    // through the position index instead — the games through the
    // catalogued positions that carry it — beside the player term.
    const search = async (q: string): Promise<{ white: string; opening: string }[]> =>
      (await (await app.request(`/api/refgames/search?q=${encodeURIComponent(q)}`)).json()).rows;
    const exact = await search('player:"Carlsen, Magnus" opening:"Sicilian Defense: Lasker-Pelikan Variation"');
    expect(exact.map((r) => r.white)).toEqual(['Carlsen, Magnus']);
    expect(exact[0]!.opening).toContain('Lasker-Pelikan');
    // A broader name is every line under it: both Sicilians.
    expect((await search('opening:sicilian')).map((r) => r.white).sort()).toEqual(['Bare', 'Carlsen, Magnus']);
    // The window's own field takes the same road.
    const field = await (
      await app.request(`/api/refgames/search?opening=${encodeURIComponent('Lasker-Pelikan')}`)
    ).json();
    expect(field.rows.map((r: { white: string }) => r.white)).toEqual(['Carlsen, Magnus']);
    // A name the catalogue lacks still finds nothing here, honestly.
    expect(await search('opening:xyzzy')).toEqual([]);
  });

  it('refuses a request carrying more box terms than a search can mean', async () => {
    // Each term is a clause, and a player term a LIKE subquery per seat;
    // the count was open, and a query string of them was a full-table
    // walk per term on the event loop. Sixteen is the ceiling.
    const many = Array.from({ length: 17 }, (_, i) => `opening:x${i}`).join(' ');
    const search = await app.request(`/api/refgames/search?q=${encodeURIComponent(many)}`);
    expect(search.status).toBe(400);
    const deep = await app.request(
      `/api/refgames/deep-search?q=${encodeURIComponent(many)}&fen=${encodeURIComponent(
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      )}`,
    );
    expect(deep.status).toBe(400);
    const terms = JSON.stringify(Array.from({ length: 17 }, () => ({ kind: 'eco', value: 'B9' })));
    const explore = await app.request(
      `/api/refgames/explore?fen=${encodeURIComponent(
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      )}&terms=${encodeURIComponent(terms)}`,
    );
    expect(explore.status).toBe(400);
    const batch = await app.request(`/api/refgames/explore-batch?terms=${encodeURIComponent(terms)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fens: ['rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'] }),
    });
    expect(batch.status).toBe(400);
    // Sixteen still answers.
    const sixteen = Array.from({ length: 16 }, (_, i) => `opening:x${i}`).join(' ');
    expect((await app.request(`/api/refgames/search?q=${encodeURIComponent(sixteen)}`)).status).toBe(200);
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

  afterAll(async () => {
    await refgames.closeDb();
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

  afterAll(async () => {
    await api.closeDb();
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

  afterAll(async () => {
    await refgames.closeDb();
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
    await refgames.closeDb(); // fresh handle sees the new table

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
    await refgames.closeDb();
    const without = await explore(`fen=${encodeURIComponent(START)}`);
    expect(without).toEqual(before);
    // And the deploy-time tune is what puts the table back.
    const restore = new Database(dbPath);
    expect(tune(restore)).toContain('move_counts');
    restore.close();
    await refgames.closeDb();
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
      await wide.closeDb();
      rmSync(wideDir, { recursive: true, force: true });
    }
  });

  it('ranks the strongest games once enough pass through a position', async () => {
    // TOP_GAMES_MIN_GAMES games through the start position, all 1.e4,
    // rated so that the strongest eight are known: the pass ranks the
    // start position (and the one after e4), and the route must answer
    // from that table exactly as the live join would have — the live
    // join is what cost 44 s on a gigabase, and this is the test that
    // the shortcut is not a different answer.
    const hotDir = mkdtempSync(join(tmpdir(), 'refgames-hot-'));
    const hotPath = join(hotDir, 'games.sqlite');
    const db = new Database(hotPath);
    db.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        white TEXT NOT NULL COLLATE NOCASE, black TEXT NOT NULL COLLATE NOCASE,
        white_elo INTEGER NOT NULL, black_elo INTEGER NOT NULL,
        result TEXT NOT NULL, date TEXT, event TEXT, eco TEXT, opening TEXT,
        moves TEXT NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('games', '${TOP_GAMES_MIN_GAMES}'), ('sources', 'hot.pgn');
    `);
    const insert = db.prepare(
      'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    // Ratings climb with the id, so the strongest games are the LAST
    // ones inserted, in a 1000..2999 spread that covers ten level
    // buckets; a tie on the sum (two games per rating) falls to the
    // later id, the live join's own tiebreak.
    db.exec('BEGIN');
    for (let i = 0; i < TOP_GAMES_MIN_GAMES; i += 1) {
      const elo = 1000 + Math.floor(i / 2) % 2000;
      insert.run(`W${i}`, `B${i}`, elo, elo, '1-0', '2026.01.01', 'T', 'C20', 'Open', 'e4 e5');
    }
    db.exec('COMMIT');
    db.close();
    indexPositions(hotPath);

    const hot = refGamesApi(hotPath);
    const hotApp = new Hono().route('/api', hot);
    try {
      const stored = new Database(hotPath, { readonly: true });
      // Ranked: the start position and the one after e4 — eight per
      // level bucket, ten buckets, both positions.
      expect(
        (stored.prepare('SELECT COUNT(*) AS n FROM top_games').get() as { n: number }).n,
      ).toBe(2 * 10 * 8);
      // The live answer, straight from the join the route used to run.
      const live = stored
        .prepare(
          `SELECT g.white FROM plies p JOIN games g ON g.id = p.game_id
           WHERE p.pos = (SELECT pos FROM move_counts GROUP BY pos ORDER BY SUM(w + d + b) DESC, pos LIMIT 1)
           ORDER BY g.white_elo + g.black_elo DESC, g.id DESC LIMIT 8`,
        )
        .all() as { white: string }[];
      stored.close();
      expect(live.map((g) => g.white)).toEqual(
        ['W3999', 'W3998', 'W3997', 'W3996', 'W3995', 'W3994', 'W3993', 'W3992'],
      );

      const ask = async (query: string): Promise<{ white: string; whiteElo: number }[]> =>
        (
          (await (
            await hotApp.request(`/api/refgames/explore?fen=${encodeURIComponent(START)}${query}`)
          ).json()) as { topGames: { white: string; whiteElo: number }[] }
        ).topGames;
      // Unfiltered: the table's answer is the live one.
      expect((await ask('')).map((g) => g.white)).toEqual(live.map((g) => g.white));
      // An aligned band reads the same rows: the top of the 2000-2199
      // bucket, strongest first, later id first on a tie.
      const band = await ask('&band=2000-2199');
      expect(band).toHaveLength(8);
      expect(band.every((g) => g.whiteElo >= 2000 && g.whiteElo <= 2199)).toBe(true);
      expect(band[0]).toMatchObject({ white: 'W2399', whiteElo: 2199 });
      expect(band[1]).toMatchObject({ white: 'W2398', whiteElo: 2199 });
      // An open band from an edge spans buckets, and still ranks across them.
      expect((await ask('&band=2600-')).map((g) => g.white)).toEqual(live.map((g) => g.white));
      // A ranked position with nothing in the band is an empty list, not
      // a fall through to the live join.
      expect(await ask('&band=3000-')).toEqual([]);
      // Off the bucket edges, or with any other filter, the live join
      // still answers — the same rule as the sums.
      expect((await ask('&band=2100-2199')).map((g) => g.whiteElo)).toEqual(
        [2199, 2199, 2198, 2198, 2197, 2197, 2196, 2196],
      );
      expect((await ask('&player=W2500')).map((g) => g.white)).toEqual(['W2500']);
    } finally {
      await hot.closeDb();
      rmSync(hotDir, { recursive: true, force: true });
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

  it('climbs the relaxation ladder', async () => {
    const run = async (query: string): Promise<Record<string, unknown>[]> => {
      const res = await app.request(`/api/refgames/deep-search?${query}`);
      expect(res.status).toBe(200);
      return (await res.text())
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    };
    const games = async (query: string) =>
      (await run(query)).filter((f) => f.type === 'game');

    // Exact and pawns agree on the position after 1.e4 — both e4 games
    // have that exact pawn structure at ply 1; the d4 game does not.
    const pawns = await games(`fen=${encodeURIComponent(AFTER_E4)}&match=pawns`);
    expect(pawns.map((g) => [g.white, g.ply])).toEqual([
      ['Carlsen', 1],
      ['Nepo', 1],
    ]);
    // The material rung no longer sees the pawns at all: every game
    // still has full material with black to move after its first move.
    const material = await games(`fen=${encodeURIComponent(AFTER_E4)}&match=material`);
    expect(material.map((g) => [g.white, g.ply])).toEqual([
      ['Carlsen', 1],
      ['Nepo', 1],
      ['Ding', 1],
    ]);
    // The rung still composes with the game filters.
    const filtered = await games(
      `fen=${encodeURIComponent(AFTER_E4)}&match=material&player=ding`,
    );
    expect(filtered.map((g) => g.white)).toEqual(['Ding']);

    expect((await app.request(`/api/refgames/deep-search?fen=x&match=fuzzy`)).status).toBe(400);
  });

  it('hunts a material situation with stability', async () => {
    const run = async (query: string): Promise<Record<string, unknown>[]> => {
      const res = await app.request(`/api/refgames/deep-search?${query}`);
      expect(res.status).toBe(200);
      return (await res.text())
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    };
    // Both knights on the board for two consecutive plies: true from
    // the very start of every game, so the hit is the streak's FIRST
    // ply, not the ply that completed it.
    const spec = encodeURIComponent('{"white":{"n":[2,2]},"stable":2}');
    const hits = (await run(`material=${spec}`)).filter((f) => f.type === 'game');
    expect(hits).toHaveLength(3);
    expect(hits.every((g) => g.ply === 0)).toBe(true);

    // A material situation no game contains.
    const none = await run(`material=${encodeURIComponent('{"white":{"q":[2,3]}}')}`);
    expect(none.filter((f) => f.type === 'game')).toEqual([]);
    expect(none.at(-1)).toMatchObject({ type: 'done', matched: 0 });

    // Strict refusals: a bad spec, and a fen or rung beside a spec.
    const bad = async (query: string) =>
      (await app.request(`/api/refgames/deep-search?${query}`)).status;
    expect(await bad('material=%7B%7D')).toBe(400); // {} constrains nothing
    expect(await bad('material=nonsense')).toBe(400);
    expect(await bad(`material=${spec}&fen=${encodeURIComponent(START)}`)).toBe(400);
    expect(await bad(`material=${spec}&match=material`)).toBe(400);
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
describe('parseSearchQuery', () => {
  it('leaves plain text alone', () => {
    expect(parseSearchQuery('kasparov najdorf')).toEqual({
      text: 'kasparov najdorf',
      terms: [],
      issues: [],
    });
  });

  it('reads the field prefixes, quotes holding spaces together', () => {
    expect(parseSearchQuery('white:tal black:botvinnik eco:B90')).toEqual({
      text: '',
      terms: [
        { kind: 'white', value: 'tal' },
        { kind: 'black', value: 'botvinnik' },
        { kind: 'eco', value: 'B90' },
      ],
      issues: [],
    });
    expect(parseSearchQuery('event:"tata steel" opening:najdorf')).toEqual({
      text: '',
      terms: [
        { kind: 'event', value: 'tata steel' },
        { kind: 'opening', value: 'najdorf' },
      ],
      issues: [],
    });
  });

  it('reads opponent: as another participant', () => {
    // The window's Against slot wearing its search name.
    expect(parseSearchQuery('player:kasparov opponent:karpov').terms).toEqual([
      { kind: 'player', value: 'kasparov' },
      { kind: 'player', value: 'karpov' },
    ]);
  });

  it('normalises results and year spans', () => {
    expect(parseSearchQuery('result:draw').terms).toEqual([
      { kind: 'result', value: '1/2-1/2' },
    ]);
    expect(parseSearchQuery('result:1-0').terms).toEqual([{ kind: 'result', value: '1-0' }]);
    expect(parseSearchQuery('year:2014').terms).toEqual([{ kind: 'year', from: 2014, to: 2014 }]);
    expect(parseSearchQuery('year:2010-2015').terms).toEqual([
      { kind: 'year', from: 2010, to: 2015 },
    ]);
  });

  it('reports an unparseable or empty qualifier as an issue and drops it', () => {
    // An intended filter must not silently become text or match nothing.
    expect(parseSearchQuery('result:maybe')).toEqual({
      text: '',
      terms: [],
      issues: [{ qualifier: 'result', kind: 'bad-result', value: 'maybe', raw: 'result:maybe' }],
    });
    expect(parseSearchQuery('year:soon').issues).toEqual([
      { qualifier: 'year', kind: 'bad-year', value: 'soon', raw: 'year:soon' },
    ]);
    expect(parseSearchQuery('year:2020-2010').issues).toEqual([
      { qualifier: 'year', kind: 'bad-year', value: '2020-2010', raw: 'year:2020-2010' },
    ]);
    expect(parseSearchQuery('carlsen result:')).toEqual({
      text: 'carlsen',
      terms: [],
      issues: [{ qualifier: 'result', kind: 'empty', raw: 'result:' }],
    });
  });

  it('mixes prefixes and text in one query', () => {
    expect(parseSearchQuery('eco:C67 kasparov')).toEqual({
      text: 'kasparov',
      terms: [{ kind: 'eco', value: 'C67' }],
      issues: [],
    });
  });

  it('parses elo floors and bands', () => {
    expect(parseSearchQuery('elo:2500').terms).toEqual([{ kind: 'elo', lo: 2500, hi: null }]);
    expect(parseSearchQuery('elo:2400-2600').terms).toEqual([
      { kind: 'elo', lo: 2400, hi: 2600 },
    ]);
    expect(parseSearchQuery('elo:2400-').terms).toEqual([{ kind: 'elo', lo: 2400, hi: null }]);
    expect(parseSearchQuery('elo:grandmaster').issues).toEqual([
      { qualifier: 'elo', kind: 'bad-elo', value: 'grandmaster', raw: 'elo:grandmaster' },
    ]);
    expect(parseSearchQuery('elo:2600-2400').issues).toEqual([
      { qualifier: 'elo', kind: 'bad-elo', value: '2600-2400', raw: 'elo:2600-2400' },
    ]);
  });

  it('warns on terms that cannot all hold in one game', () => {
    // Two exact scores; two spans with no common year.
    expect(parseSearchQuery('result:1-0 result:0-1').issues).toEqual([
      {
        qualifier: 'result',
        kind: 'impossible',
        value: 'result:1-0 · result:0-1',
        raw: 'result:0-1',
      },
    ]);
    expect(parseSearchQuery('year:2014 year:2020').issues).toEqual([
      { qualifier: 'year', kind: 'impossible', value: 'year:2014 · year:2020', raw: 'year:2020' },
    ]);
    // One seat, two names that cannot be the same person.
    expect(parseSearchQuery('white:carlsen white:nakamura').issues).toEqual([
      {
        qualifier: 'white',
        kind: 'impossible',
        value: 'white:carlsen · white:nakamura',
        raw: 'white:nakamura',
      },
    ]);
    // Three distinct names, two seats.
    expect(parseSearchQuery('player:carlsen white:nakamura black:kasparov').issues).toEqual([
      {
        qualifier: 'player',
        kind: 'impossible',
        value: 'white:nakamura · black:kasparov · player:carlsen',
        raw: 'player:carlsen',
      },
    ]);
    // Elo bands with no common rating.
    expect(parseSearchQuery('elo:2600 elo:2400-2500').issues).toEqual([
      {
        qualifier: 'elo',
        kind: 'impossible',
        value: 'elo:2600 · elo:2400-2500',
        raw: 'elo:2400-2500',
      },
    ]);
    // The terms stay in the search — zero rows is the right answer.
    expect(parseSearchQuery('result:1-0 result:0-1').terms).toHaveLength(2);
  });

  it('warns when a query term and the active filters leave no game', () => {
    const cross = (q: string, f: Parameters<typeof findCrossImpossible>[1]) =>
      findCrossImpossible(q, f);
    // Exact score against the quick row, and against a pinned outcome.
    expect(cross('result:0-1 ', { result: '1-0' })).toMatchObject([
      { qualifier: 'result', kind: 'impossible', cross: true, raw: 'result:0-1' },
    ]);
    expect(
      cross('result:0-1 ', { player: 'carlsen', side: 'white', outcome: 'won' }),
    ).toMatchObject([{ qualifier: 'result', cross: true }]);
    // Won with no side rules out only the draw.
    expect(cross('result:draw ', { player: 'carlsen', side: 'any', outcome: 'won' })).toHaveLength(1);
    expect(cross('result:1-0 ', { player: 'carlsen', side: 'any', outcome: 'won' })).toHaveLength(0);
    // Dates and elo intersect across the surfaces.
    expect(cross('year:2014 ', { from: '2016-01-01' })).toHaveLength(1);
    expect(cross('year:2014-2020 ', { from: '2016-01-01' })).toHaveLength(0);
    expect(cross('elo:2400-2500 ', { minElo: 2600 })).toHaveLength(1);
    expect(cross('elo:2400-2500 ', { band: { lo: 2450, hi: 2480 } })).toHaveLength(0);
    // Seats: the window's player claims the seat its side names.
    expect(
      cross('white:nakamura ', { player: 'carlsen', side: 'white' }),
    ).toMatchObject([{ qualifier: 'white', cross: true }]);
    expect(cross('white:carlsen ', { player: 'carlsen', side: 'white' })).toHaveLength(0);
    // Three names, two seats, across the surfaces.
    expect(
      cross('player:kasparov ', { player: 'carlsen', player2: 'nakamura' }),
    ).toMatchObject([{ qualifier: 'player', cross: true }]);
    // The window arguing with itself is not the box's business.
    expect(cross('', { result: '0-1', player: 'x', side: 'white', outcome: 'won' })).toHaveLength(0);
  });

  it('does not warn on combinations that can hold', () => {
    const ok = (q: string) => expect(parseSearchQuery(q).issues).toEqual([]);
    ok('player:carlsen opponent:kasparov'); // head-to-head
    ok('white:carlsen black:kasparov');
    ok('player:carlsen white:carlsen'); // same name, both hold
    ok('white:carl white:carlsen'); // one contains the other
    ok('year:2010-2015 year:2014'); // overlapping spans
    ok('result:draw result:1/2-1/2'); // same score, two spellings
    ok('eco:B90 opening:french'); // deliberately not judged
    ok('elo:2400-2600 elo:2500'); // overlapping elo constraints
    ok('elo:2400 elo:2500'); // two floors — the higher simply wins
  });
});

describe('matchesSearchTerms', () => {
  const game = {
    white: 'Kasparov, Garry',
    black: 'Karpov, Anatoly',
    result: '1-0',
    date: '1990.10.15',
    eco: 'C92',
    opening: { eco: 'C92', name: 'Ruy Lopez: Zaitsev' },
    event: 'World Championship',
  };

  it('answers the same terms the server compiles to SQL', () => {
    const yes = (q: string) => expect(matchesSearchTerms(parseSearchQuery(q).terms, game)).toBe(true);
    const no = (q: string) => expect(matchesSearchTerms(parseSearchQuery(q).terms, game)).toBe(false);
    yes('player:kasparov opponent:karpov');
    yes('white:kasparov black:karpov');
    no('white:karpov');
    yes('eco:C9');
    no('eco:B');
    yes('opening:zaitsev');
    yes('event:"world championship"');
    yes('result:1-0');
    no('result:draw');
    yes('year:1990');
    yes('year:1985-1995');
    no('year:2000');
  });

  it('answers elo like the server: the weaker player carries the game', () => {
    const rated = { ...game, whiteElo: 2800, blackElo: 2730 };
    const yes = (q: string) => expect(matchesSearchTerms(parseSearchQuery(q).terms, rated)).toBe(true);
    const no = (q: string) => expect(matchesSearchTerms(parseSearchQuery(q).terms, rated)).toBe(false);
    yes('elo:2700');
    no('elo:2750'); // Black's 2730 is under the floor
    yes('elo:2700-2750');
    no('elo:2800-2900'); // the weaker player is outside the band
    // Unrated games never qualify.
    expect(matchesSearchTerms(parseSearchQuery('elo:2000').terms, game)).toBe(false);
  });
});

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
      player2: 'Kasparov',
      side: 'white',
      outcome: 'won',
      opening: 'B90',
      event: 'Tata Steel',
      from: '2020-01-01',
      to: '2020-01-01',
      terms: '[{"kind":"eco","value":"B9"}]',
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

  it('compiles the box terms to the SQL the search route built inline', () => {
    // The clause text and bind order the /refgames/search route emitted
    // before term compilation moved into gamesWhere — pinned here so
    // the move is provably a move, not a rewrite.
    const q =
      'player:carlsen white:kasparov black:karpov opening:najdorf eco:B9 event:"world championship" result:1-0 year:2010-2015 ';
    const { terms } = parseSearchQuery(q);
    const got = gamesWhere((k) => (k === 'terms' ? JSON.stringify(terms) : undefined), '', false);
    expect(got.clauses).toEqual([
      '(white LIKE ? OR black LIKE ?)',
      'white LIKE ?',
      'black LIKE ?',
      'opening LIKE ?',
      'eco LIKE ?',
      'event LIKE ?',
      'result = ?',
      "REPLACE(date, '.', '-') >= ? AND REPLACE(date, '.', '-') <= ?",
    ]);
    expect(got.binds).toEqual([
      '%carlsen%',
      '%carlsen%',
      '%kasparov%',
      '%karpov%',
      '%najdorf%',
      'B9%',
      '%world championship%',
      '1-0',
      '2010-01-01',
      '2015-12-31',
    ]);
    // The seek-aware player matching, same as the window's fields.
    const seek = gamesWhere(
      (k) => (k === 'terms' ? '[{"kind":"white","value":"carlsen"}]' : undefined),
      '',
      true,
    );
    expect(seek.clauses).toEqual(['white IN (SELECT name FROM players WHERE name LIKE ?)']);
    // elo compiles the band's clause shape — MIN >= lo IS "both at
    // least lo", so the floor needs no second spelling.
    const elo = gamesWhere((k) =>
      k === 'terms' ? JSON.stringify(parseSearchQuery('elo:2400-2600').terms) : undefined,
    );
    expect(elo.clauses).toEqual([
      'MIN(white_elo, black_elo) >= ?',
      'MIN(white_elo, black_elo) <= ?',
    ]);
    expect(elo.binds).toEqual([2400, 2600]);
    expect(
      gamesWhere((k) => (k === 'terms' ? JSON.stringify(parseSearchQuery('elo:2500').terms) : undefined))
        .clauses,
    ).toEqual(['MIN(white_elo, black_elo) >= ?']);
    // Malformed JSON filters nothing rather than everything.
    expect(gamesWhere((k) => (k === 'terms' ? 'not json' : undefined)).clauses).toEqual([]);
  });

  it('answers an opening name through the catalogue positions when the index is there', () => {
    const najdorf = openingKeysNamed('najdorf');
    expect(najdorf.length).toBeGreaterThan(0);
    const marks = najdorf.map(() => '?').join(',');
    const term = gamesWhere(
      (k) => (k === 'terms' ? JSON.stringify(parseSearchQuery('opening:najdorf').terms) : undefined),
      'g.',
      false,
      true,
    );
    expect(term.clauses).toEqual([
      `(g.opening LIKE ? OR g.id IN (SELECT game_id FROM plies WHERE pos IN (${marks})))`,
    ]);
    expect(term.binds).toHaveLength(1 + najdorf.length);
    expect(term.binds[0]).toBe('%najdorf%');
    expect(typeof term.binds[1]).toBe('bigint');
    // The window's field keeps its ECO arm and gains the same positions.
    const field = gamesWhere((k) => (k === 'opening' ? 'najdorf' : undefined), '', false, true);
    expect(field.clauses).toEqual([
      `(opening LIKE ? OR eco LIKE ? OR id IN (SELECT game_id FROM plies WHERE pos IN (${marks})))`,
    ]);
    // No catalogued line carries the name: the text arm alone, as before.
    expect(
      gamesWhere((k) => (k === 'opening' ? 'xyzzy' : undefined), '', false, true).clauses,
    ).toEqual(['(opening LIKE ? OR eco LIKE ?)']);
    // Without the index, nothing changes at all.
    expect(
      gamesWhere(
        (k) => (k === 'terms' ? JSON.stringify(parseSearchQuery('opening:najdorf').terms) : undefined),
        '',
        false,
        false,
      ).clauses,
    ).toEqual(['opening LIKE ?']);
  });

  it('parses a declaration and rejects everything else', () => {
    expect(parseNativeCapabilities('{"filters":["result","player"]}\n')).toEqual({
      filters: new Set(['result', 'player']),
      scan: new Set(),
      deep: null,
    });
    expect(parseNativeCapabilities('{"filters":[],"scan":["match","material"]}')).toEqual({
      filters: new Set(),
      scan: new Set(['match', 'material']),
      deep: null,
    });
    // The deep-search output contract rides the same declaration; a
    // build from before it declared one parses, with none.
    expect(parseNativeCapabilities('{"filters":[],"scan":[],"deep":"hits"}')).toEqual({
      filters: new Set(),
      scan: new Set(),
      deep: 'hits',
    });
    expect(parseNativeCapabilities('')).toBeNull();
    expect(parseNativeCapabilities('not json')).toBeNull();
    expect(parseNativeCapabilities('{"filters":"result"}')).toBeNull();
    expect(parseNativeCapabilities('{"filters":[1,2]}')).toBeNull();
    expect(parseNativeCapabilities('{"filters":[],"scan":"match"}')).toBeNull();
    expect(parseNativeCapabilities('{"filters":[],"deep":["hits"]}')).toBeNull();
    expect(parseNativeCapabilities('{}')).toBeNull();
  });

  it('routes a request using an undeclared filter down the JS path', () => {
    const declared = {
      filters: new Set(GAMES_WHERE_KEYS.filter((k) => k !== 'opening')),
      scan: new Set(['match']),
      deep: 'hits',
    };
    const query = (q: Record<string, string>) => (k: string) => q[k];
    // Nothing asked, nothing undeclared — the unfiltered scan is native.
    expect(undeclaredFilters(declared, query({}))).toEqual([]);
    // Declared filters ride the binary, scan keys included.
    expect(undeclaredFilters(declared, query({ player: 'Carlsen', side: 'white' }))).toEqual([]);
    expect(undeclaredFilters(declared, query({ match: 'pawns', minElo: '2500' }))).toEqual([]);
    // One undeclared filter poisons the whole request, even beside
    // declared ones: half-filtered fast is wrong, filtered slow is not.
    expect(undeclaredFilters(declared, query({ player: 'Carlsen', opening: 'B90' }))).toEqual([
      'opening',
      'opening:positions',
    ]);
    // An opening name is answered in positions, a token of its own: a
    // binary that declares the `opening` key but not the token routes
    // both spellings of the name, field and term, down the JS path.
    const openingOnly = { ...declared, filters: new Set<string>(GAMES_WHERE_KEYS) };
    expect(undeclaredFilters(openingOnly, query({ opening: 'najdorf' }))).toEqual(['opening:positions']);
    expect(
      undeclaredFilters(openingOnly, query({ terms: '[{"kind":"opening","value":"najdorf"}]' })),
    ).toEqual(['opening:positions']);
    expect(undeclaredFilters(openingOnly, query({ terms: '[{"kind":"eco","value":"B9"}]' }))).toEqual([]);
    expect(
      undeclaredFilters(
        { ...openingOnly, filters: new Set<string>([...GAMES_WHERE_KEYS, 'opening:positions']) },
        query({ opening: 'najdorf' }),
      ),
    ).toEqual([]);
    // Scan keys negotiate in their own field: a binary from before the
    // ladder declared no scan at all, so match/material stay JS.
    const preLadder = { filters: declared.filters, scan: new Set<string>(), deep: null };
    expect(undeclaredFilters(preLadder, query({ match: 'pawns' }))).toEqual(['match']);
    expect(undeclaredFilters(preLadder, query({ material: '{}' }))).toEqual(['material']);
    // Present-but-empty still counts: both sides may ignore it today,
    // but "present means asked" is the one rule that needs no smarts.
    expect(undeclaredFilters(declared, query({ opening: '' }))).toEqual(['opening', 'opening:positions']);
    // A key that is not in the vocabulary never counts.
    expect(
      undeclaredFilters({ filters: new Set(), scan: new Set(), deep: null }, query({ fen: 'x', db: 'y' })),
    ).toEqual([]);
    // A motif negotiates its key AND its id: the key says the binary
    // replays motifs at all, the id that it knows this one, so a
    // motif added later stays JS on a binary that lacks it while the
    // ones it declared stay native.
    const motifs = { ...declared, scan: new Set(['match', 'material', 'motif', 'motif:iqp']) };
    expect(undeclaredFilters(motifs, query({ motif: '{"id":"iqp","stable":8}' }))).toEqual([]);
    expect(undeclaredFilters(motifs, query({ motif: '{"id":"opposite-castling"}' }))).toEqual([
      'motif:opposite-castling',
    ]);
    expect(undeclaredFilters(preLadder, query({ motif: '{"id":"iqp"}' }))).toEqual([
      'motif',
      'motif:iqp',
    ]);
    // A request that is not even a spec names no id: the key alone
    // routes it, and the JS path refuses it.
    expect(undeclaredFilters(motifs, query({ motif: 'nonsense' }))).toEqual([]);
    expect(undeclaredFilters(preLadder, query({ motif: 'nonsense' }))).toEqual(['motif']);
  });
});

describe('motif hunts through the route', () => {
  let dir: string;
  let app: Hono;
  let refgames: ReturnType<typeof refGamesApi>;

  // Hand-written games with the motifs in them (the plies are pinned
  // by the replay tests in refgamesScan.test.ts): kings castled to
  // opposite wings, a Tarrasch isolani that stands for three plies,
  // and a game with neither.
  const OPPOSITE = 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O d6 d3 Bg4 Nc3 Qd7 Be3 O-O-O a4 Nf6';
  const TARRASCH =
    'd4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7 O-O O-O Bg5 cxd4 Nxd4 h6 Nxc6 bxc6';
  const SAME_WING = 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 Qe2 O-O';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'refgames-motif-'));
    const dbPath = join(dir, 'games.sqlite');
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
    insert.run('Wings', 'Apart', 2500, 2500, '1-0', '2026.01.01', 'Motifs', 'C50', null, OPPOSITE);
    insert.run('Isolani', 'Holder', 2500, 2500, '0-1', '2026.01.02', 'Motifs', 'D34', null, TARRASCH);
    insert.run('Same', 'Wing', 2500, 2500, '1/2-1/2', '2026.01.03', 'Motifs', 'C50', null, SAME_WING);
    tune(db);
    db.close();
    // The index pass writes the men and ply columns the route's
    // prefilter reads, so the `stable - 1` length gate is exercised.
    indexPositions(dbPath);
    refgames = refGamesApi(dbPath);
    app = new Hono().route('/api', refgames);
  });

  afterAll(async () => {
    await refgames.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  const run = async (query: string): Promise<Record<string, unknown>[]> => {
    const res = await app.request(`/api/refgames/deep-search?${query}`);
    expect(res.status).toBe(200);
    // A motif never takes a fast path: the pack cannot answer one.
    expect(res.headers.get('x-scan-path')).toBe('replay');
    return (await res.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  };
  const games = async (query: string) =>
    (await run(query)).filter((f) => f.type === 'game').map((g) => [g.white, g.ply]);

  it('finds each motif at the ply the reference replay says', async () => {
    expect(await games(`motif=${encodeURIComponent('{"id":"opposite-castling"}')}`)).toEqual([
      ['Wings', 14],
    ]);
    expect(await games(`motif=${encodeURIComponent('{"id":"iqp"}')}`)).toEqual([['Isolani', 19]]);
    expect(await games(`motif=${encodeURIComponent('{"id":"iqp","side":"white"}')}`)).toEqual([]);
    // Stability rides the same streak as the material hunt.
    expect(await games(`motif=${encodeURIComponent('{"id":"iqp","stable":3}')}`)).toEqual([
      ['Isolani', 19],
    ]);
    expect(await games(`motif=${encodeURIComponent('{"id":"iqp","stable":4}')}`)).toEqual([]);
    // The game filters narrow a motif hunt as they narrow every other.
    expect(
      await games(`motif=${encodeURIComponent('{"id":"opposite-castling"}')}&player=isolani`),
    ).toEqual([]);
    const all = await run(`motif=${encodeURIComponent('{"id":"opposite-castling"}')}`);
    expect(all.at(-1)).toMatchObject({ type: 'done', scanned: 3, matched: 1, exhaustive: true });
  });

  it('refuses a bad spec, and a motif beside any other hunt', async () => {
    const bad = async (query: string) =>
      (await app.request(`/api/refgames/deep-search?${query}`)).status;
    const motif = encodeURIComponent('{"id":"iqp"}');
    expect(await bad('motif=nonsense')).toBe(400);
    expect(await bad(`motif=${encodeURIComponent('{"id":"greek-gift"}')}`)).toBe(400);
    expect(await bad(`motif=${encodeURIComponent('{"id":"iqp","stable":0}')}`)).toBe(400);
    expect(await bad(`motif=${encodeURIComponent('{"id":"opposite-castling","side":"white"}')}`)).toBe(400);
    expect(await bad(`motif=${motif}&fen=${encodeURIComponent('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')}`)).toBe(400);
    expect(await bad(`motif=${motif}&match=structure`)).toBe(400);
    expect(await bad(`motif=${motif}&material=${encodeURIComponent('{"white":{"q":[0,0]}}')}`)).toBe(400);
  });
});
