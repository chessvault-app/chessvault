import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { renameRetrying } from './atomic.ts';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';
import { parseSearchQuery, type SearchTerm } from '../shared/searchQuery.ts';
import {
  MATCH_MODES,
  canonicalMaterial,
  materialMenBounds,
  parseMaterialSpec,
  type MatchMode,
} from '../shared/scanMatch.ts';
import {
  positionTarget,
  replayMaterialHit,
  replayPositionHit,
  type PositionTarget,
} from './refgamesScan.ts';
import { SCAN_PACK_META, SCAN_PACK_VERSION } from '../shared/scanPack.ts';
import {
  KEY_INDEX_META,
  KEY_INDEX_VERSION,
  entryGameId,
  keyBucket,
  low16Bounds,
} from '../shared/keyIndex.ts';
import {
  ensureResident,
  evictAllResidents,
  evictResident,
  residentScan,
  residentStatus,
} from './refgamesResident.ts';
import { openingForKey, type Opening } from './openings.ts';
import { positionIndexInfo } from './refgamesIndex.ts';
import { REFGAMES_LOOKUPS } from '../scripts/lib/db-tuning.ts';
import { DATA, REPO_ROOT, VAULT_SOURCES } from './paths.ts';

/**
 * Reference games — whole games with movetext, browsable and searchable
 * from the Games tab, built from PGN collections in vault/sources.
 *
 * Plural: `data/refgames/<name>.sqlite`, each an
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

/**
 * The native pipeline binary, when one is present — the heavy jobs and
 * the deep-search scan prefer it (measured on an Elite month: build
 * 71.8 s vs ~180 s, deep search 1.3 s vs 12.7 s, both answering
 * byte-identically; see native/). Nothing requires it: a fresh checkout,
 * the demo and the tests all run the JS children exactly as before, and
 * CHESS_NATIVE=0 forces that path when comparing the two is the point.
 * Looked up per spawn so a binary built mid-session is picked up.
 */
function nativeBinary(): string | null {
  if (process.env.CHESS_NATIVE === '0') return null;
  const exe = process.platform === 'win32' ? 'chessvault-core.exe' : 'chessvault-core';
  for (const candidate of [
    resolve(REPO_ROOT, 'server', exe), // packaged beside the bundled .mjs children
    resolve(REPO_ROOT, 'native', 'target', 'release', exe), // a repo cargo build
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The deep-scan request keys that are NOT gamesWhere filters: the
 * relaxation rung and the material spec (shared/scanMatch.ts). They
 * ride the same negotiation as the filters, in their own field of the
 * declaration — a binary from before the ladder declares no `scan` at
 * all, and every match/material request runs on the JS path until the
 * crate catches up.
 */
export const SCAN_KEYS = ['match', 'material'] as const;

export interface NativeCapabilities {
  filters: ReadonlySet<string>;
  scan: ReadonlySet<string>;
}

/**
 * The binary's capabilities output, parsed: the gamesWhere filter keys
 * and scan keys that build of the crate understands. A missing `scan`
 * field is an older declaration, not a broken one — it means none.
 * Null for anything that is not a declaration — garbage, a non-array,
 * non-strings — because a binary that cannot state its contract must
 * not be trusted with any of it.
 */
export function parseNativeCapabilities(stdout: string): NativeCapabilities | null {
  try {
    const body = JSON.parse(stdout) as { filters?: unknown; scan?: unknown };
    const strings = (value: unknown): string[] | null =>
      Array.isArray(value) && value.every((entry) => typeof entry === 'string')
        ? (value as string[])
        : null;
    const filters = strings(body.filters);
    if (!filters) return null;
    const scan = body.scan === undefined ? [] : strings(body.scan);
    if (!scan) return null;
    return { filters: new Set(filters), scan: new Set(scan) };
  } catch {
    return null;
  }
}

/**
 * The request keys this search uses that the binary did not declare —
 * non-empty means the JS path answers. Keys outside GAMES_WHERE_KEYS
 * and SCAN_KEYS never count: they are not part of the vocabulary on
 * either side.
 */
export function undeclaredFilters(
  declared: NativeCapabilities,
  get: (key: string) => string | undefined,
): string[] {
  return [
    ...GAMES_WHERE_KEYS.filter((key) => get(key) !== undefined && !declared.filters.has(key)),
    ...SCAN_KEYS.filter((key) => get(key) !== undefined && !declared.scan.has(key)),
  ];
}

/**
 * Ask the binary which filters it supports, once per build: the answer
 * is cached by path + mtime, so the per-request cost is a stat — and a
 * binary rebuilt mid-session is re-asked, the same staleness immunity
 * the per-spawn lookup above buys. Null (also cached) means the binary
 * gave no usable declaration; deep search then ignores it entirely,
 * which keeps "too old to negotiate" from meaning "trusted anyway".
 */
const capabilitiesCache = new Map<string, Promise<NativeCapabilities | null>>();

/** The resident path's filtered id lists, keyed by file + filter SQL
    and revalidated against the index pass's marks — see the deep-search
    route for why the list is a function of the filters alone. */
const residentIdCache = new Map<string, { ids: Float64Array; stamp: string }>();
function nativeFilters(binary: string): Promise<NativeCapabilities | null> {
  let mtime: number;
  try {
    mtime = statSync(binary).mtimeMs;
  } catch {
    return Promise.resolve(null);
  }
  const key = `${binary}|${mtime}`;
  let pending = capabilitiesCache.get(key);
  if (!pending) {
    pending = askCapabilities(binary);
    capabilitiesCache.set(key, pending);
  }
  return pending;
}

function askCapabilities(binary: string): Promise<NativeCapabilities | null> {
  return new Promise((done) => {
    let child: ReturnType<typeof spawn>;
    try {
      // Windows throws synchronously for an unrunnable binary; POSIX
      // emits 'error' instead (see spawnJob). Both mean no declaration.
      child = spawn(binary, ['capabilities'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      console.error(`refgames: ${binary} gave no capabilities: ${(error as Error).message}`);
      done(null);
      return;
    }
    let stdout = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    let settled = false;
    const finish = (declared: NativeCapabilities | null, why?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (declared === null) {
        console.error(`refgames: ${binary} gave no capabilities${why ? `: ${why}` : ''} — deep search stays on the JS path`);
      }
      done(declared);
    };
    // A binary that hangs on a one-line question must not hang the
    // request that asked; the answer is immediate or it is no answer.
    const timer = setTimeout(() => {
      child.kill();
      finish(null, 'timed out');
    }, 5000);
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => {
      if (code !== 0) finish(null, `exit code ${code}`);
      else finish(parseNativeCapabilities(stdout), 'unparseable output');
    });
  });
}

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
  renameRetrying(legacy, target);
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
        renameRetrying(path, target);
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
    renameRetrying(part, target);
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

/** Whether the file carries the derived player/opening lookup tables the
    search seeks through — see REFGAMES_LOOKUPS. */
function hasLookups(db: InstanceType<typeof Database>): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'players'").get() !==
    undefined
  );
}

/** The tournaments lookup arrived after players/openings — a database
    can carry those and still predate this one. */
function hasEvents(db: InstanceType<typeof Database>): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'").get() !==
    undefined
  );
}

