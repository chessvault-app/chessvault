import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { DATA_EXPLORER_CACHE, VAULT_CONFIG, VAULT_STUDIES } from './paths.ts';

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

// --- Lichess study import ----------------------------------------------------
// The vault studies ARE the Lichess export format, so importing is: list the
// user's studies, fetch each chosen one's PGN, write it into vault/studies.
// The token stays server-side; private studies need it to carry study:read.

const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const STUDY_ID_RE = /^[A-Za-z0-9]{8}$/;
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9 ()_.-]*$/;
const MAX_IMPORTS = 50;
const MAX_STUDY_BYTES = 20 * 1024 * 1024;

/** Flatten a Lichess study name into a legal vault document segment. */
function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ()_.-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `Study ${cleaned}`.trim();
}

export function lichessStudiesApi(studiesDir = VAULT_STUDIES, fetcher: typeof fetch = fetch): Hono {
  const api = new Hono();

  api.get('/lichess/studies', async (c) => {
    const user = c.req.query('user') ?? '';
    if (!USERNAME_RE.test(user)) return c.json({ error: 'invalid Lichess username' }, 400);
    const token = readToken();
    try {
      const res = await fetcher(`https://lichess.org/api/study/by/${user}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return c.json({ error: res.status === 404 ? 'no such Lichess user' : `Lichess answered ${res.status}` }, 502);
      }
      const studies = (await res.text())
        .split('\n')
        .filter((line) => line.trim())
        .slice(0, 200)
        .map((line) => JSON.parse(line) as { id: string; name: string; updatedAt?: number })
        .map(({ id, name, updatedAt }) => ({ id, name, updatedAt: updatedAt ?? null }));
      return c.json({
        studies,
        note: token
          ? null
          : 'No Lichess token configured — only public studies are listed. Add a token with study:read in Settings to see private ones.',
      });
    } catch {
      return c.json({ error: 'Lichess is unreachable' }, 502);
    }
  });

  api.post('/lichess/studies/import', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      studies?: { id: string; name: string }[];
      folder?: string;
    } | null;
    const wanted = body?.studies ?? [];
    if (wanted.length === 0 || wanted.length > MAX_IMPORTS) {
      return c.json({ error: `pick between 1 and ${MAX_IMPORTS} studies` }, 400);
    }
    const folder = body?.folder?.trim() ?? '';
    if (folder && !FOLDER_RE.test(folder)) return c.json({ error: 'invalid collection name' }, 400);

    const token = readToken();
    const dir = folder ? resolve(studiesDir, folder) : studiesDir;
    mkdirSync(dir, { recursive: true });

    const imported: string[] = [];
    const failed: { name: string; reason: string }[] = [];
    for (const { id, name } of wanted) {
      if (!STUDY_ID_RE.test(id)) {
        failed.push({ name, reason: 'bad study id' });
        continue;
      }
      try {
        const res = await fetcher(`https://lichess.org/api/study/${id}.pgn`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          failed.push({ name, reason: `Lichess answered ${res.status}` });
          continue;
        }
        const pgn = await res.text();
        if (!pgn.trim() || pgn.length > MAX_STUDY_BYTES) {
          failed.push({ name, reason: pgn.trim() ? 'too large' : 'empty export' });
          continue;
        }
        let base = sanitizeName(name);
        let file = resolve(dir, `${base}.pgn`);
        for (let n = 2; existsSync(file); n++) file = resolve(dir, `${base} (${n}).pgn`);
        writeFileSync(file, pgn);
        imported.push(folder ? `${folder}/${base}` : base);
      } catch {
        failed.push({ name, reason: 'unreachable' });
      }
    }
    return c.json({ imported, failed });
  });

  return api;
}
