import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';
import { openingForKey, type Opening } from './openings.ts';
import { positionIndexInfo } from './refgamesIndex.ts';
import { DATA, REPO_ROOT, VAULT_SOURCES } from './paths.ts';

/**
 * Reference games — whole games with movetext, browsable and searchable
 * from the Games tab, built from PGN collections in vault/sources.
 *
 * Plural, like opening books: `data/refgames/<name>.sqlite`, each an
 * independent database (an Elite month, an OTB collection, a club's
 * games), listed and chosen in the elite browser. Replacing one is
 * therefore not a special case any more — build a new name beside it and
 * delete the old. The single-file layout this grew out of
 * (`data/refgames.sqlite`) is migrated on startup, and a bare file path
 * can still be mounted directly, which is how the static demo and the
 * tests run these routes over one file of their own choosing.
 */

const REFGAMES_DIR = resolve(DATA, 'refgames');
const LEGACY_DB = resolve(DATA, 'refgames.sqlite');
const PAGE = 50;

/** Same shape as book names: file names, no slashes, no dot-only names. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Move the single-file era's database into the directory layout.
 *
 * Named after its first source when the meta says one (`elite-2025-11.pgn`
 * becomes `elite-2025-11`), because that is the name the build would have
 * given it today; `refgames` when the meta is unreadable or the name is
 * taken. The file is renamed, not copied — it is the same database, in
 * the place the multi-database code looks.
 */
export function migrateLegacyRefgames(dataDir: string = DATA): void {
  const legacy = resolve(dataDir, 'refgames.sqlite');
  if (!existsSync(legacy)) return;
  const dir = resolve(dataDir, 'refgames');
  mkdirSync(dir, { recursive: true });

  let name = 'refgames';
  try {
    const db = new Database(legacy, { readonly: true, fileMustExist: true });
    const sources = (
      db.prepare("SELECT value FROM meta WHERE key = 'sources'").get() as
        | { value: string }
        | undefined
    )?.value;
    db.close();
    // Only a single-source database gets its source's name — naming a
    // merge of several after the first alone would misdescribe it.
    const first = (sources ?? '').includes(',')
      ? ''
      : (sources ?? '').trim().split(' ')[0]!.replace(/\.pgn$/i, '');
    if (NAME_RE.test(first)) name = first;
  } catch {
    // Unreadable meta — the fallback name is fine.
  }

  let target = resolve(dir, `${name}.sqlite`);
  if (existsSync(target)) target = resolve(dir, 'refgames.sqlite');
  if (existsSync(target)) {
    console.warn(`refgames: could not migrate ${basename(legacy)} — ${basename(target)} already exists`);
    return;
  }
  renameSync(legacy, target);
  console.log(`refgames: migrated the single database to refgames/${basename(target)}`);
}

/**
 * Was this `.building` file a build that ran all the way to the end?
 *
 * `built_at` is written after the last game is inserted and `plies` after
 * the position index finishes, so both present means the child got past
 * its final write and only ever missed the rename. A WAL sidecar means the
 * opposite: the index pass folds the journal back to DELETE when it is
 * done, so one still lying there is an indexer that was killed mid-pass.
 */
function isFinishedBuild(path: string): boolean {
  if (existsSync(`${path}-wal`)) return false;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare("SELECT key FROM meta WHERE key IN ('built_at', 'plies')")
        .all() as { key: string }[];
      return rows.length === 2;
    } finally {
      db.close();
    }
  } catch {
    return false; // truncated, headerless, or no meta table — half a build
  }
}

