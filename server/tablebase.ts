import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { DATA } from './paths.ts';

/**
 * Proxy for the Lichess Syzygy tablebase (tablebase.lichess.ovh).
 *
 * Everything about this cache is simpler than the explorer's because the
 * data cannot change: a tablebase verdict is a proof, so entries never
 * expire and a hit never needs revalidating. No token either — the
 * endpoint is public.
 *
 * The halfmove clock is part of the cache key on purpose: with the
 * 50-move rule in play the same piece arrangement can be a win at clock 0
 * and a draw at clock 80, and the API's category says so.
 */

const TB_HOST = 'https://tablebase.lichess.ovh';
const CACHE_DIR = resolve(DATA, 'tablebase-cache');
/** Syzygy covers up to 7 men; more is not an error, just not answerable. */
const MAX_MEN = 7;

export interface TbMove {
  uci: string;
  san: string;
  /** Category from the point of view of the side to move AFTER this move. */
  category: string;
  dtz: number | null;
  dtm: number | null;
}

export interface TbResult {
  /** win / draw / loss / cursed-win / blessed-loss / maybe-* / unknown, side-to-move POV. */
  category: string;
  dtz: number | null;
  /** Distance to mate in plies, when the 5-man DTM tables cover it. */
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  /** Every legal move, best first (the API's own order). */
  moves: TbMove[];
}

interface UpstreamMove {
  uci: string;
  san: string;
  category: string;
  dtz: number | null;
  dtm: number | null;
}

interface Upstream {
  category: string;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficient_material: boolean;
  moves: UpstreamMove[];
}

/** Slim the upstream payload to what the client renders. */
function normalize(body: Upstream): TbResult {
  return {
    category: body.category,
    dtz: body.dtz,
    dtm: body.dtm,
    checkmate: body.checkmate,
    stalemate: body.stalemate,
    insufficientMaterial: body.insufficient_material,
    moves: (body.moves ?? []).map((m) => ({
      uci: m.uci,
      san: m.san,
      category: m.category,
      dtz: m.dtz,
      dtm: m.dtm,
    })),
  };
}

export function tablebaseApi(fetcher: typeof fetch = fetch): Hono {
  const api = new Hono();

  api.get('/tablebase', async (c) => {
    const fen = c.req.query('fen');
    if (!fen) return c.json({ error: 'missing ?fen=' }, 400);

    // Validate and canonicalise before anything leaves this process.
    const setup = parseFen(fen);
    if (setup.isErr) return c.json({ error: 'invalid FEN' }, 400);
    const pos = Chess.fromSetup(setup.unwrap());
    if (pos.isErr) return c.json({ error: 'invalid position' }, 400);
    const parsed = setup.unwrap();
    if (parsed.board.occupied.size() > MAX_MEN) {
      return c.json({ error: 'tablebases cover at most 7 men' }, 400);
    }
    // Syzygy has no castling: a position that still may castle has no entry.
    if (parsed.castlingRights.nonEmpty()) {
      return c.json({ error: 'tablebases assume no castling rights' }, 400);
    }

    // Position + halfmove clock is the whole identity; the fullmove number
    // is display-only and would only fragment the cache.
    const fields = fen.trim().split(/\s+/);
    const key = createHash('sha256')
      .update(`${fields.slice(0, 4).join(' ')}\n${fields[4] ?? '0'}`)
      .digest('hex')
      .slice(0, 32);
    const path = resolve(CACHE_DIR, `${key}.json`);

    try {
      // Proofs don't age: any hit is final.
      return c.body(readFileSync(path, 'utf-8'), 200, { 'content-type': 'application/json' });
    } catch {
      // Not cached yet.
    }

    try {
      const res = await fetcher(`${TB_HOST}/standard?fen=${encodeURIComponent(fen)}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return c.json({ error: `tablebase answered ${res.status}` }, 502);
      const body = JSON.stringify(normalize((await res.json()) as Upstream));
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(path, body);
      return c.body(body, 200, { 'content-type': 'application/json' });
    } catch {
      return c.json({ error: 'tablebase unreachable and this position is not cached', offline: true }, 502);
    }
  });

  return api;
}
