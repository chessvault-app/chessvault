import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { makeUci, parseUci } from 'chessops/util';
import type { Color } from 'chessops/types';
import { endgameDrillApi, holds, summarise } from './endgameDrill.ts';
import type { TablebaseAnswer, TablebaseMove, TablebaseProbe } from './tablebase.ts';

/**
 * A table that knows one ending: a queen against a bare king. The side
 * with the queen wins, the bare king loses, anything else is a draw.
 * Of the winner's moves the first legal one (in chessops' order) keeps
 * the win and the rest throw it; every move of the loser loses, the
 * first ranked best. Fixed rather than true, so the routes are held to
 * what they do with a verdict, not to Syzygy.
 */
function oracle(fen: string): TablebaseAnswer | null {
  const setup = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  const board = setup.board;
  const queenOf = (color: Color) => board.queen.intersect(board[color]).nonEmpty();
  const bare = (color: Color) => board[color].diff(board.king).isEmpty();
  const mover = setup.turn;
  const other: Color = mover === 'white' ? 'black' : 'white';
  const category: TablebaseAnswer['category'] =
    queenOf(mover) && bare(other) ? 'win' : bare(mover) && queenOf(other) ? 'loss' : 'draw';
  const moves: TablebaseMove[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const move = { from, to };
      moves.push({
        uci: makeUci(move),
        san: makeSan(pos, move),
        category: category === 'win' ? (moves.length === 0 ? 'win' : 'draw') : category,
        dtz: 10,
        dtm: 10,
        zeroing: false,
        checkmate: false,
        stalemate: false,
      });
    }
  }
  return { category, dtz: 10, dtm: 10, checkmate: pos.isCheckmate(), stalemate: pos.isStalemate(), moves };
}

const fixed = (probe: (fen: string) => Promise<TablebaseAnswer | null>): TablebaseProbe => ({
  source: 'test',
  probe,
});

const KQK = { white: { q: [1, 1], r: [0, 0], b: [0, 0], n: [0, 0], p: [0, 0] }, black: { q: [0, 0], r: [0, 0], b: [0, 0], n: [0, 0], p: [0, 0] } };

