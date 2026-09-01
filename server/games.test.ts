import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

  it('says a player does not exist rather than calling it offline', async () => {
    // chess.com answering 404 is chess.com telling you the handle is wrong.
    // Folded into "offline" it came back as an empty archive with no error
    // at all, and the panel showed the same prompt it shows before you
    // have typed anything.
    globalThis.fetch = (() =>
      Promise.resolve(new Response('not found', { status: 404 }))) as typeof fetch;

    const res = await app.request('/api/games/archive/months?user=nobodyhere');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no player called/i);
  });

  it('still calls a network failure offline, and keeps the cached months', async () => {
    // The other half of the same distinction: anything that is not the
    // upstream saying "no such player" leaves the cache browsable.
    globalThis.fetch = (() => Promise.reject(new Error('ENOTFOUND'))) as unknown as typeof fetch;

    const body = await (await app.request('/api/games/archive/months?user=lanph3re')).json();
    expect(body.offline).toBe(true);
    expect(body.months.length).toBeGreaterThan(0);
  });

  it('sends the newest month with the list that names it', async () => {
    // Two round trips before a single game appeared: the list says which
    // months exist, and only then can a month be asked for. The second
    // one is answered here instead, where the two ends are a machine
    // apart rather than a phone's link apart.
    const asked: string[] = [];
    globalThis.fetch = ((url: string) => {
      asked.push(String(url));
      if (String(url).endsWith('/games/archives')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              archives: [
                'https://api.chess.com/pub/player/lanph3re/games/2026/06',
                'https://api.chess.com/pub/player/lanph3re/games/2026/07',
              ],
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (String(url).endsWith('/stats')) {
        return Promise.resolve(
          new Response(JSON.stringify({ chess_blitz: { record: { win: 2, loss: 1, draw: 0 } } }), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ games: [{ pgn: MONTH_PGN }] }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const body = await (await app.request('/api/games/archive/months?user=lanph3re')).json();
    // Newest first, and the games of that one came along with it.
    expect(body.months[0].month).toBe('2026-07');
    expect(body.newest.month).toBe('2026-07');
    expect(body.newest.games.length).toBeGreaterThan(0);
    // And they are the SAME games the month route serves, which is the
    // whole claim: the client can stop asking for them separately. Equal
    // by construction — the list answers by asking that very route — and
    // this is what would catch it being answered some other way.
    const direct = await (
      await app.request('/api/games/archive/month?user=lanph3re&month=2026-07')
    ).json();
    expect(body.newest.games).toEqual(direct.games);
    // Whether a fetch happened is not the point and depends on what is
    // already on disk; that the caching was reused rather than reimplemented
    // is, and it is why this asks through the route.
    expect(asked.length).toBeGreaterThan(0);
  });

  it('serves a month newest game first, whichever site it came from', async () => {
    // The browser showed the archive oldest game first. Both sites feed
    // one list, and they do not agree on order — chess.com sends a month
    // oldest first, lichess newest first — so flipping in the client was
    // right for one and backwards for the other, and skipped entirely for
    // the month that arrives prefetched with the list. The route is where
    // the two are made to agree. `index` still points into the file, so
    // adding a game is unaffected by the order it is shown in.
    const chesscom = await (
      await app.request('/api/games/archive/month?user=lanph3re&month=2026-07')
    ).json();
    expect(chesscom.games.map((g: { date: string }) => g.date)).toEqual([
      '2026.07.09',
      '2026.07.03',
    ]);
    expect(chesscom.games[0].index).toBe(1);

    // Lichess writes its file newest first already, so this one is proof
    // that the route does NOT flip a second time.
    const lichess = await (
      await app.request('/api/games/lichess/month?user=someone&month=2026-06')
    ).json();
    expect(lichess.games.map((g: { index: number }) => g.index)).toEqual([0, 1]);
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

/**
 * Old collections carry stamps from before the profile guard: sides
 * missing from Lichess collects, and strangers' seats claimed as
 * yours. Boot heals them from the profile — and leaves alone the one
 * stamp it cannot re-derive, a hand-imported game's own word.
 */
/**
 * Taking one browsed player and leaving the rest.
 *
 * Its own vault rather than a case inside the archive-cache suite above,
 * whose last test clears the lot: a delete test that runs before that one
 * would be asserting against whatever it had already taken away.
 */
describe('dropping one cached player', () => {
  let dir: string;
  let app: Hono;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'games-cache-one-'));
    for (const [provider, user] of [
      ['chesscom', 'lanph3re'],
      ['chesscom', 'curious'],
      ['lichess', 'someone'],
    ] as const) {
      mkdirSync(join(dir, provider, user), { recursive: true });
      writeFileSync(join(dir, provider, user, '2026-07.pgn'), MONTH_PGN);
    }
    // The meta dotfile the month fetch leaves beside the games: it goes
    // with them, but it is not what the freed bytes are counted from.
    writeFileSync(join(dir, 'chesscom', 'curious', '.cache.json'), '{"months":{}}');
    app = new Hono().route('/api', gamesApi(dir));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('takes the named player and nothing else', async () => {
    const res = await app.request('/api/games/cache?provider=chesscom&user=curious', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).bytes).toBe(MONTH_PGN.length);
    expect(existsSync(join(dir, 'chesscom', 'curious'))).toBe(false);

    const body = await (await app.request('/api/games/cache')).json();
    expect(body.users.map((u: { user: string }) => u.user).sort()).toEqual(['lanph3re', 'someone']);
  });

  it('says nothing was freed for a player it is not holding', async () => {
    const res = await app.request('/api/games/cache?provider=lichess&user=nobodyhere', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).bytes).toBe(0);
  });

  it('refuses a name that could not have come from the listing', async () => {
    // A provider the cache does not use, half a player, and a name
    // climbing out of the provider directory — each refused rather than
    // resolved, since resolving it is how the vault above loses a
    // directory nobody asked about.
    for (const query of [
      '?provider=collection&user=lanph3re',
      '?provider=chesscom',
      '?user=lanph3re',
      '?provider=chesscom&user=..',
      '?provider=chesscom&user=../../collection',
    ]) {
      expect((await app.request(`/api/games/cache${query}`, { method: 'DELETE' })).status).toBe(400);
    }
    expect(existsSync(join(dir, 'chesscom', 'lanph3re'))).toBe(true);
  });
});

describe('healing VaultSide at boot', () => {
  let dir: string;
  let app: Hono;

  const kept = (headers: string[]): string => `${headers.join('\n')}\n\n1. e4 e5 1-0\n`;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'games-heal-'));
    const collection = join(dir, 'collection');
    mkdirSync(collection, { recursive: true });
    // A stranger's archive game, stamped by the old path-trusting collect.
    writeFileSync(
      join(collection, 'stranger.pgn'),
      kept(['[White "somegm"]', '[Black "rival"]', '[Site "Chess.com"]', '[Result "1-0"]', '[VaultSide "white"]']),
    );
    // Your own Lichess game, never stamped (only chesscom/ paths were).
    writeFileSync(
      join(collection, 'mylichess.pgn'),
      kept(['[White "other"]', '[Black "lanph3re"]', '[Site "https://lichess.org/abc"]', '[Result "1-0"]']),
    );
    // A hand-imported game that states its side outright: no archive
    // provenance, players matching no handle — its word stands.
    writeFileSync(
      join(collection, 'otb.pgn'),
      kept(['[White "Me, Really"]', '[Black "Club Rival"]', '[Result "1-0"]', '[VaultSide "black"]']),
    );
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ profile: { lichess: 'lanph3re' } }));
    app = new Hono().route('/api', gamesApi(dir, configPath));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('re-derives every kept game from the profile', async () => {
    const { games } = await (await app.request('/api/games')).json();
    const side = (white: string) =>
      games.find((g: { white: string }) => g.white === white)?.userSide;
    expect(side('somegm')).toBe(null); // stripped: archive game, nobody you claimed
    expect(side('other')).toBe('black'); // gained: your handle, at last
    expect(side('Me, Really')).toBe('black'); // kept: said outright, not ours to take
  });

  it('re-derives again when the profile changes, no restart needed', async () => {
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ profile: { lichess: 'lanph3re', chesscom: 'somegm' } }));
    // The heal keys off config.json's mtime; make the change unmissable.
    utimesSync(configPath, new Date(), new Date(Date.now() + 1000));
    const { games } = await (await app.request('/api/games')).json();
    expect(games.find((g: { white: string }) => g.white === 'somegm')?.userSide).toBe('white');
  });
});
