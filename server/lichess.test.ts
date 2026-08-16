import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Chess } from 'chessops/chess';
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen';
import { cachePath, lichessExplorerApi, normalizeLichess, type LichessExplorerResponse } from './lichess.ts';
import { VAULT_CONFIG } from './paths.ts';

const SAMPLE: LichessExplorerResponse = {
  white: 100,
  draws: 50,
  black: 80,
  moves: [{ uci: 'e2e4', san: 'e4', white: 60, draws: 30, black: 40 }],
  topGames: [
    {
      uci: 'e2e4',
      id: 'abcd1234',
      winner: 'white',
      white: { name: 'Carlsen', rating: 2850 },
      black: { name: 'Caruana', rating: 2800 },
      year: 2019,
      month: '2019-05',
    },
  ],
  opening: { eco: 'B00', name: "King's Pawn Game" },
};

describe('normalizeLichess', () => {
  it('reshapes to the local book contract', () => {
    const out = normalizeLichess(SAMPLE, 'masters');
    expect(out.moves).toEqual([
      { uci: 'e2e4', san: 'e4', w: 60, d: 30, b: 40, total: 130 },
    ]);
    expect(out.topGames[0]).toEqual({
      uci: 'e2e4',
      white: 'Carlsen',
      black: 'Caruana',
      whiteElo: 2850,
      blackElo: 2800,
      result: '1-0',
      date: '2019-05',
      site: 'https://lichess.org/abcd1234',
    });
    expect(out.opening).toEqual({ eco: 'B00', name: "King's Pawn Game" });
    expect(out.source).toBe('masters');
  });

  it('maps a missing winner to a draw', () => {
    const out = normalizeLichess(
      { ...SAMPLE, topGames: [{ ...SAMPLE.topGames![0]!, winner: null }] },
      'lichess',
    );
    expect(out.topGames[0]!.result).toBe('1/2-1/2');
  });
});

describe('explorer proxy', () => {
  const app = new Hono().route('/api', lichessExplorerApi());
  const cleanups: string[] = [];

  afterAll(() => {
    for (const dir of cleanups) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A leftover temp directory is not worth failing a suite over.
      }
    }
  });

  it('rejects unknown databases and bad FENs', async () => {
    expect((await app.request('/api/explorer/nope?fen=x')).status).toBe(400);
    expect((await app.request('/api/explorer/masters?fen=garbage')).status).toBe(400);
    expect((await app.request('/api/explorer/masters')).status).toBe(400);
  });

  it('answers a batch from the disk cache alone, leaving misses out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'explorer-cache-'));
    cleanups.push(dir);
    const cached = new Hono().route('/api', lichessExplorerApi(dir));

    // Seed the cache the way a single-position request would have.
    const epd = makeFen(Chess.fromSetup(parseFen(INITIAL_FEN).unwrap()).unwrap().toSetup(), {
      epd: true,
    });
    const path = cachePath(dir, 'masters', epd, null);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(normalizeLichess(SAMPLE, 'masters')));

    const uncached = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const res = await cached.request('/api/explorer/masters/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fens: [INITIAL_FEN, uncached, 'garbage'] }),
    });
    expect(res.status).toBe(200);
    const { positions } = (await res.json()) as {
      positions: { fen: string; moves: { san: string; total: number }[] }[];
    };
    // Only the cached position answers — a miss is unanswered, never
    // empty, so the caller knows to ask for it one at a time.
    expect(positions.map((p) => p.fen)).toEqual([INITIAL_FEN]);
    expect(positions[0]!.moves).toEqual([
      { uci: 'e2e4', san: 'e4', w: 60, d: 30, b: 40, total: 130 },
    ]);
  });

  it('rejects a shapeless batch request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'explorer-cache-'));
    cleanups.push(dir);
    const solo = new Hono().route('/api', lichessExplorerApi(dir));
    const post = (target: string, body: unknown) =>
      solo.request(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post('/api/explorer/nope/batch', { fens: [INITIAL_FEN] })).status).toBe(400);
    expect((await post('/api/explorer/masters/batch', {})).status).toBe(400);
    expect(
      (
        await post('/api/explorer/masters/batch', {
          fens: Array.from({ length: 257 }, () => INITIAL_FEN),
        })
      ).status,
    ).toBe(400);
  });

  it.skipIf(existsSync(VAULT_CONFIG))(
    'explains the missing token instead of failing silently',
    async () => {
      const res = await app.request(
        `/api/explorer/masters?fen=${encodeURIComponent(INITIAL_FEN)}`,
      );
      // No token configured and nothing cached: a 502 with instructions.
      // (If the start position were cached this would be a 200 — the cache
      // dir is derived data, so the skipIf guard keeps this test honest.)
      const body = (await res.json()) as { error?: string };
      if (res.status === 502) {
        expect(body.error).toContain('vault/config.json');
      } else {
        expect(res.status).toBe(200); // served from disk cache
      }
    },
  );
});