/** Black to move, queen against king: the bare side, which cannot win. */
const KQK_WHITE = '8/8/8/4k3/8/8/8/K1Q5 w - - 0 1';
/** Kf6 and Qg1 against Kh8: Qg7 mates. */
const MATE_IN_ONE = '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('endgame drill', () => {
  let dir: string;
  let app: Hono;
  let probes: string[];
  const build = (prober: (() => TablebaseProbe | null) | null) => {
    app = new Hono();
    app.route('/api', endgameDrillApi(join(dir, 'state'), prober, join(dir, 'cache'), rng(1)));
  };
  const get = (path: string) => app.request(path);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const draw = (spec: unknown) => get(`/api/endgames/draw?spec=${encodeURIComponent(JSON.stringify(spec))}`);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'endgame-drill-'));
    probes = [];
    build(() =>
      fixed(async (fen) => {
        probes.push(fen);
        return oracle(fen);
      }),
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('draw', () => {
    it('hands over a position the table calls a win for the side to move', async () => {
      const res = await draw(KQK);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { fen: string; side: Color; source: string };
      const setup = parseFen(body.fen).unwrap();
      expect(body.side).toBe(setup.turn);
      expect(setup.board.occupied.size()).toBe(3);
      // The queen is the mover's, whichever colour the draw turned the
      // preset round to.
      expect(setup.board.queen.intersect(setup.board[setup.turn]).nonEmpty()).toBe(true);
      expect(body.source).toBe('test');
      expect(probes.length).toBeGreaterThan(0);
    });

    it('refuses a spec that does not parse or cannot fit under seven men', async () => {
      expect((await get('/api/endgames/draw?spec=nonsense')).status).toBe(400);
      const big = await draw({ white: { q: [3, 3] }, black: { q: [3, 3] } });
      expect(big.status).toBe(400);
      expect(((await big.json()) as { reason: string }).reason).toBe('too-many');
    });

    it('says when there is no source at all, and names the setting', async () => {
      build(null);
      const res = await draw(KQK);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { reason: string; error: string };
      expect(body.reason).toBe('no-tablebase');
      expect(body.error).toContain('Settings');
    });

    it('tells a source that cannot be reached from one that holds nothing', async () => {
      build(() =>
        fixed(async () => {
          throw new Error('down');
        }),
      );
      const down = await draw(KQK);
      expect(down.status).toBe(502);
      expect(((await down.json()) as { reason: string }).reason).toBe('unreachable');

      // Asked second: an outage writes nothing to the cache, so the
      // empty source is asked about the same candidates afresh.
      build(() => fixed(async () => null));
      const empty = await draw(KQK);
      expect(empty.status).toBe(503);
      expect(((await empty.json()) as { reason: string }).reason).toBe('no-table');
    });

    it('gives up on material the table never calls a win', async () => {
      // Two bare kings and a rook each: the oracle knows no rook endings.
      const res = await draw({ white: { r: [1, 1], p: [0, 0] }, black: { r: [1, 1], p: [0, 0] } });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { reason: string }).reason).toBe('none-found');
    });

    it('goes through the tablebase cache, so a position is asked about once', async () => {
      await draw(KQK);
      const asked = probes.length;
      // The same dice again: the second draw walks the same candidates
      // and finds every one on disk.
      build(() =>
        fixed(async (fen) => {
          probes.push(fen);
          return oracle(fen);
        }),
      );
      const again = await draw(KQK);
      expect(again.status).toBe(200);
      expect(probes.length).toBe(asked);
    });
  });

  describe('move', () => {
    const legal = (fen: string): string[] => {
      const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
      const out: string[] = [];
      for (const [from, dests] of pos.allDests()) for (const to of dests) out.push(makeUci({ from, to }));
      return out;
    };

    it('holds a winning move and answers with the defender\'s reply', async () => {
      const [keep] = legal(KQK_WHITE);
      const res = await post('/api/endgames/move', { fen: KQK_WHITE, uci: keep });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        verdict: string;
        san: string;
        reply: { uci: string; san: string };
        fen: string;
      };
      expect(body.verdict).toBe('held');
      expect(body.san).not.toBe('');
      expect(parseFen(body.fen).unwrap().turn).toBe('white');
      // The reply is a legal black move from the position the solver left.
      const afterMine = Chess.fromSetup(parseFen(KQK_WHITE).unwrap()).unwrap();
      afterMine.play(parseUci(keep!)!);
      expect(afterMine.isLegal(parseUci(body.reply.uci)!)).toBe(true);
    });

    it('ends the attempt on a move that throws the win, naming the one that kept it', async () => {
      const [keep, throwaway] = legal(KQK_WHITE);
      const res = await post('/api/endgames/move', { fen: KQK_WHITE, uci: throwaway });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { verdict: string; category: string; best: { uci: string; san: string } };
      expect(body.verdict).toBe('threw');
      expect(body.category).toBe('draw');
      expect(body.best.uci).toBe(keep);
    });

    it('calls checkmate a win whatever the table would have ranked it', async () => {
      const res = await post('/api/endgames/move', { fen: MATE_IN_ONE, uci: 'g1g7' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { verdict: string; san: string };
      expect(body.verdict).toBe('won');
      expect(body.san).toBe('Qg7#');
    });

    it('refuses an illegal move before asking anybody', async () => {
      const res = await post('/api/endgames/move', { fen: KQK_WHITE, uci: 'a1a8' });
      expect(res.status).toBe(400);
      expect(probes).toEqual([]);
      expect((await post('/api/endgames/move', { fen: 'garbage', uci: 'e2e4' })).status).toBe(400);
    });

    it('says so when no source answers', async () => {
      build(null);
      const res = await post('/api/endgames/move', { fen: KQK_WHITE, uci: legal(KQK_WHITE)[0] });
      expect(res.status).toBe(503);
    });
  });

  describe('the record', () => {
    it('keeps attempts per class and says which was last', async () => {
      const okay = await post('/api/endgames/attempt', {
        class: 'queen',
        side: 'white',
        fen: KQK_WHITE,
        win: true,
        plies: 9,
      });
      expect(okay.status).toBe(200);
      await post('/api/endgames/attempt', { class: 'queen', side: 'black', fen: KQK_WHITE, win: false, plies: 2 });
      await post('/api/endgames/attempt', {
        class: 'custom',
        spec: JSON.stringify({ white: { r: [1, 1] }, black: {} }),
        side: 'white',
        fen: KQK_WHITE,
        win: true,
        plies: 4,
      });
      const progress = (await (await get('/api/endgames/progress')).json()) as {
        classes: Record<string, { attempts: number; wins: number }>;
        last: { class: string } | null;
      };
      expect(progress.classes.queen).toMatchObject({ attempts: 2, wins: 1 });
      expect(progress.classes.custom).toMatchObject({ attempts: 1, wins: 1 });
      expect(progress.last?.class).toBe('custom');
      // The custom spec is stored in its canonical form, not as sent.
      const lines = readFileSync(join(dir, 'state', 'endgames.jsonl'), 'utf-8').trimEnd().split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[2]!).spec).toBe(
        JSON.stringify({ white: { r: [1, 1] }, black: {}, diff: {}, stable: 1 }),
      );
    });

    it('refuses a malformed attempt', async () => {
      expect((await post('/api/endgames/attempt', { class: 'queen', win: true })).status).toBe(400);
      expect(
        (await post('/api/endgames/attempt', { class: 'x', side: 'white', fen: KQK_WHITE, win: true, plies: -1 }))
          .status,
      ).toBe(400);
    });

    it('can be forgotten from the app', async () => {
      await post('/api/endgames/attempt', { class: 'queen', side: 'white', fen: KQK_WHITE, win: true, plies: 9 });
      expect((await post('/api/endgames/reset', {})).status).toBe(200);
      const progress = (await (await get('/api/endgames/progress')).json()) as { classes: object; last: null };
      expect(progress).toEqual({ classes: {}, last: null });
    });

    it('drops a torn line and keeps the rest', () => {
      expect(
        summarise([
          { class: 'rook', side: 'white', fen: KQK_WHITE, win: false, plies: 1, at: '2026-09-01T00:00:00Z' },
          { class: 'rook', side: 'white', fen: KQK_WHITE, win: true, plies: 12, at: '2026-09-02T00:00:00Z' },
        ]),
      ).toEqual({
        classes: { rook: { attempts: 2, wins: 1, lastAt: '2026-09-02T00:00:00Z' } },
        last: { class: 'rook', at: '2026-09-02T00:00:00Z' },
      });
    });
  });

  it('counts a win and a maybe-win as holding, and everything else as thrown', () => {
    expect(holds('win')).toBe(true);
    expect(holds('maybe-win')).toBe(true);
    expect(holds('cursed-win')).toBe(false);
    expect(holds('draw')).toBe(false);
    expect(holds('loss')).toBe(false);
  });
});
