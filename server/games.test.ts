import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gamesApi } from './games.ts';

const MONTH_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "lanph3re"]
[Black "someone"]
[Result "1-0"]
[UTCDate "2026.07.03"]
[WhiteElo "1500"]
[BlackElo "1490"]
[TimeControl "600"]
[ECO "B01"]
[Link "https://www.chess.com/game/live/1"]

1. e4 d5 2. exd5 {[%clk 0:09:58.1]} Qxd5 1-0

[Event "Live Chess"]
[Site "Chess.com"]
[White "someone"]
[Black "lanph3re"]
[Result "0-1"]
[UTCDate "2026.07.09"]
[WhiteElo "1488"]
[BlackElo "1505"]
[TimeControl "600"]

1. d4 Nf6 {A good square for the knight.} 0-1
`;

describe('games api (collection model)', () => {
  let dir: string;
  let app: Hono;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'games-api-'));
    mkdirSync(join(dir, 'chesscom', 'lanph3re'), { recursive: true });
    writeFileSync(join(dir, 'chesscom', 'lanph3re', '2026-07.pgn'), MONTH_PGN);
    // The vault side is only stamped for the profile's own archives, so
    // the tests claim the handle the fixtures use.
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ profile: { chesscom: 'lanph3re', lichess: 'lanph3re' } }));
    app = new Hono().route('/api', gamesApi(dir, configPath));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts with an empty collection', async () => {
    const { games } = await (await app.request('/api/games')).json();
    expect(games).toEqual([]);
  });

  it('collects a game with the vault side recorded from the archive path', async () => {
    const res = await app.request('/api/games/collect', {
      method: 'POST',
      body: JSON.stringify({ file: 'chesscom/lanph3re/2026-07.pgn', index: 0 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('lanph3re vs someone 2026-07-03');
    expect(existsSync(join(dir, 'collection', 'lanph3re vs someone 2026-07-03.pgn'))).toBe(true);

    const { games } = await (await app.request('/api/games')).json();
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      white: 'lanph3re',
      userSide: 'white', // from the VaultSide header written at collect time
      annotated: false, // clock comments alone are not annotations
    });
  });

  it('stamps the side for a Lichess archive too', async () => {
    // Only chess.com paths were stamped, so your own Lichess games
    // landed in the collection with no side at all.
    mkdirSync(join(dir, 'lichess', 'lanph3re'), { recursive: true });
    writeFileSync(
      join(dir, 'lichess', 'lanph3re', '2026-06.pgn'),
      '[White "other"]\n[Black "lanph3re"]\n[Result "0-1"]\n[UTCDate "2026.06.01"]\n\n1. e4 e5 0-1\n',
    );
    await app.request('/api/games/collect', {
      method: 'POST',
      body: JSON.stringify({ file: 'lichess/lanph3re/2026-06.pgn', index: 0 }),
      headers: { 'content-type': 'application/json' },
    });
    const { games } = await (await app.request('/api/games')).json();
    const lichess = games.find((g: { white: string }) => g.white === 'other');
    expect(lichess).toMatchObject({ userSide: 'black' });
  });

  it("keeps another player's archive games as reference (no side)", async () => {
    // The browser searches any handle; only the profile's own archive
    // may claim a seat, or "mine" filters would own a stranger's games.
    mkdirSync(join(dir, 'chesscom', 'somegm'), { recursive: true });
    writeFileSync(
      join(dir, 'chesscom', 'somegm', '2026-05.pgn'),
      '[White "somegm"]\n[Black "rival"]\n[Result "1-0"]\n[UTCDate "2026.05.02"]\n\n1. d4 d5 1-0\n',
    );
    await app.request('/api/games/collect', {
      method: 'POST',
      body: JSON.stringify({ file: 'chesscom/somegm/2026-05.pgn', index: 0 }),
      headers: { 'content-type': 'application/json' },
    });
    const { games } = await (await app.request('/api/games')).json();
    const kept = games.find((g: { white: string }) => g.white === 'somegm');
    expect(kept).toMatchObject({ userSide: null });
  });

  it('detects real annotations (text comments) in collected games', async () => {
    await app.request('/api/games/collect', {
      method: 'POST',
      body: JSON.stringify({ file: 'chesscom/lanph3re/2026-07.pgn', index: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    const { games } = await (await app.request('/api/games')).json();
    const second = games.find((g: { black: string }) => g.black === 'lanph3re');
    expect(second).toMatchObject({ userSide: 'black', annotated: true });
  });

  it('dedupes collection names', async () => {
    const res = await app.request('/api/games/collect', {
      method: 'POST',
      body: JSON.stringify({ file: 'chesscom/lanph3re/2026-07.pgn', index: 0 }),
      headers: { 'content-type': 'application/json' },
    });
    expect((await res.json()).id).toBe('lanph3re vs someone 2026-07-03 (2)');
  });

  it('collects a raw PGN (elite reference game) as a document', async () => {
    const pgn =
      '[White "Carlsen"]\n[Black "Caruana"]\n[Date "2024.01.05"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n';
    const res = await app.request('/api/games/collect-pgn', {
      method: 'POST',
      body: JSON.stringify({ pgn }),
      headers: { 'content-type': 'application/json' },
    });
    expect((await res.json()).id).toBe('Carlsen vs Caruana 2024-01-05');
    expect(existsSync(join(dir, 'collection', 'Carlsen vs Caruana 2024-01-05.pgn'))).toBe(true);

    // The same reference game must not pile up copies.
    const dupe = await app.request('/api/games/collect-pgn', {
      method: 'POST',
      body: JSON.stringify({ pgn }),
      headers: { 'content-type': 'application/json' },
    });
    expect(dupe.status).toBe(409);

    const bad = await app.request('/api/games/collect-pgn', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(bad.status).toBe(400);
  });

  it('serves single games with clock comments intact', async () => {
    const res = await app.request(
      `/api/games/pgn?file=${encodeURIComponent('chesscom/lanph3re/2026-07.pgn')}&index=0`,
    );
    const { pgn } = await res.json();
    expect(pgn).toContain('[%clk 0:09:58.1]');
  });

  it('rejects traversal everywhere', async () => {
    expect(
      (await app.request('/api/games/pgn?file=..%2Fsecrets.pgn&index=0')).status,
    ).toBe(404);
    const res = await app.request('/api/games/collect', {
      method: 'POST',
      body: JSON.stringify({ file: '../outside.pgn', index: 0 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(404);
    expect(
      (await app.request('/api/games/archive/months?user=..%2Fevil')).status,
    ).toBe(400);
  });

  it('toggles bookmarks', async () => {
    const toggle = () =>
      app.request('/api/games/bookmarks/toggle', {
        method: 'POST',
        body: JSON.stringify({ file: 'collection/lanph3re vs someone 2026-07-03.pgn', index: 0 }),
        headers: { 'content-type': 'application/json' },
      });
    expect(((await (await toggle()).json()) as { bookmarked: boolean }).bookmarked).toBe(true);
    const { keys } = await (await app.request('/api/games/bookmarks')).json();
    expect(keys).toHaveLength(1);
    expect(((await (await toggle()).json()) as { bookmarked: boolean }).bookmarked).toBe(false);
  });
  it('adds several archive games at once, and the whole file', async () => {
    const post = async (payload: object): Promise<Response> =>
      app.request('/api/games/collect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'chesscom/lanph3re/2026-07.pgn', ...payload }),
      });

    const many = await post({ indexes: [0, 1] });
    expect(many.status).toBe(200);
    expect((await many.json()).added).toBe(2);

    // `all` is the point of the feature: a whole month in one action.
    const whole = await post({ all: true });
    expect(whole.status).toBe(200);
    const body = await whole.json();
    expect(body.added).toBeGreaterThanOrEqual(2);
    expect(body.ids).toHaveLength(body.added);

    // Names already taken get a suffix rather than overwriting a game.
    expect(new Set(body.ids).size).toBe(body.ids.length);
  });

  it('refuses an out-of-range index instead of adding what it can', async () => {
    const res = await app.request('/api/games/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'chesscom/lanph3re/2026-07.pgn', indexes: [0, 999] }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * Browsing leaves months on disk for ever, and nothing used to say so or
 * remove them. These cover both halves: what is there, and getting rid of
 * it — plus the reason the cache exists at all, which is that a second
 * look at a month should not download it again.
 */
describe('archive cache', () => {
  let dir: string;
  let app: Hono;
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'games-cache-'));
    mkdirSync(join(dir, 'chesscom', 'lanph3re'), { recursive: true });
    writeFileSync(join(dir, 'chesscom', 'lanph3re', '2026-07.pgn'), MONTH_PGN);
    mkdirSync(join(dir, 'lichess', 'someone'), { recursive: true });
    writeFileSync(join(dir, 'lichess', 'someone', '2026-06.pgn'), MONTH_PGN);
    app = new Hono().route('/api', gamesApi(dir));
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports every player browsing has cached, largest first', async () => {
    const body = await (await app.request('/api/games/cache')).json();
    expect(body.users).toHaveLength(2);
    expect(body.users.map((u: { user: string }) => u.user).sort()).toEqual(['lanph3re', 'someone']);
    expect(body.users[0].months).toBe(1);
    expect(body.bytes).toBe(MONTH_PGN.length * 2);
  });

  it('rechecks the month being played in, and keeps the cache when it has not changed', async () => {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const seen: (string | undefined)[] = [];

    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get('if-modified-since') ?? undefined);
      // First visit: the month arrives, dated. Second: nothing has
      // happened since, so chess.com says so in four bytes.
      if (seen.length === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ games: [{ pgn: MONTH_PGN }] }), {
            headers: { 'content-type': 'application/json', 'last-modified': 'Wed, 01 Jul 2026 00:00:00 GMT' },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 304 }));
    }) as typeof fetch;

    const first = await app.request(`/api/games/archive/month?user=lanph3re&month=${month}`);
    expect(first.status).toBe(200);
    expect((await first.json()).games).toHaveLength(2);

    const second = await app.request(`/api/games/archive/month?user=lanph3re&month=${month}`);
    expect(second.status).toBe(200);
    // Same games, from disk: the second request carried the date it was
    // given and got a 304, so nothing was downloaded or rewritten.
    expect((await second.json()).games).toHaveLength(2);
    expect(seen).toEqual([undefined, 'Wed, 01 Jul 2026 00:00:00 GMT']);
  });

  it('clears the lot, every provider, and reports what it freed', async () => {
    const res = await app.request('/api/games/cache', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).bytes).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'lichess', 'someone'))).toBe(false);
    expect(existsSync(join(dir, 'chesscom', 'lanph3re'))).toBe(false);
    expect((await (await app.request('/api/games/cache')).json()).users).toEqual([]);
  });
});
