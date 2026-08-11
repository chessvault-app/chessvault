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
    app = new Hono().route('/api', gamesApi(dir));
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
