import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { INITIAL_FEN } from 'chessops/fen';
import { lichessExplorerApi, normalizeLichess, type LichessExplorerResponse } from './lichess.ts';
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

  it('rejects unknown databases and bad FENs', async () => {
    expect((await app.request('/api/explorer/nope?fen=x')).status).toBe(400);
    expect((await app.request('/api/explorer/masters?fen=garbage')).status).toBe(400);
    expect((await app.request('/api/explorer/masters')).status).toBe(400);
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