/**
 * Derive the lookup tables into a database that predates them, in place.
 *
 * The bundled seeded database has no PGN source in the vault, so "rebuild
 * with the new schema" is not an option there — every schema addition
 * must be derivable from the games table itself. WAL for the write, as
 * the position indexer does when it writes under the server's open
 * readonly handle; a failure (a locked file, a read-only disk) is not an
 * error, because the plain-LIKE fallback still answers every query.
 */
function upgradeInPlace(file: string): void {
  let probe: InstanceType<typeof Database> | null = null;
  try {
    probe = new Database(file, { readonly: true, fileMustExist: true });
    const done = hasLookups(probe) && hasEvents(probe);
    probe.close();
    if (done) return;
  } catch {
    probe?.close();
    return;
  }
  try {
    const rw = new Database(file);
    rw.pragma('journal_mode = WAL');
    rw.exec(REFGAMES_LOOKUPS);
    rw.pragma('wal_checkpoint(TRUNCATE)');
    rw.pragma('journal_mode = DELETE');
    rw.close();
  } catch {
    /* the fallback path still answers */
  }
}

/** "1600-1999" or "2400-" (open top). Anything else is no band. */
function parseBand(raw: string | undefined): { lo: number; hi: number | null } | null {
  const m = raw ? /^(\d{3,4})-(\d{3,4})?$/.exec(raw) : null;
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : null;
  if (hi !== null && hi < lo) return null;
  return { lo, hi };
}

/**
 * The filter keys gamesWhere consults — the negotiation vocabulary.
 *
 * This list is what the deep-search route forwards to the native binary
 * and compares against what that binary declares (see nativeFilters): a
 * request using a key the binary did not declare runs on the JS path
 * below instead. That routing is what lets THIS side grow a filter
 * before the Rust twin learns it — the cost of the gap is a slower
 * answer, never a wrong one. Grow the list only in the same change that
 * teaches gamesWhere the key; the refgames test records the consulted
 * set and fails on either kind of drift. Exported, with gamesWhere, for
 * that test.
 */
export const GAMES_WHERE_KEYS = [
  'result',
  'minElo',
  'band',
  'player',
  'player2',
  'side',
  'outcome',
  'opening',
  'event',
  'from',
  'to',
  // The search box's parsed terms, JSON-encoded — the whole query
  // language as one negotiated key. See the terms block in gamesWhere.
  'terms',
] as const;

