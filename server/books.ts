import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';
import { openingForKey } from './openings.ts';
import { DATA_BOOKS, REPO_ROOT, VAULT_SOURCES } from './paths.ts';

/** No slashes, no dots-only names — book names map straight to file names. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

interface BookRow {
  uci: string;
  w: number;
  d: number;
  b: number;
}

interface TopGameRow {
  uci: string;
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: string;
  date: string | null;
  site: string | null;
}

/**
 * Read-only handles, opened lazily and kept for the process lifetime. A
 * rebuild renames a fresh file over the old one, so handles are closed when
 * a build job finishes (and on delete) to drop the stale inode.
 */
const handles = new Map<string, InstanceType<typeof Database>>();

function readMeta(db: InstanceType<typeof Database>): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM meta').all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------------------------------------------------------------------------
// Build jobs. One at a time; the indexer is CPU-bound and better-sqlite3 is
// synchronous, so it runs as a child process to keep this server responsive.

interface BuildJob {
  name: string;
  startedAt: number;
  running: boolean;
  exitCode: number | null;
  log: string[];
}

let job: BuildJob | null = null;

// ---------------------------------------------------------------------------

export interface BooksApiDirs {
  books: string;
  sources: string;
}

export function booksApi(
  dirs: BooksApiDirs = { books: DATA_BOOKS, sources: VAULT_SOURCES },
): Hono {
  mkdirSync(dirs.books, { recursive: true });
  const api = new Hono();

  const bookPath = (name: string): string => resolve(dirs.books, `${name}.sqlite`);

  const getDb = (name: string): InstanceType<typeof Database> | null => {
    const cached = handles.get(bookPath(name));
    if (cached) return cached;
    const path = bookPath(name);
    if (!existsSync(path)) return null;
    const db = new Database(path, { readonly: true, fileMustExist: true });
    handles.set(path, db);
    return db;
  };

  const closeDb = (name: string): void => {
    handles.get(bookPath(name))?.close();
    handles.delete(bookPath(name));
  };

  /**
   * Turn a source id from the client into an absolute path, or null.
   *
   * One namespace: an uploaded collection in vault/sources, named by its
   * bare filename. Containment-checked after resolve(), so a crafted id
   * cannot walk out of the directory it names.
   *
   * The vault's own games used to be a second namespace here, and it did
   * not work: `/books` reports a book's sources through basename(), which
   * threw the `games/` prefix away, so Rebuild answered 400 for every book
   * built from them. It is gone rather than repaired — a book is the wrong
   * shape for your own games (see server/myGames.ts), and the fix would
   * have made a broken workflow merely functional.
   */
  const sourcePath = (id: string): string | null => {
    if (!id.endsWith('.pgn') || id.includes('/') || id.includes('\\')) return null;
    const root = resolve(dirs.sources);
    const path = resolve(root, id);
    if (!path.startsWith(root + sep)) return null;
    return existsSync(path) ? path : null;
  };

  const startBuild = (name: string, sources: string[], flags: string[]): void => {
    const current: BuildJob = { name, startedAt: Date.now(), running: true, exitCode: null, log: [] };
    job = current;

    // A packaged build has no scripts/ and no tsx, so it ships the builder
    // as a bundle beside the server; the repo runs the source directly.
    const bundled = resolve(REPO_ROOT, 'server', 'build-book.mjs');
    const args = existsSync(bundled)
      ? [bundled, ...sources, '--name', name, ...flags]
      : ['--import', 'tsx', 'scripts/build-book.ts', ...sources, '--name', name, ...flags];
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (chunk: Buffer): void => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) current.log.push(line);
      }
      if (current.log.length > 100) current.log.splice(0, current.log.length - 100);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('close', (code) => {
      current.running = false;
      current.exitCode = code;
      closeDb(name); // reopen the freshly renamed file on next query
      // Windows: our own read handle blocks the script's rename-over, so it
      // leaves the fresh file beside the target and we swap it in here —
      // synchronously after closeDb, before any request can reopen the old
      // file.
      const building = `${bookPath(name)}.building`;
      if (code === 0 && existsSync(building)) {
        try {
          renameSync(building, bookPath(name));
        } catch {
          current.log.push(`could not swap in ${building} — delete the book and rebuild`);
        }
      }
    });
  };

  api.get('/books', (c) => {
    const books = readdirSync(dirs.books, { recursive: false })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.sqlite'))
      .map((file) => {
        const name = basename(file, '.sqlite');
        const db = getDb(name);
        if (!db) return null;
        const meta = readMeta(db);
        let sources: string[] = [];
        try {
          sources = (JSON.parse(meta.sources ?? '[]') as string[]).map((s) => basename(s));
        } catch {
          // older book without the key — rebuild is just unavailable for it
        }
        return {
          name,
          sources,
          bytes: statSync(bookPath(name)).size,
          games: Number(meta.games ?? 0),
          positions: Number(meta.positions ?? 0),
          maxPly: Number(meta.maxPly ?? 0),
          minGames: Number(meta.minGames ?? 0),
          builtAt: meta.builtAt ?? null,
        };
      })
      .filter((b) => b !== null);
    return c.json({ books });
  });

  api.get('/books/build/status', (c) =>
    c.json(
      job
        ? {
            running: job.running,
            name: job.name,
            exitCode: job.exitCode,
            seconds: (Date.now() - job.startedAt) / 1000,
            log: job.log.slice(-15),
          }
        : { running: false },
    ),
  );

  api.post('/books/build', async (c) => {
    if (job?.running) return c.json({ error: 'a build is already running' }, 409);

    const body = await c.req.json<{
      name?: string;
      sources?: string[];
      maxPly?: number;
      minGames?: number;
      topGames?: number;
    }>().catch(() => null);
    if (!body?.name || !NAME_RE.test(body.name)) {
      return c.json({ error: 'invalid book name' }, 400);
    }
    if (!body.sources?.length) return c.json({ error: 'no sources given' }, 400);

    const sources: string[] = [];
    for (const source of body.sources) {
      const path = sourcePath(source);
      if (!path) return c.json({ error: `invalid or missing source: ${source}` }, 400);
      sources.push(path);
    }

    const flags: string[] = [];
    for (const [flag, value] of [
      ['max-ply', body.maxPly],
      ['min-games', body.minGames],
      ['top-games', body.topGames],
    ] as const) {
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value < 0) {
        return c.json({ error: `invalid --${flag}` }, 400);
      }
      flags.push(`--${flag}`, String(value));
    }

    startBuild(body.name, sources, flags);
    return c.json({ started: true, name: body.name });
  });

  api.delete('/books/:name', (c) => {
    const name = c.req.param('name');
    if (!NAME_RE.test(name)) return c.json({ error: 'invalid book name' }, 400);
    if (job?.running && job.name === name) {
      return c.json({ error: 'that book is being built right now' }, 409);
    }
    if (!existsSync(bookPath(name))) return c.json({ error: 'no such book' }, 404);
    closeDb(name);
    rmSync(bookPath(name));
    return c.json({ deleted: name });
  });

  api.get('/books/:name', (c) => {
    const name = c.req.param('name');
    const fen = c.req.query('fen');
    if (!NAME_RE.test(name)) return c.json({ error: 'invalid book name' }, 400);
    if (!fen) return c.json({ error: 'missing ?fen=' }, 400);

    const db = getDb(name);
    if (!db) return c.json({ error: 'no such book' }, 404);

    let pos: Chess;
    try {
      pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    } catch {
      return c.json({ error: 'invalid FEN' }, 400);
    }
    // toSetup() applies the same X-FEN normalisation the indexer used, so
    // index-time and query-time hashes agree by construction.
    const hash = hashSetup(pos.toSetup());
    const key = toDbKey(hash);

    const rows = db
      .prepare('SELECT uci, w, d, b FROM book WHERE pos = ? ORDER BY w + d + b DESC, uci')
      .all(key) as BookRow[];
    const moves = rows.flatMap((row) => {
      const move = parseUci(row.uci);
      if (!move || !pos.isLegal(move)) return []; // hash collision guard
      return [{ ...row, san: makeSan(pos, move), total: row.w + row.d + row.b }];
    });

    const topGames = (
      db
        .prepare(`
          SELECT t.uci, g.white, g.black, g.white_elo, g.black_elo, g.result, g.date, g.site
          FROM top_games t JOIN games g ON g.id = t.game_id
          WHERE t.pos = ? ORDER BY t.elo DESC
        `)
        .all(key) as TopGameRow[]
    ).map((g) => ({
      uci: g.uci,
      white: g.white,
      black: g.black,
      whiteElo: g.white_elo,
      blackElo: g.black_elo,
      result: g.result,
      date: g.date,
      site: g.site,
    }));

    return c.json({
      opening: openingForKey(hash.toString(16)),
      moves,
      topGames,
    });
  });

  // Opening name without needing any book — the explorer pane's name line
  // must work even before the user has built their first book.
  api.get('/opening', (c) => {
    const fen = c.req.query('fen');
    if (!fen) return c.json({ error: 'missing ?fen=' }, 400);
    try {
      const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
      return c.json({ opening: openingForKey(hashSetup(pos.toSetup()).toString(16)) });
    } catch {
      return c.json({ error: 'invalid FEN' }, 400);
    }
  });

  api.get('/sources', (c) => {
    const sources = readdirSync(dirs.sources)
      .filter((f) => f.endsWith('.pgn'))
      .map((f) => ({ name: f, bytes: statSync(resolve(dirs.sources, f)).size }));
    return c.json({ sources });
  });

  /**
   * Upload a PGN collection.
   *
   * Streamed to disk rather than read into memory: these are Lichess Elite
   * months and Gigabase exports, hundreds of megabytes each, and buffering
   * one would take the server down on the 2 GB box it runs on.
   *
   * It exists because the app used to tell people to put files in
   * vault/sources/ themselves, which is not something a phone or a remote
   * browser can do — and the rule is that every user action is possible in
   * the app.
   */
  api.post('/sources', async (c) => {
    const name = c.req.query('name') ?? '';
    if (!NAME_RE.test(name) || !name.toLowerCase().endsWith('.pgn')) {
      return c.json({ error: 'name must be a plain .pgn filename' }, 400);
    }
    const target = resolve(dirs.sources, name);
    // resolve() collapses any traversal NAME_RE somehow allowed; refuse
    // anything that did not land directly in the sources directory.
    if (resolve(target, '..') !== resolve(dirs.sources)) {
      return c.json({ error: 'invalid name' }, 400);
    }
    if (existsSync(target)) return c.json({ error: 'a file with that name is already here' }, 409);
    if (!c.req.raw.body) return c.json({ error: 'empty upload' }, 400);

    mkdirSync(dirs.sources, { recursive: true });
    // Write beside the target, then rename: a dropped connection leaves a
    // .part behind rather than a truncated PGN that looks importable.
    const part = `${target}.part`;
    try {
      // Imported here rather than at the top because the static demo runs
      // these same route modules in the browser with node:fs aliased to an
      // in-memory shim, and a top-level `createWriteStream` import fails its
      // build outright. The demo never reaches this line — it has no server
      // to upload to — so a lazy import costs nothing and keeps the shim
      // from having to fake a write stream.
      const { createWriteStream } = await import('node:fs');
      const { Readable } = await import('node:stream');
      const { pipeline } = await import('node:stream/promises');
      await pipeline(Readable.fromWeb(c.req.raw.body as NodeReadableStream), createWriteStream(part));
      renameSync(part, target);
    } catch (error) {
      rmSync(part, { force: true });
      return c.json({ error: `upload failed: ${(error as Error).message}` }, 500);
    }
    return c.json({ name, bytes: statSync(target).size });
  });

  api.delete('/sources/:name', (c) => {
    const name = c.req.param('name');
    if (!NAME_RE.test(name) || !name.toLowerCase().endsWith('.pgn')) {
      return c.json({ error: 'invalid name' }, 400);
    }
    const target = resolve(dirs.sources, name);
    if (resolve(target, '..') !== resolve(dirs.sources)) return c.json({ error: 'invalid name' }, 400);
    if (!existsSync(target)) return c.json({ error: 'no such file' }, 404);
    rmSync(target);
    return c.json({ deleted: name });
  });

  return api;
}
