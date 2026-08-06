import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

1. d4 Nf6 0-1
`;

describe('games api', () => {
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

  it('lists games newest first with header metadata', async () => {
    const res = await app.request('/api/games');
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.games[0]).toMatchObject({
      white: 'someone',
      black: 'lanph3re',
      result: '0-1',
      date: '2026.07.09',
    });
    expect(body.games[1]).toMatchObject({
      white: 'lanph3re',
      result: '1-0',
      eco: 'B01',
      link: 'https://www.chess.com/game/live/1',
      index: 0,
    });
  });

  it('serves a single game as PGN, clock comments intact', async () => {
    const file = encodeURIComponent(join('chesscom', 'lanph3re', '2026-07.pgn'));
    const res = await app.request(`/api/games/pgn?file=${file}&index=0`);
    const { pgn } = await res.json();
    expect(pgn).toContain('1. e4 d5 2. exd5 { [%clk 0:09:58.1] } Qxd5 1-0');
    expect(pgn).toContain('[White "lanph3re"]');
  });

  it('rejects traversal and unknown files', async () => {
    expect((await app.request('/api/games/pgn?file=..%2Fsecrets.pgn&index=0')).status).toBe(404);
    expect((await app.request('/api/games/pgn?file=%2Fetc%2Fpasswd&index=0')).status).toBe(404);
    expect((await app.request('/api/games/pgn?file=nope.pgn&index=0')).status).toBe(404);
  });

  it('rejects bad import usernames', async () => {
    const res = await app.request('/api/games/import/chesscom', {
      method: 'POST',
      body: JSON.stringify({ username: '../evil' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
