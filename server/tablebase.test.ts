import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { INITIAL_FEN } from 'chessops/fen';
import {
  cachePath,
  lichessTablebase,
  normalizeTablebase,
  rankMoves,
  tablebaseApi,
  tablebaseFen,
  type LichessTablebaseResponse,
  type TablebaseAnswer,
  type TablebaseMove,
  type TablebaseProbe,
} from './tablebase.ts';

/** KQ vs K, white to move and winning. */
const KQK = '8/8/8/4k3/8/8/8/K1Q5 w - - 0 1';

/**
 * An answer for KQK in the shape Lichess sends: three of its legal moves,
 * with distances chosen to exercise the ordering rather than copied from
 * the real tables (Kb1 does not draw a queen ending).
 */
const SAMPLE: LichessTablebaseResponse = {
  category: 'win',
  dtz: 1,
  dtm: 17,
  checkmate: false,
  stalemate: false,
  moves: [
    // Upstream reports every move from the POINT OF VIEW OF THE REPLY,
    // so the winning ones are the ones marked `loss`.
    { uci: 'c1c5', san: 'Qc5+', category: 'loss', dtz: -14, dtm: -15, zeroing: false },
    { uci: 'c1e3', san: 'Qe3+', category: 'loss', dtz: -2, dtm: -3, zeroing: false },
    { uci: 'a1b1', san: 'Kb1', category: 'draw', dtz: 0, dtm: 0, zeroing: false },
  ],
};

const move = (patch: Partial<TablebaseMove>): TablebaseMove => ({
  uci: 'a1a2',
  san: 'Ka2',
  category: 'draw',
  dtz: null,
  dtm: null,
  zeroing: false,
  checkmate: false,
  stalemate: false,
  ...patch,
});

describe('tablebaseFen', () => {
  it('keeps the halfmove clock and flattens the fullmove number', () => {
    // Two positions that differ only in whose move number it is share one
    // answer; the same position half a fifty-move rule later does not.
    expect(tablebaseFen('8/8/8/4k3/8/8/8/K1Q5 w - - 4 30')).toBe('8/8/8/4k3/8/8/8/K1Q5 w - - 4 1');
    expect(tablebaseFen(KQK)).not.toBe(tablebaseFen('8/8/8/4k3/8/8/8/K1Q5 w - - 99 1'));
  });

  it('rules out what no table holds', () => {
    expect(tablebaseFen(INITIAL_FEN)).toBeNull(); // 32 pieces
    expect(tablebaseFen('garbage')).toBeNull();
    // Eight pieces is one past Syzygy.
    expect(tablebaseFen('8/8/8/8/4k3/8/PPPP4/KQR5 w - - 0 1')).toBeNull();
    // Legal, small, and still not describable: the tables are built
    // without castling rights.
    expect(tablebaseFen('8/8/8/8/8/8/8/R3K2k w Q - 0 1')).toBeNull();
  });
});

describe('normalizeTablebase', () => {
  it('flips each move to the point of view of whoever plays it', () => {
    const out = normalizeTablebase(SAMPLE);
    expect(out.category).toBe('win');
    expect(out.moves.map((m) => [m.san, m.category])).toEqual([
      ['Qe3+', 'win'],
      ['Qc5+', 'win'],
      ['Kb1', 'draw'],
    ]);
  });

  it('reports distances unsigned', () => {
    const out = normalizeTablebase(SAMPLE);
    expect(out.moves[0]).toMatchObject({ dtz: 2, dtm: 3, zeroing: false });
    expect(out.dtz).toBe(1);
    expect(out.dtm).toBe(17);
  });

  it('takes an unknown category rather than trusting a string', () => {
    const out = normalizeTablebase({ category: 'nonsense', moves: [{ uci: 'a1a2', san: 'Ka2' }] });
    expect(out.category).toBe('unknown');
    expect(out.moves[0]!.category).toBe('unknown');
    expect(out.moves[0]!.dtz).toBeNull();
  });
});

describe('rankMoves', () => {
  it('sorts wins shortest first and losses longest first', () => {
    const sorted = rankMoves([
      move({ san: 'slow loss', category: 'loss', dtm: 4 }),
      move({ san: 'draw', category: 'draw' }),
      move({ san: 'slow win', category: 'win', dtm: 20 }),
      move({ san: 'quick loss', category: 'loss', dtm: 2 }),
      move({ san: 'quick win', category: 'win', dtm: 6 }),
      move({ san: 'cursed', category: 'cursed-win', dtm: 3 }),
    ]);
    expect(sorted.map((m) => m.san)).toEqual([
      'quick win',
      'slow win',
      'cursed',
      'draw',
      'slow loss',
      'quick loss',
    ]);
  });

  it('breaks a tie towards the move that zeroes the counter', () => {
    const sorted = rankMoves([
      move({ san: 'quiet', category: 'win', dtz: 8 }),
      move({ san: 'capture', category: 'win', dtz: 8, zeroing: true }),
    ]);
    expect(sorted[0]!.san).toBe('capture');
  });
});

