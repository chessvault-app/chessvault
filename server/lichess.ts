import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { sanitizeSegment, validId } from './studies.ts';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { DATA_EXPLORER_CACHE, VAULT_CONFIG, VAULT_STUDIES } from './paths.ts';

/**
 * Proxy for the Lichess opening explorer.
 *
 * The explorer moved to explorer.lichess.org in 2026-03 and now requires an
 * OAuth token — any valid token, zero scopes (anonymous requests get a bare
 * nginx 401 with no WWW-Authenticate header). Settings is where a user
 * puts one; it lands in vault/config.json as { "lichessToken": "lip_..." },
 * which is gitignored — and which is why no error out of here names the
 * file: the app can add the token, so the app is where the error points.
 *
 * Every successful response is cached on disk keyed by EPD+params, so any
 * position visited once keeps working offline forever. Order of preference:
 * fresh cache → network → stale cache → explicit error (the web client then
 * falls back to the local book). The batch route inverts that for stale
 * entries — stale cache now, network afterwards — see its comment.
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

/** Reshape a Lichess explorer payload to the local explorer contract. */
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

// Lichess groups ratings into fixed buckets; the repertoire trainer sends a
// subset to bias replies toward a playing strength. Anything else is dropped
// so a bad param can never reach Lichess or fragment the cache.
const RATING_BUCKETS = new Set(['400', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500']);

function normalizeRatings(raw: string | undefined): string | null {
  if (!raw) return null;
  const picked = raw.split(',').map((s) => s.trim()).filter((b) => RATING_BUCKETS.has(b));
  return picked.length ? picked.sort((a, b) => Number(a) - Number(b)).join(',') : null;
}

/** Exported for the tests, which have no network to fill the cache with. */
export function cachePath(dir: string, db: ExplorerDb, epd: string, ratings: string | null): string {
  const key = createHash('sha256').update(`${db}\n${epd}\n${ratings ?? ''}`).digest('hex').slice(0, 32);
  return resolve(dir, db, `${key}.json`);
}

function readCache(path: string): { body: string; ageMs: number } | null {
  try {
    const stat = statSync(path);
    return { body: readFileSync(path, 'utf-8'), ageMs: Date.now() - stat.mtimeMs };
  } catch {
    return null;
  }
}

export function lichessExplorerApi(
  cacheDir: string = DATA_EXPLORER_CACHE,
  /** Injectable for the tests, exactly as lichessStudiesApi takes one. */
  fetcher: typeof fetch = fetch,
  tokenSource: () => string | null = readToken,
): Hono {
  const api = new Hono();

  /**
   * Fetch one position from Lichess and cache it. Shared by the
   * single-position route (where the caller is waiting on the answer)
   * and the batch route's background refresh (where nobody is). Returns
   * the response body on success, or the status for the caller to map;
   * throws on network failure like fetch does.
   */
  const fetchUpstream = async (
    db: ExplorerDb,
    epd: string,
    ratings: string | null,
    token: string,
  ): Promise<{ body: string } | { status: number }> => {
    const url =
      `${EXPLORER_HOST}/${db}?fen=${encodeURIComponent(epd)}&topGames=4` +
      (ratings ? `&ratings=${ratings}` : '');
    const res = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { status: res.status };
    const body = JSON.stringify(
      normalizeLichess((await res.json()) as LichessExplorerResponse, db),
    );
    mkdirSync(resolve(cacheDir, db), { recursive: true });
    writeFileSync(cachePath(cacheDir, db, epd, ratings), body);
    return { body };
  };

  /**
   * The stale entries a batch answered from, queued to be refreshed
   * BEHIND the response rather than in front of it.
   *
   * Lichess answers one position per request, so a stale map costs one
   * upstream round trip per position however it is asked — the only
   * choice is who waits on them. It used to be the user: the batch route
   * dropped stale entries, the client re-fetched them through its two
   * polite lanes, and the first visit of every day (the lichess db's TTL
   * is 24h) watched the map colour in a second at a time for statistics
   * that were on disk all along, one day old. Aggregate opening counts
   * do not move meaningfully in a day, so the batch now answers stale
   * and this queue re-earns freshness afterwards. The upstream traffic
   * is the same requests it always was, minus anybody waiting.
   *
   * One lane, politer than the client's two since nobody is waiting on
   * it, and the whole pass abandons on the first failure — a missing
   * token, a 429, a network that is down — rather than retrying: the
   * next batch that meets the same stale entries queues them again.
   * Entries are re-checked against the TTL when their turn comes, so an
   * entry the single route refreshed meanwhile costs nothing.
   */
  const stale: { db: ExplorerDb; epd: string; ratings: string | null; path: string }[] = [];
  const staleQueued = new Set<string>();
  let refreshing = false;
  const refresh = async (): Promise<void> => {
    if (refreshing) return;
    refreshing = true;
    try {
      while (stale.length > 0) {
        const item = stale.shift()!;
        staleQueued.delete(item.path);
        const cached = readCache(item.path);
        if (cached && cached.ageMs < TTL_MS[item.db]) continue;
        const token = tokenSource();
        let ok = false;
        if (token) {
          try {
            ok = 'body' in (await fetchUpstream(item.db, item.epd, item.ratings, token));
          } catch {
            // Network down — give up with the rest of the queue.
          }
        }
        if (!ok) {
          for (const left of stale) staleQueued.delete(left.path);
          stale.length = 0;
        }
      }
    } finally {
      refreshing = false;
    }
  };

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

    // Master games have no rating filter; only the lichess db honours it.
    const ratings = db === 'lichess' ? normalizeRatings(c.req.query('ratings')) : null;
    const path = cachePath(cacheDir, db, epd, ratings);
    const cached = readCache(path);
    if (cached && cached.ageMs < TTL_MS[db]) {
      return c.body(cached.body, 200, { 'content-type': 'application/json' });
    }

    const token = tokenSource();
    if (token) {
      try {
        const answer = await fetchUpstream(db, epd, ratings, token);
        if ('body' in answer) {
          return c.body(answer.body, 200, { 'content-type': 'application/json' });
        }
        if (answer.status === 401) {
          return c.json(
            { error: 'Lichess rejected this vault’s token. Replace it in Settings with a new one (no scopes needed) from lichess.org/account/oauth/token/create' },
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
          : 'Lichess explorer needs an API token — add one in Settings (create one with no scopes at lichess.org/account/oauth/token/create)',
        // Only the first of those two is an outage. Both used to carry
        // this flag, which made a vault that has never had a token look
        // like a network that is down — and the client colours the two
        // apart now (amber for out of reach, and its own worded notice
        // for a token nobody has added yet).
        offline: token !== null,
      },
      502,
    );
  });

  /**
   * The disk cache's answer for many positions in one request.
   *
   * The opening map asks about every charted position, and Lichess itself
   * answers one per request — that cannot be batched away. But every
   * answer is cached above, so from the second sweep on the map was
   * paying hundreds of round trips for files already on disk. This route
   * answers whatever the cache holds, stale included — a stale entry is
   * served as it stands and queued for the background refresh above, so
   * the map paints whole now from yesterday's counts and is fresh again
   * for tomorrow. Only a position with no cache file at all is left out;
   * the caller sends those through the single-position route, which is
   * what fills the cache.
   */
  api.post('/explorer/:db/batch', async (c) => {
    const db = c.req.param('db') as ExplorerDb;
    if (!DBS.includes(db)) return c.json({ error: 'unknown explorer database' }, 400);
    const body = (await c.req.json().catch(() => null)) as { fens?: unknown } | null;
    const fens = Array.isArray(body?.fens)
      ? body.fens.filter((f): f is string => typeof f === 'string')
      : null;
    if (!fens) return c.json({ error: 'expected fens' }, 400);
    // The same ceiling every batch route keeps; the client chunks under it.
    if (fens.length > 256) return c.json({ error: 'too many positions' }, 400);

    const ratings = db === 'lichess' ? normalizeRatings(c.req.query('ratings')) : null;
    const positions: { fen: string; moves: unknown[] }[] = [];
    for (const fen of fens) {
      let epd: string;
      try {
        epd = makeFen(Chess.fromSetup(parseFen(fen).unwrap()).unwrap().toSetup(), { epd: true });
      } catch {
        continue; // a bad FEN is left out, exactly like an uncached one
      }
      const path = cachePath(cacheDir, db, epd, ratings);
      const cached = readCache(path);
      if (!cached) continue;
      try {
        const parsed = JSON.parse(cached.body) as { moves?: unknown[] };
        positions.push({ fen, moves: parsed.moves ?? [] });
      } catch {
        // An unreadable cache file answers nothing; the single route will
        // overwrite it.
        continue;
      }
      if (cached.ageMs >= TTL_MS[db] && !staleQueued.has(path)) {
        staleQueued.add(path);
        stale.push({ db, epd, ratings, path });
      }
    }
    // Deliberately not awaited: the refresh is the part nobody waits on.
    if (stale.length > 0) void refresh();
    return c.json({ positions });
  });

  return api;
}

// --- Lichess study import ----------------------------------------------------
// The vault studies ARE the Lichess export format, so importing is: list the
// user's studies, fetch each chosen one's PGN, write it into vault/studies.
// The token stays server-side; private studies need it to carry study:read.

const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const STUDY_ID_RE = /^[A-Za-z0-9]{8}$/;
// The collection a Lichess import lands in is a vault path segment like
// any other, so it answers to the same rule (see server/studies.ts).
const validFolder = (name: string): boolean => validId(name);
const MAX_IMPORTS = 50;
const MAX_STUDY_BYTES = 20 * 1024 * 1024;

/**
 * Flatten a Lichess study name into a legal vault document segment.
 *
 * Shared with the vault routes rather than spelled out again here: this
 * used to keep only `[A-Za-z0-9 ()_.-]`, which turned a Korean study title
 * into a row of spaces and then into "Study", and cut "Sicilian: Najdorf"
 * down to "Sicilian Najdorf" — for the second one that is right, for the
 * first it lost the name entirely.
 */
const sanitizeName = (name: string): string => sanitizeSegment(name, 'Study');

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
    if (folder && !validFolder(folder)) return c.json({ error: 'invalid folder name' }, 400);

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
        // The disambiguated name is what got WRITTEN, so it is also what
        // must be reported — reporting the bare name pointed the client at
        // the previously imported study of the same name.
        const wanted = sanitizeName(name);
        let base = wanted;
        let file = resolve(dir, `${base}.pgn`);
        for (let n = 2; existsSync(file); n++) {
          base = `${wanted} (${n})`;
          file = resolve(dir, `${base}.pgn`);
        }
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