/**
 * Deal with the `.building` files a killed build leaves behind.
 *
 * A build writes `<name>.sqlite.building` and renames it into place at the
 * end (here rather than in the child on Windows, where the server's own
 * read handle blocks the rename-over). Quitting the desktop app kills the
 * server, and the server is the only supervisor the indexer has — so a
 * build interrupted that way leaves its part-written file sitting in the
 * directory for ever. Nothing ever lists it, only `*.sqlite` being a
 * database, so it is invisible: an Elite month is ~200 MB of dead weight
 * nobody can see to delete, and the app offers no way to.
 *
 * Startup is the one moment when this is decidable — no build can be
 * running yet, so every `.building` file present belongs to a dead one.
 * Nearly all are half-written and go. The exception is a build that
 * finished in the instant before the server died: that file is a complete
 * database that only missed its rename, so it is renamed in rather than
 * thrown away. Deleting a finished build would be a worse bug than the
 * leak this fixes.
 *
 * Called from server/index.ts at startup, after migrateLegacyRefgames and
 * before seedBundledRefgames, so an adopted database is in place before
 * the seed decides whether the name is taken.
 */
export function sweepUnfinishedBuilds(dataDir: string = DATA): void {
  const dir = resolve(dataDir, 'refgames');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.sqlite.building'));
  } catch {
    return; // no directory yet
  }
  for (const file of files) {
    const path = resolve(dir, file);
    const target = resolve(dir, file.slice(0, -'.building'.length));
    if (isFinishedBuild(path)) {
      try {
        renameSync(path, target);
        console.log(`refgames: swapped in ${basename(target)}, built by an interrupted run`);
      } catch (error) {
        // Leave it: it is a whole database, and the next start tries again.
        console.warn(`refgames: could not swap in ${file} (${(error as Error).message})`);
      }
      continue;
    }
    rmSync(path, { force: true });
    for (const sidecar of ['-wal', '-shm', '-journal']) {
      rmSync(`${path}${sidecar}`, { force: true });
    }
    console.log(`refgames: discarded ${file} — the build that wrote it never finished`);
  }
}

/**
 * The starter set of reference games that comes with the app — a curated
 * slice of a CC0 Lichess Elite month (the strongest games of every ECO
 * code, ~39 k games / ~25 MB), built at release time by
 * `build-bundled-refgames.ts`. Without it a fresh install's elite browser
 * is empty until something is uploaded.
 *
 * COPIED into the data directory so it is one of the user's ordinary
 * databases from then on — delete it, build others beside it — and the
 * marker records the decision, not the file, so a deleted one does not
 * come back. A database already carrying the same name wins. The
 * `refgames-` file-name prefix is what marks an asset as ours among
 * whatever else a release drops in assets/, and stripping it gives the
 * seeded database its name.
 *
 * Called from server/index.ts at startup (after migrateLegacyRefgames),
 * not from refGamesApi(): the static demo and the tests mount these
 * routes over paths of their own choosing and must not inherit a database
 * they did not ask for.
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

  const name = basename(bundled, '.sqlite').replace(/^refgames-/, '');
  const dir = resolve(dataDir, 'refgames');
  const target = resolve(dir, `${name}.sqlite`);
  // A database of that name is already there. Theirs wins.
  if (existsSync(target)) {
    writeFileSync(marker, `${new Date().toISOString()}\n`);
    return;
  }

  // Copy beside the target and rename, like every other write here: a copy
  // interrupted halfway must not leave a truncated file that IS the
  // database from then on.
  mkdirSync(dir, { recursive: true });
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
    `refgames: seeded ${name} (${(statSync(target).size / 1e6).toFixed(1)} MB)`,
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

/**
 * The structured game filters, shared by /search and /explore.
 *
 * This is where "list the games [player] played [opening] as [side] at
 * [dates] in [event] and [won/lost/drew]" becomes SQL — every slot
 * optional, every combination composable (lanph3re's ask). `alias`
 * prefixes the columns for the explore route's join. Dates are compared
 * with the dots normalised to dashes, because Lichess exports write
 * `2025.11.30` and OTB collections write `2025-11-30`; neither form is
 * seekable here, but neither is the search's leading-wildcard LIKE, and
 * both routes already scan their candidate rows.
 */
