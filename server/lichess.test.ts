import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

  /** Seed one cached masters answer for `fen`, aged `days` back. */
  const seed = (dir: string, fen: string, days: number, body = SAMPLE): string => {
    const epd = makeFen(Chess.fromSetup(parseFen(fen).unwrap()).unwrap().toSetup(), { epd: true });
    const path = cachePath(dir, 'masters', epd, null);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(normalizeLichess(body, 'masters')));
    const then = new Date(Date.now() - days * 24 * 3600 * 1000);
    utimesSync(path, then, then);
    return path;
  };

  const batch = (app: Hono, fens: string[]) =>
    app.request('/api/explorer/masters/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fens }),
    });

  /** The background refresh finishes a beat after the response; poll for it. */
  const until = async (check: () => boolean): Promise<boolean> => {
    for (let n = 0; n < 100; n += 1) {
      if (check()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return check();
  };

  it('answers a stale entry as it stands and refreshes it behind the response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'explorer-cache-'));
    cleanups.push(dir);
    // 8 days old, past the masters TTL of 7 — the old route left it out.
    const path = seed(dir, INITIAL_FEN, 8);
    const asked: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      asked.push(String(url));
      return Response.json({ ...SAMPLE, moves: [{ ...SAMPLE.moves[0]!, white: 999 }] });
    };
    const app = new Hono().route('/api', lichessExplorerApi(dir, fetcher, () => 'lip_test'));

    const res = await batch(app, [INITIAL_FEN]);
    expect(res.status).toBe(200);
    const { positions } = (await res.json()) as {
      positions: { fen: string; moves: { w: number }[] }[];
    };
    // The response is the stale answer, not the refreshed one: nobody
    // waits on Lichess.
    expect(positions.map((p) => p.fen)).toEqual([INITIAL_FEN]);
    expect(positions[0]!.moves[0]!.w).toBe(60);
    // The refresh lands on disk moments later, ready for the next batch.
    expect(await until(() => readFileSync(path, 'utf-8').includes('"w":999'))).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it('abandons the refresh pass on the first failure, keeping the stale answers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'explorer-cache-'));
    cleanups.push(dir);
    const second = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const paths = [seed(dir, INITIAL_FEN, 8), seed(dir, second, 8)];
    const asked: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      asked.push(String(url));
      throw new Error('network down');
    };
    const app = new Hono().route('/api', lichessExplorerApi(dir, fetcher, () => 'lip_test'));

    const res = await batch(app, [INITIAL_FEN, second]);
    const { positions } = (await res.json()) as { positions: { fen: string }[] };
    // Both stale entries still answer,
    expect(positions.map((p) => p.fen)).toEqual([INITIAL_FEN, second]);
    // one refresh was attempted, and the failure ended the pass — the
    // second entry was never asked for.
    expect(await until(() => asked.length > 0)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toHaveLength(1);
    for (const path of paths) {
      expect(readFileSync(path, 'utf-8')).toContain('"w":60');
    }
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
      // No token configured and nothing cached: a 502 with instructions,
      // and they name the place in the APP where a token goes — the file
      // it lands in is the server's business, not the reader's.
      // (If the start position were cached this would be a 200 — the cache
      // dir is derived data, so the skipIf guard keeps this test honest.)
      const body = (await res.json()) as { error?: string };
      if (res.status === 502) {
        expect(body.error).toContain('API token');
        expect(body.error).toContain('Settings');
      } else {
        expect(res.status).toBe(200); // served from disk cache
      }
    },
  );
});
