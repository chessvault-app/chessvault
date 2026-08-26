import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INITIAL_FEN, makeFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { hashSetup } from '../shared/zobrist.ts';
import { myGamesApi } from './myGames.ts';

/**
 * Four games by "me": two as White (a win and a loss, both 1.e4), one as
 * Black, and one blitz game. Enough to tell every filter apart from every
 * other one — a fixture where two filters would select the same rows
 * proves nothing about either.
 */
const game = (o: {
  white: string;
  black: string;
  result: string;
  date: string;
  tc: string;
  moves: string;
}): string => `[White "${o.white}"]
[Black "${o.black}"]
[Result "${o.result}"]
[UTCDate "${o.date}"]
[TimeControl "${o.tc}"]
[WhiteElo "1800"]
[BlackElo "1810"]

${o.moves} ${o.result}
`;

const ARCHIVE = [
  // As White, rapid, won — 1.e4
  game({ white: 'me', black: 'foe', result: '1-0', date: '2026.01.10', tc: '600', moves: '1. e4 e5 2. Nf3' }),
  // As White, rapid, lost — 1.e4 as well, so the two share a position
  game({ white: 'me', black: 'foe', result: '0-1', date: '2026.02.10', tc: '600', moves: '1. e4 c5 2. Nf3' }),
  // As White, blitz, drawn — 1.d4, a different first move
  game({ white: 'me', black: 'foe', result: '1/2-1/2', date: '2026.03.10', tc: '180+2', moves: '1. d4 d5' }),
  // As Black, rapid, won
  game({ white: 'foe', black: 'me', result: '0-1', date: '2026.04.10', tc: '600', moves: '1. e4 e5 2. Nc3' }),
].join('\n');

