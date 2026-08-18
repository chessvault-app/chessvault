import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tablebaseApi } from './tablebase.ts';

/** A mate in one: Qc8# is there, a slower win is there, and a draw is there. */
const MATE_IN_ONE = 'k7/8/1K6/8/8/8/8/2Q5 w - - 0 1';
const DRAWN = '4k3/8/4K3/8/8/8/8/8 w - - 0 1';
const TOO_MANY = '4k3/pppppppp/8/8/8/8/8/4K3 w - - 0 1';

/**
 * The shape the API really returns, checked against tablebase.lichess.ovh
 * rather than assumed. The mating move is the load-bearing part: it comes
 * back with `checkmate: true` and **dtm null**, while `dtm: 0` turns up on
 * DRAWN moves. Reading null as "no mate" is what stopped the walk from
 * ever finishing.
 */
const ROOT = {
  category: 'win',
  dtz: 1,
  dtm: 1,
  checkmate: false,
  stalemate: false,
  insufficient_material: false,
  moves: [
    { uci: 'c1c8', san: 'Qc8#', category: 'loss', dtz: -1, dtm: null, checkmate: true },
    { uci: 'c1c2', san: 'Qc2', category: 'loss', dtz: -6, dtm: -6, checkmate: false },
    { uci: 'b6a6', san: 'Ka6', category: 'draw', dtz: 0, dtm: 0, checkmate: false },
    { uci: 'b6b5', san: 'Kb5', category: 'win', dtz: 8, dtm: 8, checkmate: false },
  ],
};

const MATED = {
  category: 'loss',
  dtz: 0,
  dtm: 0,
  checkmate: true,
  stalemate: false,
  insufficient_material: false,
  moves: [],
};

const DRAW_ROOT = { ...MATED, category: 'draw', checkmate: false, insufficient_material: true };

describe('tablebase lines', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tablebase-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Answers ROOT for the position asked about, and "mated" for anything after it. */
  const upstream = (root: unknown = ROOT) =>
    vi.fn(async (url: string | URL | Request) => {
      const fen = decodeURIComponent(String(url).split('fen=')[1] ?? '');
      const body = fen.startsWith('k7/') || fen.startsWith('4k3/8/4K3') ? root : MATED;
      return { ok: true, status: 200, json: async () => body } as Response;
    });

  const lines = async (fetcher: ReturnType<typeof upstream>, fen: string, want = 1) => {
    const res = await tablebaseApi(fetcher as unknown as typeof fetch, dir).request(
      `/tablebase/lines?fen=${encodeURIComponent(fen)}&lines=${want}`,
    );
    return { status: res.status, body: (await res.json()) as { lines?: { mate: number; moves: string[]; depth: number }[] } };
  };

  it('plays the mate, which reports no dtm at all', async () => {
    const { status, body } = await lines(upstream(), MATE_IN_ONE);

    expect(status).toBe(200);
    expect(body.lines?.[0]?.mate).toBe(1);
    expect(body.lines?.[0]?.moves).toEqual(['c1c8']);
    // One ply, because the walk stops at the mate rather than maneuvering
    // on to the ply cap — which is what it did while dtm null was read as
    // "there is no mate here".
    expect(body.lines?.[0]?.depth).toBe(1);
  });

  it('offers only moves that share the root verdict, best first', async () => {
    const { body } = await lines(upstream(), MATE_IN_ONE, 5);

    // Qc8# and Qc2 win; the drawing and losing moves are not alternatives
    // to a win, and offering the losing one above the drawing one — which
    // has no dtm to be ranked by — is exactly the trap.
    expect(body.lines?.map((l) => l.mate)).toEqual([1, 4]);
    expect(body.lines?.map((l) => l.moves[0])).toEqual(['c1c8', 'c1c2']);
  });

  it('has nothing to say about a draw, and says so', async () => {
    const { status, body } = await lines(upstream(DRAW_ROOT), DRAWN);

    expect(status).toBe(200);
    expect(body.lines).toEqual([]);
  });

  it('refuses more men than a tablebase covers', async () => {
    const fetcher = upstream();
    const { status } = await lines(fetcher, TOO_MANY);

    expect(status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports being unable to ask, rather than answering wrongly', async () => {
    const dead = vi.fn(async () => {
      throw new Error('offline');
    });
    const res = await tablebaseApi(dead as unknown as typeof fetch, dir).request(
      `/tablebase/lines?fen=${encodeURIComponent(MATE_IN_ONE)}`,
    );

    expect(res.status).toBe(502);
    expect((await res.json()).offline).toBe(true);
  });

  it('asks upstream once per position, then never again', async () => {
    const fetcher = upstream();
    await lines(fetcher, MATE_IN_ONE);
    const first = fetcher.mock.calls.length;
    await lines(fetcher, MATE_IN_ONE);

    expect(first).toBeGreaterThan(0);
    // A proof does not age, so the second request is served entirely from
    // the files the first one wrote.
    expect(fetcher.mock.calls.length).toBe(first);
  });
});
