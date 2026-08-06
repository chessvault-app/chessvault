import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { DATA_EXPLORER_CACHE, VAULT_CONFIG } from './paths.ts';

/**
 * Proxy for the Lichess opening explorer.
 *
 * The explorer moved to explorer.lichess.org in 2026-03 and now requires an
 * OAuth token — any valid token, zero scopes (anonymous requests get a bare
 * nginx 401 with no WWW-Authenticate header). The token lives in
 * vault/config.json as { "lichessToken": "lip_..." }, which is gitignored.
 *
 * Every successful response is cached on disk keyed by EPD+params, so any
 * position visited once keeps working offline forever. Order of preference:
 * fresh cache → network → stale cache → explicit error (the web client then
 * falls back to the local book).
 */

const EXPLORER_HOST = 'https://explorer.lichess.org';
const DBS = ['masters', 'lichess'] as const;
type ExplorerDb = (typeof DBS)[number];

/** Cache freshness. Master games change rarely; the lichess db drifts daily. */
const TTL_MS: Record<ExplorerDb, number> = {
  masters: 7 * 24 * 3600 * 1000,
  lichess: 24 * 3600 * 1000,
};

interface LichessMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
}

interface LichessGameRef {
  uci?: string;
  id: string;
  winner: 'white' | 'black' | null;
  white: { name: string; rating: number };
  black: { name: string; rating: number };
  year?: number;
  month?: string;
}

export interface LichessExplorerResponse {
  white: number;
  draws: number;
  black: number;
  moves: LichessMove[];
  topGames?: LichessGameRef[];
  recentGames?: LichessGameRef[];
  opening?: { eco: string; name: string } | null;
}

/** Reshape a Lichess explorer payload to the local /api/books/:name contract. */
export function normalizeLichess(body: LichessExplorerResponse, db: ExplorerDb) {
  const refs = [...(body.topGames ?? []), ...(body.recentGames ?? [])];
  return {
    opening: body.opening ?? null,
    moves: body.moves.map((m) => ({
      uci: m.uci,
      san: m.san,
      w: m.white,
      d: m.draws,
      b: m.black,
      total: m.white + m.draws + m.black,
    })),
    topGames: refs.slice(0, 4).map((g) => ({
      uci: g.uci ?? '',
      white: g.white.name,
      black: g.black.name,
      whiteElo: g.white.rating,
      blackElo: g.black.rating,
      result: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2',
      date: g.month ?? (g.year ? String(g.year) : null),
      site: `https://lichess.org/${g.id}`,
    })),
    source: db,
  };
}

function readToken(): string | null {
  try {
    const config = JSON.parse(readFileSync(VAULT_CONFIG, 'utf-8')) as {
      lichessToken?: string;
    };
    return config.lichessToken?.trim() || null;
  } catch {
    return null;
  }
}

function cachePath(db: ExplorerDb, epd: string): string {
  const key = createHash('sha256').update(`${db}\n${epd}`).digest('hex').slice(0, 32);
  return resolve(DATA_EXPLORER_CACHE, db, `${key}.json`);
}

function readCache(path: string): { body: string; ageMs: number } | null {
  try {
    const stat = statSync(path);
    return { body: readFileSync(path, 'utf-8'), ageMs: Date.now() - stat.mtimeMs };
  } catch {
    return null;
  }
}

export function lichessExplorerApi(): Hono {
  const api = new Hono();

  api.get('/explorer/:db', async (c) => {
    const db = c.req.param('db') as ExplorerDb;
    const fen = c.req.query('fen');
    if (!DBS.includes(db)) return c.json({ error: 'unknown explorer database' }, 400);
    if (!fen) return c.json({ error: 'missing ?fen=' }, 400);

    // Canonicalise to an EPD so transpositions and move counters share one
    // cache entry, and so garbage input never reaches Lichess.
    let epd: string;
    try {
      const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
      epd = makeFen(pos.toSetup(), { epd: true });
    } catch {
      return c.json({ error: 'invalid FEN' }, 400);
    }

    const path = cachePath(db, epd);
    const cached = readCache(path);
    if (cached && cached.ageMs < TTL_MS[db]) {
      return c.body(cached.body, 200, { 'content-type': 'application/json' });
    }

    const token = readToken();
    if (token) {
      try {
        const url = `${EXPLORER_HOST}/${db}?fen=${encodeURIComponent(epd)}&topGames=4`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          const body = JSON.stringify(
            normalizeLichess((await res.json()) as LichessExplorerResponse, db),
          );
          mkdirSync(resolve(DATA_EXPLORER_CACHE, db), { recursive: true });
          writeFileSync(path, body);
          return c.body(body, 200, { 'content-type': 'application/json' });
        }
        if (res.status === 401) {
          return c.json(
            { error: 'Lichess rejected the token in vault/config.json — create a new one (no scopes needed) at lichess.org/account/oauth/token/create' },
            502,
          );
        }
        // fall through to stale cache on 429/5xx
      } catch {
        // network down — stale cache below
      }
    }

    if (cached) {
      // Stale beats nothing when offline.
      return c.body(cached.body, 200, { 'content-type': 'application/json' });
    }
    return c.json(
      {
        error: token
          ? 'Lichess explorer is unreachable and this position is not cached'
          : 'Lichess explorer needs an API token: put { "lichessToken": "..." } in vault/config.json (create one with no scopes at lichess.org/account/oauth/token/create)',
        offline: true,
      },
      502,
    );
  });

  return api;
}
