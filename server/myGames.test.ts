import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INITIAL_FEN } from 'chessops/fen';
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
