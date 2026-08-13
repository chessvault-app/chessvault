import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { DATA, REPO_ROOT } from './paths.ts';

/**
 * Reference games (data/refgames.sqlite, built by `npm run build:refgames`
 * from PGN collections in vault/sources) — elite games browsable from the
 * Games tab. Read-only; a rebuild renames the file, restart to pick it up.
 */

const DB_PATH = resolve(DATA, 'refgames.sqlite');
const PAGE = 50;

/**
 * The starter set of reference games that comes with the app — a curated
 * slice of a CC0 Lichess Elite month (the strongest games of every ECO
 * code, ~39 k games / ~25 MB), built at release time by
 * `build-bundled-refgames.ts` next to the bundled opening book. Without it
 * a fresh install's elite browser is empty until its owner learns about
 * vault/sources and a build script.
 *
 * Same contract as the bundled book (see seedBundledBook in books.ts for
 * the full reasoning): COPIED into the data directory so it is the user's
 * ordinary database from then on — rebuild over it, delete it — and the
 * marker records the decision, not the file, so a deleted one does not
 * come back. An existing refgames.sqlite always wins. The `refgames-`
 * file-name prefix is what separates this asset from the book in the same
 * assets/ directory.
 *
 * Called from server/index.ts at startup, not from refGamesApi(): the
 * static demo and the tests mount these routes over paths of their own
 * choosing and must not inherit a database they did not ask for.
 */
const SEED_MARKER = '.seeded-refgames';

export function seedBundledRefgames(
  dataDir: string = DATA,
  assetsDir: string = resolve(REPO_ROOT, 'assets'),
): void {
  const marker = resolve(dataDir, SEED_MARKER);
  if (existsSync(marker)) return;

  let bundled: string | null = null;
  try {
    const file = readdirSync(assetsDir).find(
      (name) => name.startsWith('refgames-') && name.endsWith('.sqlite'),
    );
    bundled = file ? resolve(assetsDir, file) : null;
  } catch {
    bundled = null; // no assets directory at all
  }
  // No bundled file — a source checkout, or a server deploy. No marker, so
  // an install that gains one later still gets it.
  if (!bundled) return;

  const target = resolve(dataDir, 'refgames.sqlite');
  // A database is already there — one the user built, or one a previous
  // install seeded before markers were per-file. Theirs wins.
  if (existsSync(target)) {
    writeFileSync(marker, `${new Date().toISOString()}\n`);
    return;
  }

  // Copy beside the target and rename, like every other write here: a copy
  // interrupted halfway must not leave a truncated file that IS the
  // database from then on.
  const part = `${target}.part`;
  try {
    rmSync(part, { force: true });
    copyFileSync(bundled, part);
    renameSync(part, target);
  } catch (error) {
    rmSync(part, { force: true });
    // No marker: a recoverable failure should be retried on the next
    // launch rather than remembered as a decision.
    console.warn(`refgames: could not seed the bundled games (${(error as Error).message})`);
    return;
  }
  writeFileSync(marker, `${new Date().toISOString()}\n`);
  console.log(
    `refgames: seeded ${basename(bundled)} (${(statSync(target).size / 1e6).toFixed(1)} MB)`,
  );
}

interface RefGameRow {
  id: number;
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: string;
  date: string | null;
  event: string | null;
  eco: string | null;
  opening: string | null;
}

/** One build at a time, like books — the indexer is CPU-bound. */
interface BuildJob {
  startedAt: number;
  running: boolean;
  exitCode: number | null;
  log: string[];
}
let job: BuildJob | null = null;