describe('my games index', () => {
  let dir: string;
  let games: string;
  let app: Hono;

  const ask = async (query: string): Promise<{
    moves: { san: string; w: number; d: number; b: number; total: number }[];
    topGames: { white: string; black: string; file: string; index: number }[];
    games: number;
  }> => {
    const res = await app.request(`/api/mygames?fen=${encodeURIComponent(INITIAL_FEN)}&${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as never;
  };

  const total = (moves: { total: number }[]): number =>
    moves.reduce((sum, m) => sum + m.total, 0);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mygames-'));
    games = join(dir, 'games');
    mkdirSync(join(games, 'chesscom', 'me'), { recursive: true });
    writeFileSync(join(games, 'chesscom', 'me', '2026-01.pgn'), ARCHIVE);
    app = new Hono().route('/api', myGamesApi(games, join(dir, 'index.sqlite')));
  });

  afterAll(() => {
    // Best effort: an open sqlite handle can hold the file on Windows.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A leftover temp directory is not worth failing a suite over.
    }
  });

  it('indexes the vault with no build step', async () => {
    const { moves } = await ask('');
    expect(moves.map((m) => m.san)).toEqual(['e4', 'd4']);
    expect(total(moves)).toBe(4);
  });

  it('counts results from white point of view, like a book', async () => {
    const { moves } = await ask('');
    const e4 = moves.find((m) => m.san === 'e4')!;
    // Three 1.e4 games: one white win, two black wins.
    expect([e4.w, e4.d, e4.b]).toEqual([1, 0, 2]);
  });

  it('filters by which side I played', async () => {
    expect(total((await ask('side=white')).moves)).toBe(3);
    expect(total((await ask('side=black')).moves)).toBe(1);
  });

  it('reads outcome relative to my side, not the result string', async () => {
    // I won once as White (1-0) and once as Black (0-1). A filter that
    // just matched the Result header would score these differently.
    const won = await ask('outcome=win');
    expect(total(won.moves)).toBe(2);
    expect(total((await ask('outcome=loss')).moves)).toBe(1);
    expect(total((await ask('outcome=draw')).moves)).toBe(1);
  });

  it('filters by speed and by date range', async () => {
    expect(total((await ask('speeds=blitz')).moves)).toBe(1);
    expect(total((await ask('speeds=rapid')).moves)).toBe(3);
    expect(total((await ask('speeds=blitz,rapid')).moves)).toBe(4);
    expect(total((await ask('from=2026-02-01')).moves)).toBe(3);
    expect(total((await ask('from=2026-02-01&to=2026-03-31')).moves)).toBe(2);
  });

  it('combines filters', async () => {
    // As White, rapid, won: exactly the first game.
    const { moves } = await ask('side=white&speeds=rapid&outcome=win');
    expect(moves.map((m) => m.san)).toEqual(['e4']);
    expect(total(moves)).toBe(1);
  });

  it('ignores a filter value it does not recognise', async () => {
    expect(total((await ask('side=purple&outcome=maybe&speeds=fast')).moves)).toBe(4);
    expect(total((await ask('from=last-tuesday')).moves)).toBe(4);
  });

  it('separates the collection from the archives', async () => {
    mkdirSync(join(games, 'collection'), { recursive: true });
    writeFileSync(
      join(games, 'collection', 'kept.pgn'),
      game({ white: 'me', black: 'foe', result: '1-0', date: '2026.05.10', tc: '600', moves: '1. e4 e6' }),
    );
    await app.request('/api/mygames/reindex', { method: 'POST' });
    expect(total((await ask('')).moves)).toBe(5);
    expect(total((await ask('collection=1')).moves)).toBe(1);
  });

  it('picks up new games without anything being rebuilt', async () => {
    expect(total((await ask('')).moves)).toBe(4);

    writeFileSync(
      join(games, 'chesscom', 'me', '2026-02.pgn'),
      game({ white: 'me', black: 'foe', result: '1-0', date: '2026.06.10', tc: '600', moves: '1. e4 e5 2. Bc4' }),
    );
    // Nothing is built and no source list is edited — the next lookup sees
    // it. This is the whole point of an index over a book.
    await app.request('/api/mygames/reindex', { method: 'POST' });
    expect(total((await ask('')).moves)).toBe(5);
  });

  it('reindexes a file that changed, without duplicating it', async () => {
    const path = join(games, 'chesscom', 'me', '2026-01.pgn');
    writeFileSync(
      path,
      `${ARCHIVE}\n${game({ white: 'me', black: 'foe', result: '1-0', date: '2026.07.10', tc: '600', moves: '1. e4 c6' })}`,
    );
    await app.request('/api/mygames/reindex', { method: 'POST' });
    // 5, not 9: the file's old rows are replaced, not added to.
    expect(total((await ask('')).moves)).toBe(5);
  });

  it('drops games from a file that was deleted', async () => {
    rmSync(join(games, 'chesscom', 'me', '2026-01.pgn'));
    await app.request('/api/mygames/reindex', { method: 'POST' });
    expect(total((await ask('')).moves)).toBe(0);
  });

  it('points each listed game at the file it lives in', async () => {
    const { topGames } = await ask('');
    expect(topGames.length).toBeGreaterThan(0);
    for (const g of topGames) {
      expect(g.file).toBe('chesscom/me/2026-01.pgn');
      expect(g.index).toBeGreaterThanOrEqual(0);
    }
    // Newest first: yours are listed by recency, not by rating.
    expect(topGames[0]!.black).toBe('me');
  });

  it('reports what it holds', async () => {
    const res = await app.request('/api/mygames/status');
    const { games: n, positions } = (await res.json()) as { games: number; positions: number };
    expect(n).toBe(4);
    expect(positions).toBeGreaterThan(0);
  });

  it('finds where each game left a prepared set, and who left it', async () => {
    // Prepared as White: the 1.e4 e5 complex — start, after e4, after e5.
    const keys: string[] = [];
    const pos = Chess.default();
    keys.push(hashSetup(pos.toSetup()).toString(16));
    for (const san of ['e4', 'e5']) {
      pos.play(parseSan(pos, san)!);
      keys.push(hashSetup(pos.toSetup()).toString(16));
    }
    const res = await app.request('/api/mygames/deviations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys, side: 'white' }),
    });
    expect(res.status).toBe(200);
    const { deviations } = (await res.json()) as {
      deviations: { sans: string[]; ply: number; userDeviated: boolean; result: string }[];
    };
    // Newest first: the 1.d4 game (I left my own book with the first
    // move), then the 1.e4 c5 game (the opponent left it). The 1.e4 e5
    // game stayed inside for its whole indexed prefix and is not news;
    // the game I played as Black is out of scope.
    expect(deviations.map((d) => d.sans)).toEqual([['d4'], ['e4', 'c5']]);
    expect(deviations.map((d) => d.userDeviated)).toEqual([true, false]);
    expect(deviations.map((d) => d.ply)).toEqual([0, 1]);
    expect(deviations[0]!.result).toBe('1/2-1/2');
  });

  /**
   * The prepared set for the deviation tests: the 1.e4 e5 complex, as
   * White. Start, after e4, after e5 — everything else is off the book.
   */
  const preparedKeys = (): string[] => {
    const keys: string[] = [];
    const pos = Chess.default();
    keys.push(hashSetup(pos.toSetup()).toString(16));
    for (const san of ['e4', 'e5']) {
      pos.play(parseSan(pos, san)!);
      keys.push(hashSetup(pos.toSetup()).toString(16));
    }
    return keys;
  };

  const deviationsAsWhite = async (): Promise<
    { sans: string[]; collection: boolean; file: string; site: string | null }[]
  > => {
    const res = await app.request('/api/mygames/deviations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: preparedKeys(), side: 'white' }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { deviations: never[] }).deviations;
  };

  // A kept game carries the stamp the collect route writes; without it a
  // file outside `<site>/<user>/` has no side, and these ask for White's.
  const kept = (link: string | null, moves: string, date: string): string =>
    `[VaultSide "white"]\n${link === null ? '' : `[Link "${link}"]\n`}${game({ white: 'me', black: 'foe', result: '1-0', date, tc: '600', moves })}`;

  it('shows one row for a game kept out of an archive, and says it is kept', async () => {
    // Keeping a game COPIES it: the month stays cached, so the index holds
    // the same game twice and the panel listed it twice, identically. The
    // URL each copy carries is what says they are one game — and the kept
    // copy is the one that survives, because it is the annotatable one.
    mkdirSync(join(games, 'collection'), { recursive: true });
    const link = 'https://www.chess.com/game/live/9';
    writeFileSync(
      join(games, 'chesscom', 'me', '2026-05.pgn'),
      `[Link "${link}"]\n${game({ white: 'me', black: 'foe', result: '1-0', date: '2026.05.10', tc: '600', moves: '1. d4 Nf6' })}`,
    );
    writeFileSync(join(games, 'collection', 'kept-linked.pgn'), kept(link, '1. d4 Nf6', '2026.05.10'));

    const linked = (await deviationsAsWhite()).filter((d) => d.site === link);
    expect(linked).toHaveLength(1);
    expect(linked[0]!.collection).toBe(true);
    expect(linked[0]!.file).toBe('collection/kept-linked.pgn');
  });

  it('keeps two games with no URL apart, however alike they look', async () => {
    // Nothing merges without a URL to merge on. These two are the same
    // moves on the same day by the same players — a rematch is exactly
    // that — and guessing from names and a date would swallow one.
    mkdirSync(join(games, 'collection'), { recursive: true });
    writeFileSync(join(games, 'collection', 'a.pgn'), kept(null, '1. d4 Nf6', '2026.05.11'));
    writeFileSync(join(games, 'collection', 'b.pgn'), kept(null, '1. d4 Nf6', '2026.05.11'));

    const rows = (await deviationsAsWhite()).filter((d) => d.file.startsWith('collection/'));
    expect(rows).toHaveLength(2);
    expect(rows.every((d) => d.site === null && d.collection)).toBe(true);
  });

  it('says an archived game is not kept', async () => {
    expect((await deviationsAsWhite()).find((d) => d.sans.join() === 'e4,c5')!.collection).toBe(
      false,
    );
  });

  /**
   * The "indexed N games" line, and how many of those a filter lets by.
   *
   * Reindexes first: a plain read syncs at most every SCAN_INTERVAL_MS,
   * and a test that writes a file and immediately asks would otherwise be
   * answered from before the write — passing whatever it expected.
   */
  const held = async (query = ''): Promise<{ games: number; matching: number }> => {
    await app.request('/api/mygames/reindex', { method: 'POST' });
    return (await (await app.request(`/api/mygames/status?${query}`)).json()) as never;
  };

  it('counts a game kept out of an archive once, not twice', async () => {
    // The explorer's move totals and the pane's own count both summed the
    // archived copy AND the kept one, so keeping a game inflated your
    // record of it — 2 games played from one game played.
    mkdirSync(join(games, 'collection'), { recursive: true });
    const link = 'https://www.chess.com/game/live/11';
    writeFileSync(
      join(games, 'chesscom', 'me', '2026-06.pgn'),
      `[Link "${link}"]\n${game({ white: 'me', black: 'foe', result: '1-0', date: '2026.06.10', tc: '600', moves: '1. e4 e5 2. Bc4' })}`,
    );
    const archived = await held();
    expect(archived.games).toBe(5);
    expect(total((await ask('')).moves)).toBe(5);

    // Keep it. Same game, second file, and nothing about the record of
    // what was played may move.
    writeFileSync(join(games, 'collection', 'kept.pgn'), kept(link, '1. e4 e5 2. Bc4', '2026.06.10'));
    expect(await held()).toEqual(archived);
    expect(total((await ask('')).moves)).toBe(5);

    // And the copy that answers is the kept one, so "Kept only" finds it.
    expect((await held('collection=1')).matching).toBe(1);
  });

  it('lets the archived copy answer again when the kept one is deleted', async () => {
    // Un-shadowing is the half a one-way rule gets wrong: delete the game
    // you kept and the cached month is still there, so the game is still
    // yours. It must come back to the count, not vanish with the file.
    mkdirSync(join(games, 'collection'), { recursive: true });
    const link = 'https://www.chess.com/game/live/12';
    writeFileSync(
      join(games, 'chesscom', 'me', '2026-07.pgn'),
      `[Link "${link}"]\n${game({ white: 'me', black: 'foe', result: '1-0', date: '2026.07.10', tc: '600', moves: '1. e4 e5 2. Bc4' })}`,
    );
    writeFileSync(join(games, 'collection', 'kept.pgn'), kept(link, '1. e4 e5 2. Bc4', '2026.07.10'));
    expect((await held()).games).toBe(5);

    rmSync(join(games, 'collection', 'kept.pgn'));
    await app.request('/api/mygames/reindex', { method: 'POST' });
    expect((await held()).games).toBe(5);
    expect((await held('collection=1')).matching).toBe(0);
  });

  it('upgrades a database that predates the shadow column', async () => {
    // What every existing vault does on the release that adds this: the
    // table is already there, so CREATE TABLE IF NOT EXISTS adds nothing,
    // and the copies are already indexed. Dropping the column reproduces
    // exactly that state — and the ALTER on open has to be followed by a
    // stamping pass, or the vault double-counts until a file next moves.
    mkdirSync(join(games, 'collection'), { recursive: true });
    const link = 'https://www.chess.com/game/live/14';
    writeFileSync(
      join(games, 'chesscom', 'me', '2026-09.pgn'),
      `[Link "${link}"]\n${game({ white: 'me', black: 'foe', result: '1-0', date: '2026.09.10', tc: '600', moves: '1. e4 e5 2. Bc4' })}`,
    );
    writeFileSync(join(games, 'collection', 'kept.pgn'), kept(link, '1. e4 e5 2. Bc4', '2026.09.10'));
    expect((await held()).games).toBe(5);

    // Back to the old shape, with the pair sitting in it.
    const old = new Database(join(dir, 'index.sqlite'));
    old.exec('ALTER TABLE games DROP COLUMN shadowed');
    expect(
      (old.prepare('PRAGMA table_info(games)').all() as { name: string }[]).some(
        (c) => c.name === 'shadowed',
      ),
    ).toBe(false);
    old.close();

    // A fresh server over that same database, as an upgrade is.
    app = new Hono().route('/api', myGamesApi(games, join(dir, 'index.sqlite')));
    expect((await held()).games).toBe(5);
  });

  it('compares my games against a reference database, flagging rare moves', async () => {
    // A reference corpus of 25 games all answering 1.e4 with e5: my one
    // 1.d4 game is a 0-of-25 move at the start position; my 1.e4 games
    // are mainstream and stay unflagged.
    const refDir = join(dir, 'refgames');
    mkdirSync(refDir, { recursive: true });
    const ref = new Database(join(refDir, 'elite.sqlite'));
    ref.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        white TEXT NOT NULL, black TEXT NOT NULL,
        white_elo INTEGER NOT NULL, black_elo INTEGER NOT NULL,
        result TEXT NOT NULL, date TEXT, event TEXT, eco TEXT, opening TEXT,
        moves TEXT NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const put = ref.prepare(
      "INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, 2500, 2500, '1-0', '2026.01.01', 'T', 'C20', 'Open', 'e4 e5')",
    );
    for (let i = 0; i < 25; i += 1) put.run(`W${i}`, `B${i}`);
    ref.close();
    const { indexPositions } = await import('./refgamesIndex.ts');
    indexPositions(join(refDir, 'elite.sqlite'));

    const compareApp = new Hono().route(
      '/api',
      myGamesApi(games, join(dir, 'compare-index.sqlite'), refDir),
    );
    const res = await compareApp.request('/api/mygames/compare?side=white&db=elite');
    expect(res.status).toBe(200);
    const { rows, banded: unbandedAsk } = (await res.json()) as {
      rows: { sans: string[]; games: number; myMove: { san: string; total: number }; top: { san: string } }[];
      banded: boolean;
    };
    expect(unbandedAsk).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sans: [],
      games: 1,
      myMove: { san: 'd4', total: 0 },
      top: { san: 'e4' },
    });

    // A band the corpus sits outside empties the sample — no flags, not
    // false ones — and the band WAS applied, so the answer says so.
    const banded = await compareApp.request(
      '/api/mygames/compare?side=white&db=elite&band=1200-1599',
    );
    expect((await banded.json()) as object).toMatchObject({ banded: true, rows: [] });
    // Off-bucket bands are refused, not silently approximated.
    expect(
      (await compareApp.request('/api/mygames/compare?side=white&db=elite&band=1250-1599')).status,
    ).toBe(400);

    // Sums from before the bucket column cannot slice by level: the
    // rows come back corpus-wide and `banded: false` says so, rather
    // than letting a UI label them "at your level".
    copyFileSync(join(refDir, 'elite.sqlite'), join(refDir, 'legacy.sqlite'));
    const legacy = new Database(join(refDir, 'legacy.sqlite'));
    legacy.exec(`
      CREATE TABLE mc AS SELECT pos, uci, SUM(w) AS w, SUM(d) AS d, SUM(b) AS b
        FROM move_counts GROUP BY pos, uci;
      DROP TABLE move_counts;
      ALTER TABLE mc RENAME TO move_counts;
    `);
    legacy.close();
    const unbucketed = (await (
      await compareApp.request('/api/mygames/compare?side=white&db=legacy&band=1200-1599')
    ).json()) as { banded: boolean; rows: { myMove: { san: string } }[] };
    expect(unbucketed.banded).toBe(false);
    expect(unbucketed.rows).toHaveLength(1); // the corpus-wide answer, flagged honestly
    expect(unbucketed.rows[0]!.myMove.san).toBe('d4');
  });

  it('keeps both seats of a game browsed from both archives', async () => {
    // The archive browser caches ANY player's months, so browsing your
    // opponent as well as yourself files one game twice — under opposite
    // sides. Those are not a kept copy and its original: merging them
    // would answer "games I had White in" with the row filed under Black.
    const link = 'https://www.chess.com/game/live/13';
    const pgn = `[Link "${link}"]\n${game({ white: 'me', black: 'foe', result: '1-0', date: '2026.06.20', tc: '600', moves: '1. e4 e5 2. Bc4' })}`;
    mkdirSync(join(games, 'chesscom', 'foe'), { recursive: true });
    writeFileSync(join(games, 'chesscom', 'me', '2026-06.pgn'), pgn);
    writeFileSync(join(games, 'chesscom', 'foe', '2026-06.pgn'), pgn);

    // Six games held, and the pair shows up under both seats: the three
    // the fixture gives White plus this one, and the fixture's one Black
    // game plus the opponent's filing of the same game.
    expect((await held()).games).toBe(6);
    expect((await held('side=white')).matching).toBe(4);
    expect((await held('side=black')).matching).toBe(2);
  });

  it('answers many positions in one request, under the same filters', async () => {
    const pos = Chess.default();
    pos.play(parseSan(pos, 'e4')!);
    const afterE4 = makeFen(pos.toSetup());
    const res = await app.request('/api/mygames/explore-batch?side=white', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fens: [INITIAL_FEN, afterE4, 'garbage'] }),
    });
    expect(res.status).toBe(200);
    const { positions } = (await res.json()) as {
      positions: { fen: string; moves: { san: string; total: number }[] }[];
    };
    // Every asked position answers, keyed by the fen that asked — a bad
    // one answers empty rather than failing the batch.
    expect(positions.map((p) => p.fen)).toEqual([INITIAL_FEN, afterE4, 'garbage']);
    // As White I opened 1.e4 twice and 1.d4 once; my game as Black is out.
    expect(positions[0]!.moves.map((m) => [m.san, m.total])).toEqual([['e4', 2], ['d4', 1]]);
    // The replies I faced after 1.e4: one e5, one c5.
    expect(positions[1]!.moves.map((m) => m.san).sort()).toEqual(['c5', 'e5']);
    expect(positions[2]!.moves).toEqual([]);
  });

  it('rejects a shapeless batch request', async () => {
    const post = (body: unknown) =>
      app.request('/api/mygames/explore-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post({})).status).toBe(400);
    expect((await post({ fens: 'one' })).status).toBe(400);
    expect((await post({ fens: Array.from({ length: 257 }, () => INITIAL_FEN) })).status).toBe(400);
  });

  it('rejects a shapeless deviations request', async () => {
    const post = (body: unknown) =>
      app.request('/api/mygames/deviations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post({ side: 'white' })).status).toBe(400);
    expect((await post({ keys: [], side: 'white' })).status).toBe(400);
    expect((await post({ keys: ['zz'], side: 'white' })).status).toBe(400);
    expect((await post({ keys: ['ab12'], side: 'purple' })).status).toBe(400);
  });

  it('refuses a request with no position', async () => {
    expect((await app.request('/api/mygames')).status).toBe(400);
    expect((await app.request('/api/mygames?fen=not-a-fen')).status).toBe(400);
  });

  it('answers an empty vault rather than failing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mygames-empty-'));
    const solo = new Hono().route(
      '/api',
      myGamesApi(join(empty, 'games'), join(empty, 'index.sqlite')),
    );
    const res = await solo.request(`/api/mygames?fen=${encodeURIComponent(INITIAL_FEN)}`);
    expect(res.status).toBe(200);
    expect((await res.json()).moves).toEqual([]);
  });
});