describe('the Lichess prober', () => {
  const answering = (body: unknown, status = 200): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

  it('reads a shrug as holding nothing', async () => {
    // What the server actually sends for a position past its tables: 200,
    // every legal move, and `unknown` throughout.
    const probe = lichessTablebase(
      answering({ category: 'unknown', moves: [{ uci: 'a2a3', san: 'a3', category: 'unknown' }] }),
    );
    expect(await probe.probe(KQK)).toBeNull();
  });

  it('throws when the server refuses, so nothing is cached', async () => {
    await expect(lichessTablebase(answering({}, 429)).probe(KQK)).rejects.toThrow();
  });
});

describe('tablebase route', () => {
  const cleanups: string[] = [];
  const dir = (): string => {
    const made = mkdtempSync(join(tmpdir(), 'tablebase-cache-'));
    cleanups.push(made);
    return made;
  };

  afterAll(() => {
    for (const path of cleanups) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // A leftover temp directory is not worth failing a suite over.
      }
    }
  });

  /** A prober that counts how often it was actually asked. */
  const stub = (answer: TablebaseAnswer | null | 'throw'): TablebaseProbe & { calls: number } => {
    const probe: TablebaseProbe & { calls: number } = {
      source: 'stub',
      calls: 0,
      probe: async () => {
        probe.calls += 1;
        if (answer === 'throw') throw new Error('unreachable');
        return answer;
      },
    };
    return probe;
  };

  const ANSWER = normalizeTablebase(SAMPLE);

  it('wants a FEN', async () => {
    const app = new Hono().route('/api', tablebaseApi(dir(), stub(ANSWER)));
    expect((await app.request('/api/tablebase')).status).toBe(400);
  });

  it('answers "nothing here" for a position no table holds, without asking', async () => {
    const prober = stub(ANSWER);
    const app = new Hono().route('/api', tablebaseApi(dir(), prober));
    const res = await app.request(`/api/tablebase?fen=${encodeURIComponent(INITIAL_FEN)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(prober.calls).toBe(0);
  });

  it('probes once and serves the rest from disk', async () => {
    const cacheDir = dir();
    const prober = stub(ANSWER);
    const app = new Hono().route('/api', tablebaseApi(cacheDir, prober));
    const ask = async (): Promise<Response> =>
      app.request(`/api/tablebase?fen=${encodeURIComponent(KQK)}`);

    const first = await (await ask()).json();
    expect(first).toMatchObject({ available: true, source: 'stub', category: 'win' });
    // The same position at a different move number is the same question.
    await app.request(`/api/tablebase?fen=${encodeURIComponent('8/8/8/4k3/8/8/8/K1Q5 w - - 0 9')}`);
    expect(await (await ask()).json()).toEqual(first);
    expect(prober.calls).toBe(1);
  });

  it('caches "not in my tables" too, so a miss is asked once', async () => {
    const cacheDir = dir();
    const prober = stub(null);
    const app = new Hono().route('/api', tablebaseApi(cacheDir, prober));
    const url = `/api/tablebase?fen=${encodeURIComponent(KQK)}`;
    expect(await (await app.request(url)).json()).toEqual({ available: false });
    expect(await (await app.request(url)).json()).toEqual({ available: false });
    expect(prober.calls).toBe(1);
  });

  it('reads a cache written by an earlier run without asking', async () => {
    const cacheDir = dir();
    const prober = stub('throw');
    const path = cachePath(cacheDir, 'stub', tablebaseFen(KQK)!);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ available: true, source: 'stub', ...ANSWER }));

    const app = new Hono().route('/api', tablebaseApi(cacheDir, prober));
    const res = await app.request(`/api/tablebase?fen=${encodeURIComponent(KQK)}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { category: string }).toMatchObject({ category: 'win' });
    // The stub throws if it is asked at all, so this is doubly stated.
    expect(prober.calls).toBe(0);
  });

  it('calls an unreachable source an outage, not a fault', async () => {
    const app = new Hono().route('/api', tablebaseApi(dir(), stub('throw')));
    const res = await app.request(`/api/tablebase?fen=${encodeURIComponent(KQK)}`);
    expect(res.status).toBe(502);
    expect((await res.json()) as { offline: boolean }).toMatchObject({ offline: true });
  });

  it('keeps each source in its own corner of the cache', async () => {
    const cacheDir = dir();
    const one = { ...stub(ANSWER), source: 'lichess' };
    const two = { ...stub(null), source: 'local' };
    await new Hono()
      .route('/api', tablebaseApi(cacheDir, one))
      .request(`/api/tablebase?fen=${encodeURIComponent(KQK)}`);
    const res = await new Hono()
      .route('/api', tablebaseApi(cacheDir, two))
      .request(`/api/tablebase?fen=${encodeURIComponent(KQK)}`);
    expect(await res.json()).toEqual({ available: false });
    expect(
      JSON.parse(readFileSync(cachePath(cacheDir, 'lichess', tablebaseFen(KQK)!), 'utf-8')),
    ).toMatchObject({ available: true });
  });
});