export function refGamesApi(dbPath: string = DB_PATH): Hono & { closeDb: () => void } {
  let handle: InstanceType<typeof Database> | null = null;
  const db = (): InstanceType<typeof Database> | null => {
    if (handle) return handle;
    if (!existsSync(dbPath)) return null;
    handle = new Database(dbPath, { readonly: true, fileMustExist: true });
    return handle;
  };

  // Windows can't delete an open database file, so tests need this.
  const closeDb = (): void => {
    handle?.close();
    handle = null;
  };

  /**
   * Rows in `games`, from the build's own tally — the file is read-only for
   * the process lifetime, so one read is enough. Older databases without the
   * meta row pay a single COUNT(*).
   */
  let cachedCount: number | null = null;
  const tableCount = (d: InstanceType<typeof Database>): number => {
    if (cachedCount === null) {
      const meta = d.prepare("SELECT value FROM meta WHERE key = 'games'").get() as
        | { value: string }
        | undefined;
      cachedCount =
        Number(meta?.value) ||
        (d.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
    }
    return cachedCount;
  };

  const api = new Hono();

  /**
   * The in-app build: index every PGN in vault/sources — the same uploads
   * the book manager manages — into a fresh database, in a child process
   * so this server stays responsive (the pattern books and puzzles use).
   *
   * Registered only when serving the real data path: the demo and the
   * tests mount these routes over files of their own choosing, and a
   * read-only mount must not be able to spawn an indexer.
   */
  if (dbPath === DB_PATH) {
    const startBuild = (): void => {
      const current: BuildJob = { startedAt: Date.now(), running: true, exitCode: null, log: [] };
      job = current;

      // A packaged build has no scripts/ and no tsx, so the builder ships
      // as a bundle beside the server; the repo runs the source directly.
      const bundled = resolve(REPO_ROOT, 'server', 'build-refgames.mjs');
      const args = existsSync(bundled) ? [bundled] : ['--import', 'tsx', 'scripts/build-refgames.ts'];
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
        closeDb();
        cachedCount = null; // the new file's meta, not the old file's
        // Windows: our own read handle blocks the script's rename-over, so
        // it leaves the fresh file beside the target and we swap it in
        // here — synchronously after closeDb, before any request reopens
        // the old file.
        const building = `${dbPath}.building`;
        if (code === 0 && existsSync(building)) {
          try {
            renameSync(building, dbPath);
          } catch {
            current.log.push('could not swap in the new database — rebuild after a restart');
          }
        }
      });
    };

    api.post('/refgames/build', (c) => {
      if (job?.running) return c.json({ error: 'a build is already running' }, 409);
      startBuild();
      return c.json({ started: true });
    });

    api.get('/refgames/build/status', (c) =>
      c.json(
        job
          ? {
              running: job.running,
              exitCode: job.exitCode,
              seconds: (Date.now() - job.startedAt) / 1000,
              log: job.log.slice(-15),
            }
          : { running: false },
      ),
    );
  }

  api.get('/refgames', (c) => {
    const d = db();
    if (!d) return c.json({ ready: false as const });
    const meta = Object.fromEntries(
      (d.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map(
        (r) => [r.key, r.value],
      ),
    );
    return c.json({
      ready: true as const,
      games: Number(meta.games ?? 0),
      sources: meta.sources ?? '',
    });
  });

  api.get('/refgames/search', (c) => {
    const d = db();
    if (!d) return c.json({ error: 'No reference games. Run: npm run build:refgames (see docs/databases.md)' }, 503);
    const q = (c.req.query('q') ?? '').trim();
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);

    // One box searches everything a game is findable by: players, the
    // opening name, and the ECO code (prefix match, so "B9" finds B90-B99).
    const where = q ? 'WHERE white LIKE ? OR black LIKE ? OR opening LIKE ? OR eco LIKE ?' : '';
    const args = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `${q}%`] : [];

    // COUNT(*) here scans; the leading-wildcard LIKEs are not seekable, so
    // no index can turn that into a lookup. Infinite scroll asks for the
    // same query over and over, so pay it once on the first page and send
    // null afterwards — the client keeps the total it already has. The
    // empty query is free: it is the whole table, which meta already knows.
    const total =
      q === ''
        ? tableCount(d)
        : offset === 0
          ? (d.prepare(`SELECT COUNT(*) AS n FROM games ${where}`).get(...args) as { n: number }).n
          : null;
    const rows = d
      .prepare(
        `SELECT id, white, black, white_elo, black_elo, result, date, event, eco, opening
         FROM games ${where} ORDER BY id DESC LIMIT ${PAGE} OFFSET ?`,
      )
      .all(...args, offset) as RefGameRow[];
    return c.json({ total, rows });
  });

  // Match a book's top-game reference (metadata only) to a full game
  // here, so the explorer can open it on the board.
  api.get('/refgames/find', (c) => {
    const d = db();
    if (!d) return c.json({ error: 'no reference games database' }, 503);
    const { white, black, date, result } = c.req.query();
    if (!white || !black) return c.json({ error: 'expected white & black' }, 400);
    const row = d
      .prepare(
        `SELECT id FROM games
         WHERE white = ? AND black = ? AND (? IS NULL OR date = ?) AND (? IS NULL OR result = ?)
         LIMIT 1`,
      )
      .get(white, black, date ?? null, date ?? null, result ?? null, result ?? null) as
      | { id: number }
      | undefined;
    if (!row) return c.json({ error: 'not indexed' }, 404);
    return c.json({ id: row.id });
  });

  api.get('/refgames/:id/pgn', (c) => {
    const d = db();
    if (!d) return c.json({ error: 'no reference games database' }, 503);
    const row = d
      .prepare('SELECT * FROM games WHERE id = ?')
      .get(Number(c.req.param('id'))) as (RefGameRow & { moves: string }) | undefined;
    if (!row) return c.json({ error: 'unknown game' }, 404);

    const header = (key: string, value: string | null): string =>
      value ? `[${key} "${value.replace(/"/g, '')}"]\n` : '';
    const pgn =
      header('Event', row.event) +
      header('White', row.white) +
      header('Black', row.black) +
      header('WhiteElo', row.white_elo ? String(row.white_elo) : null) +
      header('BlackElo', row.black_elo ? String(row.black_elo) : null) +
      header('Date', row.date) +
      header('ECO', row.eco) +
      header('Opening', row.opening) +
      header('Result', row.result) +
      `\n${row.moves} ${row.result}\n`;
    return c.json({ pgn });
  });

  return Object.assign(api, { closeDb });
}