/** Whether the file carries the precomputed per-move sums — an older
    database answers the unfiltered question live until its next tune. */
function hasMoveCounts(db: InstanceType<typeof Database>): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'move_counts'")
      .get() !== undefined
  );
}

function gamesWhere(
  get: (key: string) => string | undefined,
  alias = '',
): { clauses: string[]; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  const like = (value: string): string => `%${value}%`;

  const result = get('result');
  if (result === '1-0' || result === '0-1' || result === '1/2-1/2') {
    clauses.push(`${alias}result = ?`);
    binds.push(result);
  }

  const minElo = Math.max(0, Number(get('minElo')) || 0);
  if (minElo > 0) {
    clauses.push(`${alias}white_elo >= ? AND ${alias}black_elo >= ?`);
    binds.push(minElo, minElo);
  }

  const player = get('player')?.trim();
  const side = get('side');
  if (player) {
    if (side === 'white') {
      clauses.push(`${alias}white LIKE ?`);
      binds.push(like(player));
    } else if (side === 'black') {
      clauses.push(`${alias}black LIKE ?`);
      binds.push(like(player));
    } else {
      clauses.push(`(${alias}white LIKE ? OR ${alias}black LIKE ?)`);
      binds.push(like(player), like(player));
    }
    // Outcome is the PLAYER'S, so without a side it splits by which seat
    // the name matched — "won" is a white win in the games they had White.
    const outcome = get('outcome');
    if (outcome === 'drawn') {
      clauses.push(`${alias}result = '1/2-1/2'`);
    } else if (outcome === 'won' || outcome === 'lost') {
      const asWhite = outcome === 'won' ? '1-0' : '0-1';
      const asBlack = outcome === 'won' ? '0-1' : '1-0';
      if (side === 'white' || side === 'black') {
        clauses.push(`${alias}result = ?`);
        binds.push(side === 'white' ? asWhite : asBlack);
      } else {
        clauses.push(
          `((${alias}white LIKE ? AND ${alias}result = ?) OR (${alias}black LIKE ? AND ${alias}result = ?))`,
        );
        binds.push(like(player), asWhite, like(player), asBlack);
      }
    }
  }

  const opening = get('opening')?.trim();
  if (opening) {
    clauses.push(`(${alias}opening LIKE ? OR ${alias}eco LIKE ?)`);
    binds.push(like(opening), `${opening}%`);
  }

  const event = get('event')?.trim();
  if (event) {
    clauses.push(`${alias}event LIKE ?`);
    binds.push(like(event));
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const from = get('from');
  const to = get('to');
  if (from && DATE_RE.test(from)) {
    clauses.push(`REPLACE(${alias}date, '.', '-') >= ?`);
    binds.push(from);
  }
  if (to && DATE_RE.test(to)) {
    clauses.push(`REPLACE(${alias}date, '.', '-') <= ?`);
    binds.push(to);
  }

  return { clauses, binds };
}

/** One build at a time, like books — the indexer is CPU-bound. */
interface BuildJob {
  name: string;
  startedAt: number;
  running: boolean;
  exitCode: number | null;
  log: string[];
}
let job: BuildJob | null = null;

/**
 * Mount the reference-games API.
 *
 * Two mounts, one route set. The default serves the `data/refgames/`
 * directory: many named databases, a `db` query parameter to pick one,
 * build and delete routes. A string mounts one bare file with the original
 * single-database shapes — no names, no build, no delete — which is what
 * the static demo and the tests use.
 */
export function refGamesApi(
  source: string | { dir: string } = { dir: REFGAMES_DIR },
): Hono & { closeDb: () => void } {
  const single = typeof source === 'string' ? source : null;
  const dir = typeof source === 'string' ? null : source.dir;

  // Read-only handles for the process lifetime, keyed by name ('' for a
  // single-file mount). A build or delete closes its entry so the next
  // query reopens the current file.
  const handles = new Map<string, InstanceType<typeof Database>>();
  // Row counts from each build's own meta tally — the files are read-only
  // between builds, so one read per database is enough.
  const counts = new Map<string, number>();

  const fileFor = (name: string): string => single ?? resolve(dir!, `${name}.sqlite`);

  const names = (): string[] => {
    if (single) return existsSync(single) ? [''] : [];
    try {
      return readdirSync(dir!)
        .filter((f) => f.endsWith('.sqlite'))
        .map((f) => basename(f, '.sqlite'))
        .sort();
    } catch {
      return []; // no directory yet
    }
  };

  const open = (name: string): InstanceType<typeof Database> | null => {
    const cached = handles.get(name);
    if (cached) return cached;
    const file = fileFor(name);
    if (!existsSync(file)) return null;
    const db = new Database(file, { readonly: true, fileMustExist: true });
    handles.set(name, db);
    return db;
  };

  // Windows can't delete or rename over an open database file, so builds,
  // deletes and tests all need this.
  const close = (name?: string): void => {
    for (const [key, db] of handles) {
      if (name !== undefined && key !== name) continue;
      db.close();
      handles.delete(key);
      counts.delete(key);
    }
  };

  const readMeta = (db: InstanceType<typeof Database>): Record<string, string> =>
    Object.fromEntries(
      (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map(
        (r) => [r.key, r.value],
      ),
    );

  const tableCount = (name: string, db: InstanceType<typeof Database>): number => {
    let count = counts.get(name);
    if (count === undefined) {
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'games'").get() as
        | { value: string }
        | undefined;
      count =
        Number(meta?.value) ||
        (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
      counts.set(name, count);
    }
    return count;
  };

  /** The database a request means: its ?db=, or the first one there is. */
  const fromQuery = (c: { req: { query: (k: string) => string | undefined } }): { name: string; db: InstanceType<typeof Database> } | null => {
    const all = names();
    if (all.length === 0) return null;
    const asked = single ? undefined : c.req.query('db');
    const name = asked !== undefined && NAME_RE.test(asked) && all.includes(asked) ? asked : all[0]!;
    const db = open(name);
    return db ? { name, db } : null;
  };

  const api = new Hono();

  /**
   * The in-app build: index PGN collections from vault/sources — the same
   * uploads the book manager manages — into a named database, in a child
   * process so this server stays responsive (the pattern books and puzzles
   * use). Registered only on the real data directory: the demo and the
   * tests must not be able to spawn an indexer.
   */
  if (dir === REFGAMES_DIR) {
    const sourcePath = (id: string): string | null => {
      if (!id.toLowerCase().endsWith('.pgn') || id.includes('/') || id.includes('\\')) return null;
      const root = resolve(VAULT_SOURCES);
      const path = resolve(root, id);
      if (!path.startsWith(root + sep)) return null;
      return existsSync(path) ? path : null;
    };

    /**
     * Spawn one job child (a build, or the position-index pass), feeding
     * its output into the shared job log — the packaged server runs the
     * bundled .mjs beside it, the repo runs the source through tsx.
     */
    const spawnJob = (
      current: BuildJob,
      bundledName: string,
      scriptPath: string,
      scriptArgs: string[],
      onClose: (code: number | null) => void,
    ): void => {
      job = current;
      const bundled = resolve(REPO_ROOT, 'server', bundledName);
      const args = existsSync(bundled)
        ? [bundled, ...scriptArgs]
        : ['--import', 'tsx', scriptPath, ...scriptArgs];
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
        onClose(code);
      });
    };

    const startBuild = (name: string, sources: string[]): void => {
      const current: BuildJob = { name, startedAt: Date.now(), running: true, exitCode: null, log: [] };
      spawnJob(current, 'build-refgames.mjs', 'scripts/build-refgames.ts', [...sources, '--name', name], (code) => {
        close(name); // reopen the freshly renamed file on next query
        // Windows: our own read handle blocks the script's rename-over, so
        // it leaves the fresh file beside the target and we swap it in
        // here — synchronously after close, before any request can reopen
        // the old file.
        const building = `${fileFor(name)}.building`;
        if (code === 0 && existsSync(building)) {
          try {
            renameSync(building, fileFor(name));
          } catch {
            current.log.push('could not swap in the new database — rebuild after a restart');
          }
        }
      });
    };

    api.post('/refgames/build', async (c) => {
      if (job?.running) return c.json({ error: 'a build is already running' }, 409);

      const body = await c.req.json<{ name?: string; sources?: string[] }>().catch(() => null);
      const ids =
        body?.sources ??
        (() => {
          try {
            return readdirSync(VAULT_SOURCES).filter((f) => f.toLowerCase().endsWith('.pgn'));
          } catch {
            return [];
          }
        })();
      if (ids.length === 0) return c.json({ error: 'no PGN collections to index' }, 400);

      const sources: string[] = [];
      for (const id of ids) {
        const path = sourcePath(id);
        if (!path) return c.json({ error: `invalid or missing source: ${id}` }, 400);
        sources.push(path);
      }

      // No name given: the file's name when there is one file, like books.
      const derived = ids.length === 1 ? ids[0]!.replace(/\.pgn$/i, '') : 'refgames';
      const name = body?.name ?? (NAME_RE.test(derived) ? derived : 'refgames');
      if (!NAME_RE.test(name)) return c.json({ error: 'invalid database name' }, 400);

      mkdirSync(dir!, { recursive: true });
      startBuild(name, sources);
      return c.json({ started: true, name });
    });

    /**
     * Add the position index to a database built before the index existed
     * — a pure derived pass over the movetext already in the file, so no
     * re-upload and no rebuild. Shares the one-job-at-a-time slot with
     * builds; progress shows through the same /build/status the manager
     * already polls. New builds never need this: they index themselves.
     */
    api.post('/refgames/index-positions', async (c) => {
      if (job?.running) return c.json({ error: 'a build is already running' }, 409);
      const body = await c.req.json<{ db?: string }>().catch(() => null);
      const name = body?.db ?? names()[0];
      if (!name || !NAME_RE.test(name) || !names().includes(name)) {
        return c.json({ error: 'no such database' }, 400);
      }
      const current: BuildJob = { name, startedAt: Date.now(), running: true, exitCode: null, log: [] };
      spawnJob(
        current,
        'index-refgames-positions.mjs',
        'scripts/index-refgames-positions.ts',
        [name],
        () => close(name), // reopen so the fresh plies table and meta show
      );
      return c.json({ started: true, name });
    });

    api.get('/refgames/build/status', (c) =>
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

    api.delete('/refgames/:name', (c) => {
      const name = c.req.param('name');
      if (!NAME_RE.test(name)) return c.json({ error: 'invalid database name' }, 400);
      if (job?.running && job.name === name) {
        return c.json({ error: 'that database is being built right now' }, 409);
      }
      if (!existsSync(fileFor(name))) return c.json({ error: 'no such database' }, 404);
      close(name);
      rmSync(fileFor(name));
      return c.json({ deleted: name });
    });
  }

  api.get('/refgames', (c) => {
    if (single) {
      // The original single-database shape, kept for the demo's mount.
      const found = fromQuery(c);
      if (!found) return c.json({ ready: false as const });
      const meta = readMeta(found.db);
      return c.json({
        ready: true as const,
        games: Number(meta.games ?? 0),
        sources: meta.sources ?? '',
      });
    }
    const databases = names().flatMap((name) => {
      const db = open(name);
      if (!db) return [];
      const meta = readMeta(db);
      const index = positionIndexInfo(db);
      return [
        {
          name,
          games: tableCount(name, db),
          sources: meta.sources ?? '',
          bytes: statSync(fileFor(name)).size,
          builtAt: meta.built_at ?? null,
          // Whether the explorer can answer from this database yet.
          indexed: index.indexed,
          positions: index.plies,
        },
      ];
    });
    return c.json({ ready: databases.length > 0, databases });
  });

  /**
   * The deepest catalogued opening along a game's first plies.
   *
   * A database only knows the name its source PGN carried, and the big
   * dumps often carry none — the user's Elite build listed bare ECO
   * codes. The moves are in the row and the vendored opening set is in
   * memory, so the name is derived the way the explorer derives it,
   * instead of shrugging. Query-time, not a rebuild: it works on every
   * database already built.
   */
  const OPENING_PLIES = 24;
  const deriveOpening = (moves: string): Opening | null => {
    const pos = Chess.default();
    let found: Opening | null = null;
    const sans = moves.split(' ');
    for (let i = 0; i < sans.length && i < OPENING_PLIES; i += 1) {
      const move = parseSan(pos, sans[i]!);
      if (!move) break;
      pos.play(move);
      const hit = openingForKey(hashSetup(pos.toSetup()).toString(16));
      if (hit) found = hit;
    }
    return found;
  };

  api.get('/refgames/search', (c) => {
    const found = fromQuery(c);
    if (!found) return c.json({ error: 'no reference games database' }, 503);
    const { name, db } = found;
    const q = (c.req.query('q') ?? '').trim();
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);

    // One box searches everything a game is findable by: players, the
    // opening name, and the ECO code (prefix match, so "B9" finds B90-B99).
    // Beside it, the structured filters — player/side/outcome, opening,
    // event, dates, result, strength — every combination composable (see
    // gamesWhere).
    const structured = gamesWhere((k) => c.req.query(k));
    const clauses = [...structured.clauses];
    const args = [...structured.binds];
    if (q) {
      clauses.unshift('(white LIKE ? OR black LIKE ? OR opening LIKE ? OR eco LIKE ?)');
      args.unshift(`%${q}%`, `%${q}%`, `%${q}%`, `${q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    // COUNT(*) here scans; the leading-wildcard LIKEs are not seekable, so
    // no index can turn that into a lookup. Infinite scroll asks for the
    // same query over and over, so pay it once on the first page and send
    // null afterwards — the client keeps the total it already has. The
    // empty query is free: it is the whole table, which meta already knows.
    const total =
      where === ''
        ? tableCount(name, db)
        : offset === 0
          ? (db.prepare(`SELECT COUNT(*) AS n FROM games ${where}`).get(...args) as { n: number }).n
          : null;
    // moves ride along only to name the openings the source PGN left
    // nameless; the page is 50 rows, so the replay cost is nothing.
    const rows = db
      .prepare(
        `SELECT id, white, black, white_elo, black_elo, result, date, event, eco, opening, moves
         FROM games ${where} ORDER BY id DESC LIMIT ${PAGE} OFFSET ?`,
      )
      .all(...args, offset) as (RefGameRow & { moves: string })[];
    return c.json({
      total,
      rows: rows.map(({ moves, ...row }) => {
        if (row.opening) return row;
        const derived = deriveOpening(moves);
        return derived ? { ...row, eco: row.eco ?? derived.eco, opening: derived.name } : row;
      }),
    });
  });

  /**
   * The explorer's question, answered from a reference database: what was
   * played from this position, under any combination of gamesWhere's
   * filters — which is the whole point of the unified index. A book could
   * never answer "2700+ only": its build summed the games away.
   *
   * Moves are aggregated per uci and legality-checked against the actual
   * position, because two positions can share a 64-bit hash and a move
   * that is not legal here proves its rows belong to the other one — the
   * same guard the my-games index uses. Top games are strongest-first
   * (yours are newest-first; a reference corpus's authority is its
   * rating), in the exact shape the explorer pane already renders, so
   * opening one goes through the /refgames/find path books use.
   */
  api.get('/refgames/explore', (c) => {
    const found = fromQuery(c);
    if (!found) return c.json({ error: 'no reference games database' }, 503);
    const { db } = found;
    const fen = c.req.query('fen')?.trim();
    if (!fen) return c.json({ error: 'expected fen' }, 400);
    const setup = parseFen(fen);
    if (setup.isErr) return c.json({ error: 'bad fen' }, 400);
    const position = Chess.fromSetup(setup.unwrap());
    if (position.isErr) return c.json({ error: 'bad position' }, 400);
    const pos = position.unwrap();

    if (!positionIndexInfo(db).indexed) {
      // Not an error: the database predates the index. The client offers
      // to build it.
      return c.json({ indexed: false, opening: null, games: 0, moves: [], topGames: [] });
    }

    const key = toDbKey(hashSetup(pos.toSetup()));
    const { clauses, binds } = gamesWhere((k) => c.req.query(k), 'g.');
    const sql = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';

    const rows = (
      clauses.length === 0 && hasMoveCounts(db)
        ? db
            .prepare(
              'SELECT uci, w, d, b FROM move_counts WHERE pos = ? ORDER BY w + d + b DESC, uci',
            )
            .all(key)
        : db
            .prepare(
              `SELECT p.uci AS uci,
                SUM(g.result = '1-0') AS w,
                SUM(g.result = '1/2-1/2') AS d,
                SUM(g.result = '0-1') AS b
         FROM plies p JOIN games g ON g.id = p.game_id
         WHERE p.pos = ?${sql}
         GROUP BY p.uci
         ORDER BY w + d + b DESC, p.uci`,
            )
            .all(key, ...binds)
    ) as { uci: string; w: number; d: number; b: number }[];

    const moves = rows.flatMap((row) => {
      const move = parseUci(row.uci);
      if (!move || !pos.isLegal(move)) return [];
      return [{ uci: row.uci, san: makeSan(pos, move), w: row.w, d: row.d, b: row.b, total: row.w + row.d + row.b }];
    });

    const topGames = (
      db
        .prepare(
          `SELECT p.uci AS uci, g.white, g.black, g.white_elo AS whiteElo,
                  g.black_elo AS blackElo, g.result, g.date
           FROM plies p JOIN games g ON g.id = p.game_id
           WHERE p.pos = ?${sql}
           ORDER BY g.white_elo + g.black_elo DESC, g.id DESC
           LIMIT 8`,
        )
        .all(key, ...binds) as {
        uci: string;
        white: string;
        black: string;
        whiteElo: number;
        blackElo: number;
        result: string;
        date: string | null;
      }[]
    ).filter((g) => {
      const move = parseUci(g.uci);
      return move !== undefined && pos.isLegal(move);
    });

    return c.json({
      indexed: true,
      // The position's name, same as every other source's answer carries.
      opening: openingForKey(hashSetup(pos.toSetup()).toString(16)),
      games: moves.reduce((sum, m) => sum + m.total, 0),
      moves,
      topGames: topGames.map((g) => ({ ...g, site: null })),
    });
  });

  /**
   * The same answer as /refgames/explore, for many positions at once and
   * without the parts only a single position needs.
   *
   * The opening map asks about EVERY charted position, which on a real
   * repertoire is hundreds. One request each was costing seconds, and
   * measuring said none of it was the database: 280k games and 8.3M
   * plies answer a position in well under a millisecond. It was the
   * round trips — and a browser will not run more than about six of
   * them at once to one origin, so no amount of client concurrency was
   * going to help. Hundreds of round trips become a handful.
   *
   * Only `moves` comes back. `topGames` is eight more rows per position
   * for a list the map never draws, and `opening` is a name the client
   * already has from its own catalogue.
   */
  api.post('/refgames/explore-batch', async (c) => {
    const found = fromQuery(c);
    if (!found) return c.json({ error: 'no reference games database' }, 503);
    const { db } = found;
    const body = (await c.req.json().catch(() => null)) as { fens?: unknown } | null;
    const fens = Array.isArray(body?.fens) ? body.fens.filter((f): f is string => typeof f === 'string') : null;
    if (!fens) return c.json({ error: 'expected fens' }, 400);
    // A ceiling so one request cannot ask for the whole database's worth
    // of work; the client chunks to well under it.
    if (fens.length > 256) return c.json({ error: 'too many positions' }, 400);

    if (!positionIndexInfo(db).indexed) {
      return c.json({ indexed: false, positions: [] });
    }

    const { clauses, binds } = gamesWhere((k) => c.req.query(k), 'g.');
    const sql = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
    // The map's sweep never filters, and the live aggregation is what made
    // its first batch cost seconds — see REFGAMES_MOVE_COUNTS.
    const stmt =
      clauses.length === 0 && hasMoveCounts(db)
        ? db.prepare(
            'SELECT uci, w, d, b FROM move_counts WHERE pos = ? ORDER BY w + d + b DESC, uci',
          )
        : db.prepare(
            `SELECT p.uci AS uci,
              SUM(g.result = '1-0') AS w,
              SUM(g.result = '1/2-1/2') AS d,
              SUM(g.result = '0-1') AS b
       FROM plies p JOIN games g ON g.id = p.game_id
       WHERE p.pos = ?${sql}
       GROUP BY p.uci
       ORDER BY w + d + b DESC, p.uci`,
          );

    const positions = fens.map((fen) => {
      const setup = parseFen(fen.trim());
      if (setup.isErr) return { fen, moves: [] };
      const position = Chess.fromSetup(setup.unwrap());
      if (position.isErr) return { fen, moves: [] };
      const pos = position.unwrap();
      const rows = stmt.all(toDbKey(hashSetup(pos.toSetup())), ...binds) as {
        uci: string;
        w: number;
        d: number;
        b: number;
      }[];
      const moves = rows.flatMap((row) => {
        const move = parseUci(row.uci);
        if (!move || !pos.isLegal(move)) return [];
        return [
          { uci: row.uci, san: makeSan(pos, move), w: row.w, d: row.d, b: row.b, total: row.w + row.d + row.b },
        ];
      });
      return { fen, moves };
    });

    return c.json({ indexed: true, positions });
  });

  // Match a book's top-game reference (metadata only) to a full game in
  // ANY database, so the explorer can open it on the board — a book does
  // not know which database holds its games.
  api.get('/refgames/find', (c) => {
    const all = names();
    if (all.length === 0) return c.json({ error: 'no reference games database' }, 503);
    const { white, black, date, result } = c.req.query();
    if (!white || !black) return c.json({ error: 'expected white & black' }, 400);
    for (const name of all) {
      const db = open(name);
      if (!db) continue;
      const row = db
        .prepare(
          `SELECT id FROM games
           WHERE white = ? AND black = ? AND (? IS NULL OR date = ?) AND (? IS NULL OR result = ?)
           LIMIT 1`,
        )
        .get(white, black, date ?? null, date ?? null, result ?? null, result ?? null) as
        | { id: number }
        | undefined;
      if (row) return c.json(single ? { id: row.id } : { id: row.id, db: name });
    }
    return c.json({ error: 'not indexed' }, 404);
  });

  api.get('/refgames/:id/pgn', (c) => {
    const found = fromQuery(c);
    if (!found) return c.json({ error: 'no reference games database' }, 503);
    const row = found.db
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
      header('Opening', row.opening ?? deriveOpening(row.moves)?.name ?? null) +
      header('Result', row.result) +
      `\n${row.moves} ${row.result}\n`;
    return c.json({ pgn });
  });

  return Object.assign(api, { closeDb: () => close() });
}

// Referenced by scripts that need the same resolution (tune-dbs, the
// bundled-set curator, the demo curator) without duplicating the layout.
export { REFGAMES_DIR, LEGACY_DB };