export function gamesWhere(
  get: (key: string) => string | undefined,
  alias = '',
  /**
   * The database carries the derived `players` lookup, so a player name
   * matches through it: the LIKE runs over tens of thousands of distinct
   * names instead of every game row, and the games are probed with a
   * hash-set IN — semantically identical (`white IN (names LIKE ?)` is
   * `white LIKE ?`), scale-proof, and off for mounts that predate the
   * table, where the plain LIKE still answers.
   */
  seekPlayers = false,
): { clauses: string[]; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  const like = (value: string): string => `%${value}%`;
  const whiteMatch = seekPlayers
    ? `${alias}white IN (SELECT name FROM players WHERE name LIKE ?)`
    : `${alias}white LIKE ?`;
  const blackMatch = seekPlayers
    ? `${alias}black IN (SELECT name FROM players WHERE name LIKE ?)`
    : `${alias}black LIKE ?`;

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

  // The level band: the game's LOWER rating inside [lo, hi] (hi open when
  // omitted — "2400-"), the same floor logic as minElo. Aligned bands are
  // answered from the precomputed bucket sums by the explore routes; here
  // it is the live clause every route composes with.
  const band = parseBand(get('band'));
  if (band) {
    clauses.push(`MIN(${alias}white_elo, ${alias}black_elo) >= ?`);
    binds.push(band.lo);
    if (band.hi !== null) {
      clauses.push(`MIN(${alias}white_elo, ${alias}black_elo) <= ?`);
      binds.push(band.hi);
    }
  }

  const player = get('player')?.trim();
  const side = get('side');
  if (player) {
    if (side === 'white') {
      clauses.push(whiteMatch);
      binds.push(like(player));
    } else if (side === 'black') {
      clauses.push(blackMatch);
      binds.push(like(player));
    } else {
      clauses.push(`(${whiteMatch} OR ${blackMatch})`);
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
          `((${whiteMatch} AND ${alias}result = ?) OR (${blackMatch} AND ${alias}result = ?))`,
        );
        binds.push(like(player), asWhite, like(player), asBlack);
      }
    }
  }

  // The opponent: somebody ELSE in the same game, either seat. No side
  // or outcome of their own — the named player's seat and verdict pin
  // the pair's, and two outcome vocabularies in one sentence would
  // contradict more than they compose.
  const player2 = get('player2')?.trim();
  if (player2) {
    clauses.push(`(${whiteMatch} OR ${blackMatch})`);
    binds.push(like(player2), like(player2));
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

  // The search box's parsed terms, one JSON-encoded key so the whole
  // query language is ONE entry in the negotiation vocabulary: a native
  // binary that has not declared `terms` routes the request down the JS
  // path, the same migration lane every filter takes. Parsing the
  // LANGUAGE stays in shared/searchQuery.ts — what travels here is the
  // already-parsed term list, and this block only compiles it, after
  // the structured clauses exactly as the search route always ordered
  // them. A term that fails its shape check is dropped, matching how
  // the parser already keeps unparseable qualifiers out of `terms`.
  const termsRaw = get('terms');
  if (termsRaw) {
    let terms: SearchTerm[] = [];
    try {
      const parsed: unknown = JSON.parse(termsRaw);
      if (Array.isArray(parsed)) terms = parsed as SearchTerm[];
    } catch {
      /* malformed JSON filters nothing rather than everything */
    }
    for (const term of terms) {
      if (typeof term !== 'object' || term === null) continue;
      if (term.kind === 'player' && typeof term.value === 'string') {
        clauses.push(`(${whiteMatch} OR ${blackMatch})`);
        binds.push(like(term.value), like(term.value));
      } else if (term.kind === 'white' && typeof term.value === 'string') {
        clauses.push(whiteMatch);
        binds.push(like(term.value));
      } else if (term.kind === 'black' && typeof term.value === 'string') {
        clauses.push(blackMatch);
        binds.push(like(term.value));
      } else if (term.kind === 'opening' && typeof term.value === 'string') {
        clauses.push(`${alias}opening LIKE ?`);
        binds.push(like(term.value));
      } else if (term.kind === 'eco' && typeof term.value === 'string') {
        clauses.push(`${alias}eco LIKE ?`);
        binds.push(`${term.value}%`);
      } else if (term.kind === 'event' && typeof term.value === 'string') {
        clauses.push(`${alias}event LIKE ?`);
        binds.push(like(term.value));
      } else if (term.kind === 'result' && typeof term.value === 'string') {
        clauses.push(`${alias}result = ?`);
        binds.push(term.value);
      } else if (
        term.kind === 'year' &&
        typeof term.from === 'number' &&
        typeof term.to === 'number'
      ) {
        clauses.push(
          `REPLACE(${alias}date, '.', '-') >= ? AND REPLACE(${alias}date, '.', '-') <= ?`,
        );
        binds.push(`${term.from}-01-01`, `${term.to}-12-31`);
      } else if (term.kind === 'elo' && typeof term.lo === 'number') {
        // The band's own clause shape: MIN >= lo IS "both at least lo",
        // so the floor form needs no second spelling.
        clauses.push(`MIN(${alias}white_elo, ${alias}black_elo) >= ?`);
        binds.push(term.lo);
        if (typeof term.hi === 'number') {
          clauses.push(`MIN(${alias}white_elo, ${alias}black_elo) <= ?`);
          binds.push(term.hi);
        }
      }
    }
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
 * Is an indexer running right now?
 *
 * Asked by the sources routes before they delete an upload: a build was
 * handed those paths and is still reading them. Exported as a predicate
 * rather than the job itself so nothing outside here can reach into it.
 */
export function refgamesBuildRunning(): boolean {
  return job?.running === true;
}

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
    // Directory mounts self-upgrade before the readonly handle opens; the
    // single-file mounts (the demo's read-only sql.js shim, the tests'
    // fixtures) are served as they are and fall back where a lookup table
    // is missing.
    if (!single) upgradeInPlace(file);
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
     * its output into the shared job log — the native binary when one is
     * present (same argv shape plus `--data`, same progress lines), else
     * the bundled .mjs beside a packaged server, else the source through
     * tsx. The three print the same lines, so /build/status and its
     * PROGRESS_RE never know which one ran.
     */
    const spawnJob = (
      current: BuildJob,
      bundledName: string,
      scriptPath: string,
      scriptArgs: string[],
      binaryArgs: string[],
      onClose: (code: number | null) => void,
    ): void => {
      job = current;
      const native = nativeBinary();
      const bundled = resolve(REPO_ROOT, 'server', bundledName);
      const [file, args] = native
        ? [native, binaryArgs]
        : [
            process.execPath,
            existsSync(bundled)
              ? [bundled, ...scriptArgs]
              : ['--import', 'tsx', scriptPath, ...scriptArgs],
          ];
      // A child that cannot start must settle the job like any other
      // failure — the slot frees, the log says why — never crash the
      // server or leave `running` stuck blocking every later build.
      // Windows throws synchronously from spawn() for an unrunnable
      // file (measured: errno UNKNOWN on a corrupt binary); POSIX
      // surfaces the same cases asynchronously as 'error' (ETXTBSY
      // while cargo rewrites the binary, a lost exec bit). Handle both.
      let settled = false;
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        current.running = false;
        current.exitCode = code;
        onClose(code);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(file, args, {
          cwd: REPO_ROOT,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        current.log.push(`could not start the job: ${(error as Error).message}`);
        finish(-1);
        return;
      }
      const append = (chunk: Buffer): void => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) current.log.push(line);
        }
        if (current.log.length > 100) current.log.splice(0, current.log.length - 100);
      };
      child.stdout!.on('data', append);
      child.stderr!.on('data', append);
      child.on('error', (error) => {
        current.log.push(`could not start the job: ${error.message}`);
        finish(-1);
      });
      child.on('close', finish);
    };

    const startBuild = (name: string, sources: string[], append: boolean): void => {
      const current: BuildJob = { name, startedAt: Date.now(), running: true, exitCode: null, log: [] };
      // An append works on the live file: closing our readonly handle
      // first keeps Windows happy about the WAL sidecars, and there is no
      // rename to finish afterwards.
      if (append) close(name);
      spawnJob(
        current,
        'build-refgames.mjs',
        'scripts/build-refgames.ts',
        [...sources, '--name', name, ...(append ? ['--append'] : [])],
        ['build', ...sources, '--name', name, ...(append ? ['--append'] : []), '--data', DATA],
        (code) => {
          close(name); // reopen the fresh file on next query
          // Windows: our own read handle blocks the script's rename-over, so
          // it leaves the fresh file beside the target and we swap it in
          // here — synchronously after close, before any request can reopen
          // the old file.
          const building = `${fileFor(name)}.building`;
          if (!append && code === 0 && existsSync(building)) {
            try {
              renameRetrying(building, fileFor(name));
            } catch {
              current.log.push('could not swap in the new database — rebuild after a restart');
            }
          }
        },
      );
    };

    api.post('/refgames/build', async (c) => {
      if (job?.running) return c.json({ error: 'a build is already running' }, 409);

      const body = await c.req
        .json<{ name?: string; sources?: string[]; mode?: 'replace' | 'append' }>()
        .catch(() => null);
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
      const append = body?.mode === 'append';
      if (append && !existsSync(fileFor(name))) {
        return c.json({ error: 'no such database to add to' }, 400);
      }

      mkdirSync(dir!, { recursive: true });
      startBuild(name, sources, append);
      return c.json({ started: true, name, mode: append ? 'append' : 'replace' });
    });

    /**
     * Housekeeping for one database, as a job in the build slot: drop
     * exact duplicates (players, result, date and movetext all equal —
     * the append path's own key, for files built before it or from
     * overlapping sources), re-derive the lookup tables, rebuild the
     * position index if the sweep removed anything, and VACUUM. SQLite
     * needs no flag-and-compact model: the deletes are real and the
     * VACUUM returns the space.
     */
    api.post('/refgames/optimize', async (c) => {
      if (job?.running) return c.json({ error: 'a build is already running' }, 409);
      const body = await c.req.json<{ db?: string }>().catch(() => null);
      const name = body?.db ?? names()[0];
      if (!name || !NAME_RE.test(name) || !names().includes(name)) {
        return c.json({ error: 'no such database' }, 400);
      }
      const current: BuildJob = { name, startedAt: Date.now(), running: true, exitCode: null, log: [] };
      close(name); // the job rewrites the live file
      spawnJob(
        current,
        'optimize-refgames.mjs',
        'scripts/optimize-refgames.ts',
        [name],
        ['optimize', name, '--data', DATA],
        () => close(name),
      );
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
        ['index', name, '--data', DATA],
        () => close(name), // reopen so the fresh plies table and meta show
      );
      return c.json({ started: true, name });
    });

    /** The newest "N of M games" line the indexer printed, as numbers —
        the fraction a progress bar wants, without scraping log text. */
    const PROGRESS_RE = /([\d,]+) of ([\d,]+) games/;
    const progressOf = (log: string[]): { done: number; total: number } | null => {
      for (let i = log.length - 1; i >= 0; i -= 1) {
        const m = PROGRESS_RE.exec(log[i]!);
        if (m) {
          return {
            done: Number(m[1]!.replaceAll(',', '')),
            total: Number(m[2]!.replaceAll(',', '')),
          };
        }
      }
      return null;
    };

    api.get('/refgames/build/status', (c) =>
      c.json(
        job
          ? {
              running: job.running,
              name: job.name,
              exitCode: job.exitCode,
              seconds: (Date.now() - job.startedAt) / 1000,
              progress: progressOf(job.log),
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
      // A resident index outliving its file would keep answering for a
      // database that no longer exists — and holding its memory.
      evictResident(fileFor(name));
      rmSync(fileFor(name));
      return c.json({ deleted: name });
    });
  }

  /**
   * The fast-search opt-in: hold this database's packed index in
   * memory (a worker thread, ~0.5 KB per game — an Elite month is
   * ~130 MB) so deep hunts scan bytes instead of replaying movetext.
   * The choice is a meta key IN the database file, so it survives
   * restarts and travels with the file; turning it on loads the index
   * now, so the answer says what it cost.
   */
  api.post('/refgames/fast-scan', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { db?: string; on?: boolean } | null;
    if (!body || typeof body.on !== 'boolean') return c.json({ error: 'expected db & on' }, 400);
    const name = single ? '' : (body.db ?? '');
    if (!single && (!NAME_RE.test(name) || !names().includes(name))) {
      return c.json({ error: 'no such database' }, 404);
    }
    const path = fileFor(name);
    const db = open(name);
    if (!db) return c.json({ error: 'no such database' }, 503);
    const meta = readMeta(db);
    if (body.on && meta[SCAN_PACK_META] !== String(SCAN_PACK_VERSION)) {
      // No packs, no fast search: the fix is one index pass away, and
      // saying so beats loading nothing.
      return c.json({ error: 'this database has no scan index yet — re-run Index positions' }, 409);
    }
    const writer = new Database(path);
    try {
      writer.pragma('busy_timeout = 30000');
      if (body.on) {
        writer.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('fast_scan', '1')").run();
      } else {
        writer.prepare("DELETE FROM meta WHERE key = 'fast_scan'").run();
      }
    } finally {
      writer.close();
    }
    if (body.on) {
      try {
        const { games, bytes } = await ensureResident(path);
        return c.json({ on: true, resident: { games, bytes } });
      } catch (error) {
        return c.json({ error: `could not load the index: ${(error as Error).message}` }, 500);
      }
    }
    evictResident(path);
    return c.json({ on: false });
  });

  api.get('/refgames', async (c) => {
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
          // Whether the explorer can answer from this database yet — and
          // whether an interrupted append left games above the index's
          // high-water mark (re-indexing heals it).
          indexed: index.indexed,
          stale: index.stale,
          positions: index.plies,
          // The packed scan-index and the fast-search opt-in riding it:
          // packed says a full pass has written the blobs, fastScan is
          // the owner's choice, resident is whether the worker holds it
          // in memory right now (lazily loaded, evicted when idle).
          packed: meta[SCAN_PACK_META] === String(SCAN_PACK_VERSION),
          fastScan: meta.fast_scan === '1',
          resident: residentStatus(fileFor(name)) !== null,
        },
      ];
    });
    // `native`: the deep scan runs through the native binary here, fast
    // enough (~1 s per 280k games, measured) that the explorer may start
    // it by itself instead of asking for a button press. Present is not
    // enough: a binary that cannot declare its filters is one deep
    // search will not use (see nativeFilters), and telling the client
    // "fast" while answering slow would auto-launch ~10 s JS scans.
    const binary = dir === REFGAMES_DIR ? nativeBinary() : null;
    return c.json({
      ready: databases.length > 0,
      native: binary !== null && (await nativeFilters(binary)) !== null,
      databases,
    });
  });

  /**
   * The precomputed answer to an explore request, if the sums can give
   * one: no filters beyond (optionally) a level band whose edges sit on
   * the 200-point buckets. Returns the statement (taking `pos` first)
   * and its extra binds, or null when only the live join can answer.
   * Old unbucketed tables answer only the bandless question.
   */
  const summedPath = (
    db: InstanceType<typeof Database>,
    get: (key: string) => string | undefined,
  ): ((pos: unknown) => unknown[]) | null => {
    if (!hasMoveCounts(db)) return null;
    const others = gamesWhere((k) => (k === 'band' ? undefined : get(k)), 'g.');
    if (others.clauses.length > 0) return null;
    const band = parseBand(get('band'));
    const bucketed =
      db.prepare("SELECT 1 FROM pragma_table_info('move_counts') WHERE name = 'eb'").get() !==
      undefined;
    const grouped = (extra: string) =>
      db.prepare(
        `SELECT uci, SUM(w) AS w, SUM(d) AS d, SUM(b) AS b FROM move_counts
         WHERE pos = ?${extra} GROUP BY uci
         ORDER BY SUM(w) + SUM(d) + SUM(b) DESC, uci`,
      );
    if (!band) {
      const stmt = bucketed
        ? grouped('')
        : db.prepare(
            'SELECT uci, w, d, b FROM move_counts WHERE pos = ? ORDER BY w + d + b DESC, uci',
          );
      return (pos) => stmt.all(pos);
    }
    if (!bucketed) return null;
    if (band.lo % 200 !== 0 || (band.hi !== null && (band.hi + 1) % 200 !== 0)) return null;
    if (band.hi === null) {
      const stmt = grouped(' AND eb >= ?');
      const lo = band.lo / 200;
      return (pos) => stmt.all(pos, lo);
    }
    const stmt = grouped(' AND eb BETWEEN ? AND ?');
    const lo = band.lo / 200;
    const hi = (band.hi + 1) / 200 - 1;
    return (pos) => stmt.all(pos, lo, hi);
  };

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
  /**
   * What a list row carries of the moves themselves: the mainline's length
   * and its first plies as bare SAN — enough for a notation column and a
   * details fallback, while the full game stays a /refgames/:id/pgn fetch.
   */
  const SAN_PREFIX_PLIES = 24;
  const movesPreview = (moves: string): { plyCount: number; sanPrefix: string | null } => {
    if (!moves) return { plyCount: 0, sanPrefix: null };
    const sans = moves.split(' ');
    return { plyCount: sans.length, sanPrefix: sans.slice(0, SAN_PREFIX_PLIES).join(' ') };
  };
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

  /**
   * A filtered count is a scan, and at reference-database sizes an
   * unbounded one costs seconds per new filter combination. Counting
   * stops at this many: the browser shows "10,000+", which answers the
   * question a count answers ("roughly how much is there") without
   * walking two million rows to finish the digit.
   */
  const COUNT_CAP = 10_000;

  /**
   * Value suggestions for the search box's player-shaped qualifiers,
   * answered from the derived players lookup — tens of thousands of
   * names behind an indexed prefix LIKE, ordered by how many games
   * each name carries. Cheap by construction. A mount without the
   * lookup tables simply offers nothing; openings and ECO come from
   * the vendored catalogue (/api/openings), not from here — the
   * language's names should not depend on which database is picked —
   * and events have no lookup table, so suggesting them would scan
   * the games themselves.
   */
  api.get('/refgames/suggest', (c) => {
    const found = fromQuery(c);
    if (!found) return c.json({ names: [] });
    const q = (c.req.query('q') ?? '').trim();
    // Tournaments answer from their own lookup — a contains match, not
    // the players' prefix, because a tournament is remembered by any
    // word of its name ("olympiad" must find "42nd Olympiad").
    if (c.req.query('field') === 'event') {
      if (!hasEvents(found.db)) return c.json({ names: [] });
      const rows = (
        q
          ? found.db
              .prepare(
                'SELECT event AS name, games FROM events WHERE event LIKE ? ORDER BY games DESC LIMIT 50',
              )
              .all(`%${q}%`)
          : found.db.prepare('SELECT event AS name, games FROM events ORDER BY games DESC LIMIT 50').all()
      ) as { name: string; games: number }[];
      return c.json({ names: rows });
    }
    if (!hasLookups(found.db)) return c.json({ names: [] });
    // An empty prefix answers with the database's biggest names — the
    // panel opens on them before a character is typed.
    const rows = (
      q
        ? found.db
            .prepare(
              'SELECT name, games FROM players WHERE name LIKE ? ORDER BY games DESC LIMIT 50',
            )
            .all(`${q}%`)
        : found.db.prepare('SELECT name, games FROM players ORDER BY games DESC LIMIT 50').all()
    ) as { name: string; games: number }[];
    return c.json({ names: rows });
  });

  api.get('/refgames/search', (c) => {
    const found = fromQuery(c);
    if (!found) return c.json({ error: 'no reference games database' }, 503);
    const { name, db } = found;
    // The box's query language peels its recognised terms off first;
    // whatever is left runs the plain needle path below unchanged.
    const parsed = parseSearchQuery((c.req.query('q') ?? '').trim());
    const q = parsed.text;
    // Keyset, not OFFSET: the page after id X is `id < X`, a seek —
    // OFFSET walks and discards everything above it, so page forty of a
    // deep scroll cost more than page one. The cursor is the last row id
    // the client has.
    const cursor = Number(c.req.query('cursor')) || null;
    const seek = hasLookups(db);

    // One box searches everything a game is findable by: players, the
    // opening name, and the ECO code (prefix match, so "B9" finds B90-B99).
    // Beside it, the structured filters — player/side/outcome, opening,
    // event, dates, result, strength — every combination composable (see
    // gamesWhere).
    // The parsed terms ride through gamesWhere as its `terms` key — the
    // ONE compiler for both the window's fields and the box's language,
    // so `kasparov vs karpov` in the box and Player + Opponent in the
    // window build the same SQL, and the deep-search route composes the
    // same way. The raw query's own `terms` key (if a caller sent one)
    // is overridden: this route's terms come from `q` alone.
    const structured = gamesWhere(
      (k) =>
        k === 'terms'
          ? parsed.terms.length > 0
            ? JSON.stringify(parsed.terms)
            : undefined
          : c.req.query(k),
      '',
      seek,
    );
    const clauses = [...structured.clauses];
    const args = [...structured.binds];

    if (q) {
      if (seek) {
        // Resolve the query against the SMALL lookup tables first —
        // distinct players and openings number in the tens of
        // thousands whatever the game count — so the expensive part of
        // a search is decided before the games table is touched.
        //
        // Three regimes fall out of what resolves:
        // - nothing: the answer is empty, and it costs a lookup-table
        //   LIKE instead of the one full walk this route had left (the
        //   deferred no-match worst case — measured ~124 ms per 280k
        //   games, linear).
        // - a rare something: the resolved names' own game counts say
        //   so, and the union-seek below SEEKS those games through the
        //   per-column indexes instead of walking everything to find a
        //   handful of rows near the bottom.
        // - a common something: the walk was always fine here — it
        //   fills its page near the top ids and stops — and a
        //   materialised union of half the corpus would not be. The
        //   hash-set probe stays.
        const CAP = 200;
        const like = `%${q}%`;
        const names = db
          .prepare('SELECT name, games FROM players WHERE name LIKE ? LIMIT ?')
          .all(like, CAP + 1) as { name: string; games: number }[];
        const opens = db
          .prepare(
            'SELECT DISTINCT opening, games FROM openings WHERE opening IS NOT NULL AND opening LIKE ? LIMIT ?',
          )
          .all(like, CAP + 1) as { opening: string; games: number }[];
        const ecos = db
          .prepare(
            'SELECT eco, SUM(games) AS games FROM openings WHERE eco IS NOT NULL AND eco LIKE ? GROUP BY eco LIMIT ?',
          )
          .all(`${q}%`, CAP + 1) as { eco: string; games: number }[];
        if (names.length === 0 && opens.length === 0 && ecos.length === 0) {
          return c.json({
            total: cursor === null ? 0 : null,
            capped: cursor === null ? false : undefined,
            nextCursor: null,
            rows: [],
          });
        }
        const expected = [...names, ...opens, ...ecos].reduce((sum, r) => sum + r.games, 0);
        const small =
          names.length <= CAP && opens.length <= CAP && ecos.length <= CAP && expected <= 50_000;
        if (small) {
          const arms: string[] = [];
          const armBinds: string[] = [];
          const arm = (column: string, values: string[]): void => {
            if (values.length === 0) return;
            arms.push(
              `SELECT id FROM games WHERE ${column} IN (${values.map(() => '?').join(',')})`,
            );
            armBinds.push(...values);
          };
          arm('white', names.map((r) => r.name));
          arm('black', names.map((r) => r.name));
          arm('opening', opens.map((r) => r.opening));
          arm('eco', ecos.map((r) => r.eco));
          clauses.unshift(`id IN (${arms.join(' UNION ')})`);
          args.unshift(...armBinds);
        } else {
          // The walk: each IN is materialised once into a hash set the
          // id-order scan probes — four LIKEs against tiny tables, not
          // against every row's text.
          clauses.unshift(
            `(white IN (SELECT name FROM players WHERE name LIKE ?)
              OR black IN (SELECT name FROM players WHERE name LIKE ?)
              OR opening IN (SELECT opening FROM openings WHERE opening LIKE ?)
              OR eco IN (SELECT DISTINCT eco FROM openings WHERE eco LIKE ?))`,
          );
          args.unshift(like, like, like, `${q}%`);
        }
      } else {
        clauses.unshift('(white LIKE ? OR black LIKE ? OR opening LIKE ? OR eco LIKE ?)');
        args.unshift(`%${q}%`, `%${q}%`, `%${q}%`, `${q}%`);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    // Infinite scroll asks for the same query over and over, so the count
    // is paid once on the first page and null afterwards — the client
    // keeps the total it already has. The empty query is free (meta knows
    // the table); a filtered count stops at the cap.
    let total: number | null = null;
    let capped = false;
    if (cursor === null) {
      if (where === '') {
        total = tableCount(name, db);
      } else {
        const n = (
          db
            .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM games ${where} LIMIT ?)`)
            .get(...args, COUNT_CAP + 1) as { n: number }
        ).n;
        capped = n > COUNT_CAP;
        total = capped ? COUNT_CAP : n;
      }
    }
    const page = db
      .prepare(
        `SELECT id, white, black, white_elo, black_elo, result, date, event, eco, opening, moves
         FROM games ${where}${where ? ' AND' : ' WHERE'} id < ?
         ORDER BY id DESC LIMIT ${PAGE}`,
      )
      .all(...args, cursor ?? Number.MAX_SAFE_INTEGER) as (RefGameRow & { moves: string })[];
    return c.json({
      total,
      capped: cursor === null ? capped : undefined,
      // The page after this one starts below the last id sent; a short
      // page is the end of the results.
      nextCursor: page.length === PAGE ? page[page.length - 1]!.id : null,
      // moves ride along to name the openings the source PGN left
      // nameless and to fill the notation preview; the page is 50 rows,
      // so the replay cost is nothing.
      rows: page.map(({ moves, ...bare }) => {
        const row = { ...bare, ...movesPreview(moves) };
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
    const { clauses, binds } = gamesWhere((k) => c.req.query(k), 'g.', hasLookups(db));
    const sql = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';

    const live = db.prepare(
      `SELECT p.uci AS uci,
                SUM(g.result = '1-0') AS w,
                SUM(g.result = '1/2-1/2') AS d,
                SUM(g.result = '0-1') AS b
         FROM plies p JOIN games g ON g.id = p.game_id
         WHERE p.pos = ?${sql}
         GROUP BY p.uci
         ORDER BY w + d + b DESC, p.uci`,
    );
    // Precomputed sums first; a position they answer nothing for may
    // still be a THIN one (under MOVE_COUNT_MIN_GAMES the build stores
    // no rows), so an empty answer falls back to the live aggregation,
    // which is instant on a row set that small.
    const summed = summedPath(db, (k) => c.req.query(k));
    let rows = (summed ? summed(key) : live.all(key, ...binds)) as {
      uci: string;
      w: number;
      d: number;
      b: number;
    }[];
    if (rows.length === 0 && summed) {
      rows = live.all(key, ...binds) as typeof rows;
    }

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

    const { clauses, binds } = gamesWhere((k) => c.req.query(k), 'g.', hasLookups(db));
    const sql = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
    // The map's sweep never filters, and the live aggregation is what made
    // its first batch cost seconds — see REFGAMES_MOVE_COUNTS.
    const live = db.prepare(
      `SELECT p.uci AS uci,
              SUM(g.result = '1-0') AS w,
              SUM(g.result = '1/2-1/2') AS d,
              SUM(g.result = '0-1') AS b
       FROM plies p JOIN games g ON g.id = p.game_id
       WHERE p.pos = ?${sql}
       GROUP BY p.uci
       ORDER BY w + d + b DESC, p.uci`,
    );
    const summed = summedPath(db, (k) => c.req.query(k));

    const positions = fens.map((fen) => {
      const setup = parseFen(fen.trim());
      if (setup.isErr) return { fen, moves: [] };
      const position = Chess.fromSetup(setup.unwrap());
      if (position.isErr) return { fen, moves: [] };
      const pos = position.unwrap();
      const key = toDbKey(hashSetup(pos.toSetup()));
      let rows = (summed ? summed(key) : live.all(key, ...binds)) as {
        uci: string;
        w: number;
        d: number;
        b: number;
      }[];
      // Thin positions store no precomputed rows — see
      // MOVE_COUNT_MIN_GAMES; their live sum is instant.
      if (rows.length === 0 && summed) rows = live.all(key, ...binds) as typeof rows;
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

  /**
   * Search the WHOLE database for a position — any depth, not just the
   * position index's first thirty plies. An explicit action with a
   * progress stream, not a per-keystroke query: the worst case is a
   * replay-scan of every game.
   *
   * Three prefilters reject most games with integer comparisons before
   * any replay: men only leave the board, so a game whose final per-side
   * counts (a SAN scan stored at index time) exceed the target's cannot
   * contain it, nor can one with fewer plies than the target is missing
   * men. gamesWhere's filters cut the candidates first — a player or
   * date filter turns the scan into seconds. Survivors are replayed with
   * the same chessops+zobrist pipeline as the index, stopping early the
   * moment a side's men dip below the target's.
   *
   * ndjson: {type:'progress'} frames as it scans, {type:'game'} per hit
   * (capped), {type:'done', scanned, matched, exhaustive} at the end.
   * The scan yields to the event loop between batches, so the server
   * keeps answering while it runs.
   */
  const DEEP_SEARCH_CAP = 200;
  api.get('/refgames/deep-search', async (c) => {
    const found = fromQuery(c);
    if (!found) return c.json({ error: 'no reference games database' }, 503);
    const { db } = found;
    // Two hunts share this route: a position (fen, optionally relaxed a
    // rung by match=) or a material situation (material=, no position at
    // all — see shared/scanMatch.ts for both models). One or the other,
    // never a mixture: a fen beside a material spec has no meaning.
    const fen = c.req.query('fen')?.trim();
    const matchRaw = c.req.query('match');
    const materialRaw = c.req.query('material');
    if (materialRaw !== undefined && (fen !== undefined || matchRaw !== undefined)) {
      return c.json({ error: 'material search takes no fen or match' }, 400);
    }
    if (matchRaw !== undefined && !(MATCH_MODES as readonly string[]).includes(matchRaw)) {
      return c.json({ error: 'bad match mode' }, 400);
    }
    const mode = (matchRaw as MatchMode | undefined) ?? 'exact';
    const spec = materialRaw !== undefined ? parseMaterialSpec(materialRaw) : null;
    if (materialRaw !== undefined && spec === null) {
      return c.json({ error: 'bad material spec' }, 400);
    }

    let target: PositionTarget | null = null;
    // The men-column prefilter, one shape for every hunt: a game only
    // ever loses men, so it contains a qualifying position only if its
    // final counts dip to the ceiling or below, and only if it is long
    // enough — `missing` captures for a position hunt, `stable - 1`
    // plies of standing still for a material one.
    let menCeilW: number;
    let menCeilB: number;
    let minPly: number;
    if (spec) {
      const bounds = materialMenBounds(spec);
      menCeilW = bounds.hiW;
      menCeilB = bounds.hiB;
      minPly = spec.stable - 1;
    } else {
      if (!fen) return c.json({ error: 'expected fen' }, 400);
      const setup = parseFen(fen);
      if (setup.isErr) return c.json({ error: 'bad fen' }, 400);
      const position = Chess.fromSetup(setup.unwrap());
      // The relaxed rungs compare pawn squares, files or counts and the
      // side to move — none of the facts legality guards — so a kingless
      // sketch (a pawn-structure query) is a legitimate target there and
      // builds from the raw setup. Exact stays strict: its key must come
      // from the NORMALISED setup (shared/zobrist.ts's consistency rule),
      // which only a legal position can produce. Mirrored in
      // native/src/deep.rs — the two paths must refuse and accept the
      // same inputs.
      if (position.isErr && mode === 'exact') return c.json({ error: 'bad position' }, 400);
      target = position.isErr
        ? positionTarget(setup.unwrap(), mode)
        : positionTarget(position.unwrap(), mode);
      menCeilW = target.w;
      menCeilB = target.b;
      minPly = 32 - target.w - target.b;
    }

    // The search box rides along with the hunt: `q` parses here with
    // the shared parser, its plain text becomes a player term (either
    // seat — the meaning the text search gives bare words), and the
    // terms travel as gamesWhere's `terms` key. ONE getter feeds the
    // JS WHERE, the native negotiation and the native forward below,
    // so the three paths cannot disagree about what was asked. A
    // caller-sent raw `terms` key is overridden — this route's terms
    // come from `q` alone, as on /refgames/search.
    const parsedQ = parseSearchQuery((c.req.query('q') ?? '').trim());
    const qTerms: SearchTerm[] = parsedQ.text
      ? [...parsedQ.terms, { kind: 'player', value: parsedQ.text }]
      : parsedQ.terms;
    const getFilter = (k: string): string | undefined =>
      k === 'terms'
        ? qTerms.length > 0
          ? JSON.stringify(qTerms)
          : undefined
        : c.req.query(k);

    // The filter SQL, computed once for every path below: the resident
    // scan narrows its id list with it, the JS loop pages with it.
    const { clauses, binds } = gamesWhere(getFilter, '', hasLookups(db));
    const sqlAnd = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
    // A database indexed before the reachability columns scans without
    // the prefilter — slower, never wrong; the next index pass adds them.
    const hasMen =
      db.prepare("SELECT 1 FROM pragma_table_info('games') WHERE name = 'final_wmen'").get() !==
      undefined;
    const menWhere = hasMen
      ? ` AND (final_wmen IS NULL OR final_wmen <= ?)
          AND (final_bmen IS NULL OR final_bmen <= ?)
          AND (ply_count IS NULL OR ply_count >= ?)`
      : '';
    const menBinds = hasMen ? [menCeilW, menCeilB, minPly] : [];

    const metaValue = (key: string): string | undefined =>
      (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)
        ?.value;
    const filePath = fileFor(found.name);
    // Freshness: the fast paths answer only for games the index pass
    // has seen. An append that died between its insert and its index
    // pass leaves a tail with no packs and no keys — those games must
    // fall to the paths that read the games table itself, or they
    // silently vanish from every fast answer.
    const fresh =
      Number(metaValue('indexed_through') ?? 0) >=
      (((db.prepare('SELECT MAX(id) AS n FROM games').get() as { n: number | null }).n) ?? 0);

    /**
     * The key index: an exact-rung hunt against a packed database is a
     * LOOKUP (shared/keyIndex.ts) — one bucket read, a binary search,
     * and a handful of candidate games verified by replay — needing no
     * residency, no worker and no opt-in. Everything else scans.
     */
    if (
      !spec &&
      mode === 'exact' &&
      fresh &&
      metaValue(KEY_INDEX_META) === String(KEY_INDEX_VERSION)
    ) {
      const bucket = db
        .prepare('SELECT entries FROM key_index WHERE bucket = ?')
        .get(keyBucket(target!.key32)) as { entries: Buffer } | undefined;
      const candidates: number[] = [];
      if (bucket) {
        const blob = bucket.entries;
        const n = blob.length / 8;
        const { lo, hi } = low16Bounds(target!.key32);
        // First entry >= lo, then walk the low16 run — one candidate
        // per game, the sort's first (earliest ply) standing for it.
        let a = 0;
        let z = n;
        while (a < z) {
          const mid = (a + z) >> 1;
          if (blob.readBigUInt64LE(mid * 8) < lo) a = mid + 1;
          else z = mid;
        }
        let last = -1;
        for (; a < n; a += 1) {
          const entry = blob.readBigUInt64LE(a * 8);
          if (entry >= hi) break;
          const id = entryGameId(entry);
          if (id !== last) {
            candidates.push(id);
            last = id;
          }
        }
      }
      // The game filters, over the candidates instead of the corpus:
      // a hundred ids probe an index in microseconds where the scan
      // paths pre-filter ten million rows.
      let allowed: Set<number> | null = null;
      if (clauses.length > 0) {
        allowed = new Set();
        for (let at = 0; at < candidates.length; at += 500) {
          const chunk = candidates.slice(at, at + 500);
          const rows = db
            .prepare(
              `SELECT id FROM games WHERE id IN (${chunk.map(() => '?').join(',')})${sqlAnd}`,
            )
            .all(...chunk, ...binds) as { id: number }[];
          for (const row of rows) allowed.add(row.id);
        }
      }
      const eligible = allowed ? candidates.filter((id) => allowed.has(id)) : candidates;
      const headerStmt = db.prepare(
        `SELECT id, white, black, white_elo, black_elo, result, date, event, eco, opening, moves
         FROM games WHERE id = ?`,
      );
      c.header('Content-Type', 'application/x-ndjson');
      return stream(c, async (out) => {
        let matched = 0;
        let scanned = 0;
        for (const id of eligible) {
          if (out.aborted || c.req.raw.signal?.aborted) return;
          scanned += 1;
          const row = headerStmt.get(id) as (RefGameRow & { moves: string }) | undefined;
          if (!row) continue;
          // A 32-bit prefix match is a candidate, not an answer: the
          // reference replay decides, as everywhere else.
          const hitPly = replayPositionHit(row.moves, target!);
          if (hitPly === null) continue;
          matched += 1;
          const { moves, ...headers } = row;
          await out.writeln(
            JSON.stringify({ type: 'game', ply: hitPly, ...headers, ...movesPreview(moves) }),
          );
          if (matched >= DEEP_SEARCH_CAP) break;
        }
        await out.writeln(
          JSON.stringify({
            type: 'done',
            scanned,
            total: eligible.length,
            matched,
            exhaustive: matched < DEEP_SEARCH_CAP,
          }),
        );
      });
    }

    /**
     * The resident scan: a database whose owner opted in (fast search
     * on the Databases page) holds its packed index in a worker
     * thread's memory and answers by scanning bytes instead of parsing
     * SAN (refgamesScan.ts / scanWorker.ts). It outranks the native
     * spawn — memory beats a child re-reading the file — and anything
     * that goes wrong here falls through to the paths below, which
     * answer identically, only slower. Loaded lazily, so the first
     * hunt after a restart pays the load once; evicted when idle.
     */
    let resident = false;
    if (
      fresh &&
      metaValue('fast_scan') === '1' &&
      metaValue(SCAN_PACK_META) === String(SCAN_PACK_VERSION)
    ) {
      try {
        await ensureResident(filePath);
        resident = residentStatus(filePath) !== null;
      } catch (error) {
        console.error(
          `deep-search (${found.name}): resident index unavailable: ${(error as Error).message}`,
        );
      }
    }
    if (resident) {
      // With filters, the worker scans only the ids the SQL lets
      // through; without, the pack's own gates do the cutting. The men
      // prefilter is deliberately NOT in this query: the pack scan
      // gates men per game anyway, and leaving it out makes the list a
      // function of the filters alone — cacheable across positions and
      // hunts, which is where the 4-second SELECT over ten million
      // rows actually went. Revalidated by the index pass's own marks,
      // so an append or rebuild drops the stale list.
      let ids: Float64Array | null = null;
      if (clauses.length > 0) {
        const stamp = `${metaValue('indexed_through') ?? ''}|${metaValue('indexed_at') ?? ''}`;
        const key = `${filePath}|${sqlAnd}|${JSON.stringify(binds)}`;
        const cached = residentIdCache.get(key);
        if (cached && cached.stamp === stamp) {
          ids = cached.ids;
        } else {
          ids = new Float64Array(
            (
              db.prepare(`SELECT id FROM games WHERE 1${sqlAnd} ORDER BY id`).all(...binds) as {
                id: number;
              }[]
            ).map((r) => r.id),
          );
          residentIdCache.set(key, { ids, stamp });
          if (residentIdCache.size > 8) {
            residentIdCache.delete(residentIdCache.keys().next().value!);
          }
        }
      }
      const total = ids
        ? ids.length
        : (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
      const headerStmt = db.prepare(
        `SELECT id, white, black, white_elo, black_elo, result, date, event, eco, opening, moves
         FROM games WHERE id = ?`,
      );
      c.header('Content-Type', 'application/x-ndjson');
      return stream(c, async (out) => {
        // Worker messages land between awaits; the queue keeps id
        // order, and the loop drains it into frames. Hits arrive
        // VERIFIED — the shards replay every candidate the pack could
        // only gate, through the same reference functions this route
        // would use — so a hit here just needs its header row. Only a
        // game nothing in the worker could settle (null ply) is
        // decided here by replay.
        const queue: { id: number; ply: number | null }[] = [];
        let progress = 0;
        let finished = false;
        let failed = false;
        const run = residentScan(filePath, spec ? { spec } : { target: target! }, ids, {
          onHits: (pairs) => {
            for (let at = 0; at < pairs.length; at += 2) {
              queue.push({ id: pairs[at]!, ply: pairs[at + 1]! });
            }
          },
          onBad: (badIds) => {
            for (const id of badIds) queue.push({ id, ply: null });
          },
          onProgress: (scanned) => {
            progress = scanned;
          },
        });
        run.done
          .then((result) => {
            progress = result.scanned;
            finished = true;
          })
          .catch(() => {
            failed = true;
            finished = true;
          });
        let matched = 0;
        let lastProgress = -1;
        for (;;) {
          if (out.aborted || c.req.raw.signal?.aborted) {
            run.cancel();
            return;
          }
          while (queue.length > 0 && matched < DEEP_SEARCH_CAP) {
            const item = queue.shift()!;
            const row = headerStmt.get(item.id) as (RefGameRow & { moves: string }) | undefined;
            if (!row) continue;
            let hitPly = item.ply;
            if (item.ply === null) {
              hitPly = spec ? replayMaterialHit(row.moves, spec) : replayPositionHit(row.moves, target!);
            }
            if (hitPly === null) continue;
            matched += 1;
            const { moves, ...headers } = row;
            await out.writeln(
              JSON.stringify({ type: 'game', ply: hitPly, ...headers, ...movesPreview(moves) }),
            );
          }
          if (matched >= DEEP_SEARCH_CAP) {
            run.cancel();
            queue.length = 0;
          }
          if (finished && queue.length === 0) break;
          if (progress !== lastProgress) {
            lastProgress = progress;
            await out.writeln(JSON.stringify({ type: 'progress', scanned: progress, total, matched }));
          }
          await new Promise((tick) => setTimeout(tick, 15));
        }
        // A worker failure ends the stream without its done frame — the
        // client's failed-not-empty signal, exactly as a dead child.
        if (failed) return;
        await out.writeln(
          JSON.stringify({ type: 'done', scanned: progress, total, matched, exhaustive: matched < DEEP_SEARCH_CAP }),
        );
      });
    }

    // The native scan, when the binary is here and this mount is the
    // real data directory (its --data layout): same prefilters, same
    // filters, same frames — measured 1.3 s where the loop below takes
    // 12.7 s on an Elite month — spawned per request and piped straight
    // through. A client that goes away takes the child with it, which
    // is the cleanest cancel this scan can have.
    //
    // "Same filters" is negotiated, not assumed: the binary is used
    // only for requests whose every filter it declared (cached per
    // build, see nativeFilters). A request using a filter the binary
    // does not know falls through to the JS scan below, which is the
    // whole arrangement that lets gamesWhere grow ahead of the crate.
    const binary = dir === REFGAMES_DIR ? nativeBinary() : null;
    const declared = binary ? await nativeFilters(binary) : null;
    const native =
      binary && declared && undeclaredFilters(declared, getFilter).length === 0 ? binary : null;
    if (native) {
      const filters: Record<string, string> = {};
      for (const key of GAMES_WHERE_KEYS) {
        const value = getFilter(key);
        if (value !== undefined) filters[key] = value;
      }
      const argv = ['deep-search', found.name, '--filters', JSON.stringify(filters), '--data', DATA];
      // The binary receives the CANONICAL spec, never the request's own
      // JSON: this route validated above, for both implementations.
      if (spec) argv.push('--material', canonicalMaterial(spec));
      else {
        argv.push('--fen', fen!);
        if (mode !== 'exact') argv.push('--match', mode);
      }
      c.header('Content-Type', 'application/x-ndjson');
      return stream(c, (out) =>
        new Promise<void>((done) => {
          // Windows throws synchronously for an unrunnable binary;
          // POSIX emits 'error' instead (see spawnJob). Either way the
          // stream ends without a `done` frame, which is the client's
          // signal that the search failed rather than found nothing.
          let child: ReturnType<typeof spawn>;
          try {
            child = spawn(native, argv, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
          } catch (error) {
            console.error(`deep-search (${found.name}): could not start ${native}: ${(error as Error).message}`);
            done();
            return;
          }
          const kill = (): void => {
            child.kill();
          };
          c.req.raw.signal?.addEventListener('abort', kill);
          out.onAbort(kill);
          child.stdout!.on('data', (chunk: Buffer) => {
            void out.write(chunk).catch(kill);
          });
          // The binary's own diagnostic would otherwise be discarded.
          child.stderr!.on('data', (chunk: Buffer) => {
            const line = chunk.toString().trim();
            if (line) console.error(`deep-search (${found.name}): ${line}`);
          });
          let settled = false;
          const finish = (code: number | null): void => {
            if (settled) return;
            settled = true;
            c.req.raw.signal?.removeEventListener('abort', kill);
            if (code !== 0 && code !== null && !out.aborted) {
              console.error(`deep-search (${found.name}): exited with code ${code}`);
            }
            done();
          };
          child.on('error', (error) => {
            console.error(`deep-search (${found.name}): could not start ${native}: ${error.message}`);
            finish(-1);
          });
          child.on('close', finish);
        }),
      );
    }

    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM games WHERE 1${menWhere}${sqlAnd}`)
        .get(...menBinds, ...binds) as { n: number }
    ).n;
    const page = db.prepare(
      `SELECT id, white, black, white_elo, black_elo, result, date, event, eco, opening, moves
       FROM games
       WHERE id > ?${menWhere}${sqlAnd}
       ORDER BY id LIMIT 1000`,
    );

    c.header('Content-Type', 'application/x-ndjson');
    return stream(c, async (out) => {
      let lastId = 0;
      let scanned = 0;
      let matched = 0;
      for (;;) {
        // A reader that has gone (navigated away, cancelled the stream)
        // must take the scan with it — the loop used to run the whole
        // database for nobody.
        if (out.aborted || c.req.raw.signal?.aborted) return;
        const batch = page.all(lastId, ...menBinds, ...binds) as (RefGameRow & {
          moves: string;
        })[];
        if (batch.length === 0) break;
        for (const row of batch) {
          scanned += 1;
          // The replay functions are the reference the pack scanner is
          // held to — see server/refgamesScan.ts.
          const hitPly = spec
            ? replayMaterialHit(row.moves, spec)
            : replayPositionHit(row.moves, target!);
          if (hitPly !== null) {
            matched += 1;
            const { moves, ...headers } = row;
            await out.writeln(
              JSON.stringify({ type: 'game', ply: hitPly, ...headers, ...movesPreview(moves) }),
            );
          }
          if (matched >= DEEP_SEARCH_CAP) break;
        }
        lastId = batch.at(-1)!.id;
        await out.writeln(JSON.stringify({ type: 'progress', scanned, total, matched }));
        if (matched >= DEEP_SEARCH_CAP) break;
        // The scan is CPU work on the request path — let other requests
        // in between batches.
        await new Promise((resolve) => setImmediate(resolve));
      }
      await out.writeln(
        JSON.stringify({ type: 'done', scanned, total, matched, exhaustive: matched < DEEP_SEARCH_CAP }),
      );
    });
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

  // Closing the api takes its resident workers with it — otherwise a
  // test suite (or a re-mounted server) leaves threads holding indexes
  // for handles that no longer answer.
  return Object.assign(api, {
    closeDb: () => {
      close();
      evictAllResidents();
    },
  });
}

// Referenced by scripts that need the same resolution (tune-dbs, the
// bundled-set curator, the demo curator) without duplicating the layout.
export { REFGAMES_DIR, LEGACY_DB };
