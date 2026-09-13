import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { makeUci, parseUci } from 'chessops/util';
import type { Color } from 'chessops/types';
import { MIN_WIN_PLIES, endgameDrillApi, holds, holdsDraw, oneSided, pressingReply, sharpness } from './endgameDrill.ts';
import type { TablebaseAnswer, TablebaseMove, TablebaseProbe } from './tablebase.ts';

/**
 * A table that knows two endings. A queen against a bare king: the side
 * with the queen wins, the bare king loses. Of the winner's moves the
 * first legal one (in chessops' order) keeps the win and the rest throw
 * it; every move of the loser loses, the first ranked best. A rook each
 * with nothing else: a draw, where of the mover's moves the first holds
 * and the rest lose. Anything else is a draw by every move. Fixed
 * rather than true, so the routes are held to what they do with a
 * verdict, not to Syzygy.
 */
function oracle(fen: string): TablebaseAnswer | null {
  const setup = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  const board = setup.board;
  const queenOf = (color: Color) => board.queen.intersect(board[color]).nonEmpty();
  const bare = (color: Color) => board[color].diff(board.king).isEmpty();
  const mover = setup.turn;
  const other: Color = mover === 'white' ? 'black' : 'white';
  const rookOnly = (color: Color) =>
    board[color].diff(board.king).equals(board.rook.intersect(board[color])) && board.rook.intersect(board[color]).size() === 1;
  const sharpDraw = rookOnly(mover) && rookOnly(other);
  const category: TablebaseAnswer['category'] =
    queenOf(mover) && bare(other) ? 'win' : bare(mover) && queenOf(other) ? 'loss' : 'draw';
  const moves: TablebaseMove[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const move = { from, to };
      moves.push({
        uci: makeUci(move),
        san: makeSan(pos, move),
        category:
          category === 'win'
            ? moves.length === 0
              ? 'win'
              : 'draw'
            : sharpDraw
              ? moves.length === 0
                ? 'draw'
                : 'loss'
              : category,
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
const KRKR = { white: { q: [0, 0], r: [1, 1], b: [0, 0], n: [0, 0], p: [0, 0] }, black: { q: [0, 0], r: [1, 1], b: [0, 0], n: [0, 0], p: [0, 0] } };
/** White to move, a rook each, nothing in touch. */
const KRKR_WHITE = '4k3/r7/8/8/8/8/7R/4K3 w - - 0 1';

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

  const legal = (fen: string): string[] => {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const out: string[] = [];
    for (const [from, dests] of pos.allDests()) for (const to of dests) out.push(makeUci({ from, to }));
    return out;
  };

describe('endgame drill', () => {
  let dir: string;
  let app: Hono;
  let probes: string[];
  const build = (prober: (() => TablebaseProbe | null) | null) => {
    app = new Hono();
    app.route('/api', endgameDrillApi(prober, join(dir, 'cache'), rng(1)));
  };
  const get = (path: string) => app.request(path);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const draw = (spec: unknown, goal?: string) =>
    get(`/api/endgames/draw?spec=${encodeURIComponent(JSON.stringify(spec))}${goal ? `&goal=${goal}` : ''}`);

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
      // A rook each: the oracle calls every such position a draw.
      const res = await draw(KRKR, 'win');
      expect(res.status).toBe(404);
      expect(((await res.json()) as { reason: string }).reason).toBe('none-found');
    });

    it('refuses a goal it does not know', async () => {
      expect((await draw(KQK, 'lose')).status).toBe(400);
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

  describe('defence', () => {
    it('sets the goal from the position when none is asked for, and says which', async () => {
      const won = (await (await draw(KQK)).json()) as { goal: string };
      expect(won.goal).toBe('win');
      const held = (await (await draw(KRKR)).json()) as { goal: string };
      expect(held.goal).toBe('draw');
    });

    it('draws a drawn position with something to hold, for the side to move', async () => {
      const res = await draw(KRKR, 'draw');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { fen: string; side: Color };
      const setup = parseFen(body.fen).unwrap();
      expect(body.side).toBe(setup.turn);
      expect(setup.board.rook.size()).toBe(2);
    });

    it('has nothing to hand over where every move holds or the win is the goal', async () => {
      // A queen against a king is never a draw, so the defence finds
      // nothing in it; a rook each is never a win.
      expect((await draw(KQK, 'draw')).status).toBe(404);
      expect((await draw(KRKR, 'win')).status).toBe(404);
    });

    it('counts a drawn position where nothing can go wrong as one-sided', () => {
      const answer = oracle(KRKR_WHITE)!;
      const pos = Chess.fromSetup(parseFen(KRKR_WHITE).unwrap()).unwrap();
      expect(oneSided('draw', answer, pos)).toBe(false);
      const loose = { ...answer, moves: answer.moves.map((m) => ({ ...m, category: 'draw' as const })) };
      expect(oneSided('draw', loose, pos)).toBe(true);
    });

    it('holds a move the table does not call a loss, and grades the rest as thrown', async () => {
      const [keep, throwaway] = legal(KRKR_WHITE);
      const held = await post('/api/endgames/move', { fen: KRKR_WHITE, uci: keep, goal: 'draw' });
      expect(held.status).toBe(200);
      const body = (await held.json()) as { verdict: string; reply: { uci: string } };
      expect(body.verdict).toBe('held');
      expect(body.reply.uci).toMatch(/^[a-h][1-8][a-h][1-8]$/);

      const thrown = await post('/api/endgames/move', { fen: KRKR_WHITE, uci: throwaway, goal: 'draw' });
      const verdict = (await thrown.json()) as { verdict: string; best: { uci: string } };
      expect(verdict.verdict).toBe('threw');
      expect(verdict.best.uci).toBe(keep);
    });

    it('presses with the reply that leaves the defender the fewest holding moves', async () => {
      // A table where the attacker's second move leaves the defender
      // one holding move and every other leaves them all: the second
      // is played, though the table ranks it second.
      const pos = Chess.fromSetup(parseFen(KRKR_WHITE).unwrap()).unwrap();
      const answer = oracle(KRKR_WHITE)!;
      const attackerMoves = answer.moves.map((m) => ({ ...m, category: 'draw' as const }));
      const tight = pos.clone();
      tight.play(parseUci(attackerMoves[1]!.uci)!);
      const tightFen = makeFen(tight.toSetup());
      const source = fixed(async (fen) => {
        const reached = oracle(fen)!;
        const all = reached.moves.map((m) => ({ ...m, category: 'draw' as const }));
        return { ...reached, moves: fen === tightFen ? reached.moves : all };
      });
      const chosen = await pressingReply(join(dir, 'cache'), source, pos, { ...answer, moves: attackerMoves });
      expect(chosen?.uci).toBe(attackerMoves[1]!.uci);
    });

    it('ends as drawn when the attacker has nothing left to mate with', async () => {
      // A rook giving check against a lone king that can take it: Kxf1
      // leaves two kings and the drill is over, with no reply asked for;
      // Kh2 keeps the ending going.
      const fen = '4k3/8/8/8/8/8/8/5rK1 w - - 0 1';
      build(() =>
        fixed(async (f) => {
          probes.push(f);
          const answer = oracle(f)!;
          return { ...answer, category: 'draw', moves: answer.moves.map((m) => ({ ...m, category: 'draw' as const })) };
        }),
      );
      const step = await post('/api/endgames/move', { fen, uci: 'g1h2', goal: 'draw' });
      expect(((await step.json()) as { verdict: string }).verdict).toBe('held');
      probes.length = 0;
      const take = await post('/api/endgames/move', { fen, uci: 'g1f1', goal: 'draw' });
      const body = (await take.json()) as { verdict: string; reply?: unknown };
      expect(body.verdict).toBe('drawn');
      expect(body.reply).toBeUndefined();
      // Only the position before the move was asked about, and it was cached.
      expect(probes).toEqual([]);
    });

    it('counts everything but a loss as holding the draw', () => {
      expect(holdsDraw('draw')).toBe(true);
      expect(holdsDraw('blessed-loss')).toBe(true);
      expect(holdsDraw('maybe-loss')).toBe(true);
      expect(holdsDraw('loss')).toBe(false);
      expect(holdsDraw('unknown')).toBe(false);
    });
  });

  describe('one-sided positions are not drawn', () => {
    const at = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    /** Kf6 and Qg1 against Kh8 with a black rook on a1: Qxa1 keeps the win. */
    const HANGING = '7k/8/5K2/8/8/8/8/r5Q1 w - - 0 1';

    it('rejects a win the table puts too close', () => {
      const answer = oracle(KQK_WHITE)!;
      expect(oneSided('win', { ...answer, dtm: MIN_WIN_PLIES }, at(KQK_WHITE))).toBe(false);
      expect(oneSided('win', { ...answer, dtm: MIN_WIN_PLIES - 1 }, at(KQK_WHITE))).toBe(true);
      // Without a distance to mate, the distance to zeroing stands in.
      expect(oneSided('win', { ...answer, dtm: null, dtz: 4 }, at(KQK_WHITE))).toBe(true);
      expect(oneSided('win', { ...answer, dtm: null, dtz: null }, at(KQK_WHITE))).toBe(false);
    });

    it('rejects a position where a move that keeps the win takes a piece', () => {
      const answer = oracle(KQK_WHITE)!;
      const capture: TablebaseMove = { ...answer.moves[0]!, uci: 'g1a1', san: 'Qxa1', category: 'win' };
      const quiet: TablebaseMove = { ...capture, uci: 'g1g7', san: 'Qg7' };
      expect(oneSided('win', { ...answer, moves: [capture] }, at(HANGING))).toBe(true);
      expect(oneSided('win', { ...answer, moves: [quiet] }, at(HANGING))).toBe(false);
      // A capture that throws the win is the solver's problem, not the draw's.
      expect(oneSided('win', { ...answer, moves: [{ ...capture, category: 'draw' }] }, at(HANGING))).toBe(false);
    });

    it('is applied by the draw', async () => {
      // The oracle's positions are ten plies off, on the floor; a table
      // that calls everything a mate in two has nothing to hand over.
      build(() => fixed(async (fen) => {
        const answer = oracle(fen);
        return answer && { ...answer, dtm: 3 };
      }));
      const res = await draw(KQK);
      expect(res.status).toBe(404);
    });
  });

  describe('the sharpest of the pool is drawn', () => {
    /** The oracle with the winner given `keeping` winning moves instead
        of one, so two tables of different sharpness can be compared. */
    const loose = (keeping: number) => (fen: string): TablebaseAnswer | null => {
      const answer = oracle(fen);
      if (!answer || answer.category !== 'win') return answer;
      return {
        ...answer,
        moves: answer.moves.map((m, i) => ({ ...m, category: i < keeping ? 'win' : 'draw' })),
      };
    };

    it('reads sharpness as the share of moves that keep the win, over the line', async () => {
      const source = fixed(async (fen) => loose(2)(fen));
      const root = loose(2)(KQK_WHITE)!;
      const score = await sharpness(join(dir, 'cache'), source, 'win', KQK_WHITE, root);
      // Every decision on the line has two keeping moves out of its
      // legal ones; the mean of those shares is well under a half and
      // above zero.
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.5);
      const sharper = await sharpness(join(dir, 'cache'), fixed(async (fen) => oracle(fen)), 'win', KQK_WHITE, oracle(KQK_WHITE)!);
      expect(sharper).toBeLessThan(score);
    });

    it('hands over the candidate with the fewest keeping moves', async () => {
      // The table is sharp about one position of the pool and loose
      // about the rest: whichever the dice draw first, the sharp one
      // is the one handed over.
      const seen: string[] = [];
      build(() =>
        fixed(async (fen) => {
          const answer = oracle(fen);
          if (!answer || answer.category !== 'win') return answer;
          if (!seen.includes(fen)) seen.push(fen);
          // The third acceptable root is the sharp one; every other
          // winning position keeps the win by every move.
          return seen.indexOf(fen) === 2 ? answer : loose(answer.moves.length)(fen);
        }),
      );
      const res = await draw(KQK);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { fen: string };
      expect(body.fen).toBe(seen[2]);
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
