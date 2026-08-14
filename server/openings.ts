import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { DATA_OPENINGS, REPO_ROOT } from './paths.ts';
import { BOOK_SCHEMA_VERSION, hashSetup } from '../shared/zobrist.ts';

/**
 * The vendored lichess chess-openings TSVs: 3,810 named lines, and the
 * source every opening index is made from — the picker's catalogue, the
 * hash → name map the explorer titles positions with, and the membership
 * set behind the analysis views' book tags.
 *
 * They are runtime data, not build input, which is why they ship with the
 * app (package.json build.extraResources). An installed desktop app has no
 * repository to run a build script in, and a build step nobody can run is
 * the same thing as a missing feature.
 */
const VENDOR = resolve(REPO_ROOT, 'scripts', 'vendor', 'chess-openings');

export interface Opening {
  eco: string;
  name: string;
}

interface OpeningsFile {
  schemaVersion: number;
  count: number;
  byKey: Record<string, [string, string]>;
  /** Every position ALONG every line, not only each line's last. A
      position can sit deep inside known theory without any row happening
      to stop there — after 3...a6 4.Ba4 in the Ruy Lopez, the dataset
      continues in a dozen rows but ends in none — and membership, not
      naming, is what "is this move book?" asks. Optional because indexes
      compiled before it existed lack it; loading rebuilds those. */
  memberKeys?: string[];
}

/** Every `eco / name / pgn` row of the vendored dataset, headers skipped. */
function* openingRows(): Generator<[string, string, string]> {
  for (const file of ['a', 'b', 'c', 'd', 'e']) {
    for (const line of readFileSync(resolve(VENDOR, `${file}.tsv`), 'utf-8').split('\n')) {
      const [eco, name, pgn] = line.split('\t');
      if (!eco || !name || !pgn || eco === 'eco') continue; // header/blank
      yield [eco, name, pgn];
    }
  }
}

/**
 * Replay every line and key it by the shared Zobrist hash, so the server can
 * name any position with one map lookup. Fully offline; ~0.4 s.
 */
function compileOpenings(): { file: OpeningsFile; lines: number; collisions: number } {
  const byKey: OpeningsFile['byKey'] = {};
  const members = new Set<string>();
  let lines = 0;
  let collisions = 0;

  for (const [eco, name, pgn] of openingRows()) {
    const pos = Chess.default();
    let key = '';
    for (const token of pgn.split(/\s+/)) {
      if (!token || /^\d+\.+$/.test(token)) continue; // move numbers
      const move = parseSan(pos, token);
      if (!move) throw new Error(`bad SAN "${token}" in ${eco} ${name}`);
      pos.play(move);
      // Every waypoint is a member; only the row's end carries the name.
      key = hashSetup(pos.toSetup()).toString(16);
      members.add(key);
    }

    if (byKey[key]) collisions += 1;
    else byKey[key] = [eco, name];
    lines += 1;
  }

  return {
    file: {
      schemaVersion: BOOK_SCHEMA_VERSION,
      count: Object.keys(byKey).length,
      byKey,
      memberKeys: [...members],
    },
    lines,
    collisions,
  };
}

/** Compile and write data/openings.json. Also `npm run build:openings`. */
export function writeOpenings(): { path: string; count: number; lines: number; collisions: number } {
  const { file, lines, collisions } = compileOpenings();
  mkdirSync(dirname(DATA_OPENINGS), { recursive: true });
  writeFileSync(DATA_OPENINGS, JSON.stringify(file));
  return { path: DATA_OPENINGS, count: file.count, lines, collisions };
}

let cache: {
  mtimeMs: number;
  byKey: OpeningsFile['byKey'];
  members: Set<string>;
} | null = null;
/** One failure is enough: without this, a missing TSV would be re-read, and
    re-fail, on every explorer request for the life of the process. */
let unbuildable = false;

/**
 * The loaded index — names AND membership. Backed by data/openings.json,
 * which is COMPILED ON FIRST USE if it is not there — a fresh vault, a
 * fresh checkout and a fresh install all have opening names without
 * anybody running anything — and RECOMPILED if it predates the membership
 * set. Returns null only if the vendored TSVs are missing too. The file
 * is reloaded if it changes on disk.
 */
function loadIndex(): { byKey: OpeningsFile['byKey']; members: Set<string> } | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(DATA_OPENINGS).mtimeMs;
  } catch {
    if (unbuildable) return null;
    try {
      const { count } = writeOpenings();
      console.log(`openings: compiled ${count} positions -> ${DATA_OPENINGS}`);
      mtimeMs = statSync(DATA_OPENINGS).mtimeMs;
    } catch (error) {
      unbuildable = true;
      console.warn(`openings: no index and none could be built (${(error as Error).message})`);
      return null; // the explorer just shows no name
    }
  }
  if (!cache || cache.mtimeMs !== mtimeMs) {
    let parsed = JSON.parse(readFileSync(DATA_OPENINGS, 'utf-8')) as OpeningsFile;
    if (!parsed.memberKeys && !unbuildable) {
      // An index from before membership existed. If the TSVs are gone the
      // old file still answers names; membership then degrades to the
      // terminal positions it has, rather than to nothing.
      try {
        writeOpenings();
        console.log(`openings: recompiled ${DATA_OPENINGS} with the membership set`);
        mtimeMs = statSync(DATA_OPENINGS).mtimeMs;
        parsed = JSON.parse(readFileSync(DATA_OPENINGS, 'utf-8')) as OpeningsFile;
      } catch (error) {
        unbuildable = true;
        console.warn(`openings: stale index kept, none could be rebuilt (${(error as Error).message})`);
      }
    }
    cache = {
      mtimeMs,
      byKey: parsed.byKey,
      members: new Set(parsed.memberKeys ?? Object.keys(parsed.byKey)),
    };
  }
  return cache;
}

/** Name a position by its Zobrist hash (unsigned hex, as produced by
    `hashSetup(...).toString(16)`). */
export function openingsIndex(): OpeningsFile['byKey'] | null {
  return loadIndex()?.byKey ?? null;
}

/** Whether a position is anywhere in the catalogue's lines — the book test. */
export function isBookKey(hexKey: string): boolean {
  return loadIndex()?.members.has(hexKey) ?? false;
}

export function openingForKey(hexKey: string): Opening | null {
  const entry = openingsIndex()?.[hexKey];
  return entry ? { eco: entry[0], name: entry[1] } : null;
}

interface OpeningLine {
  eco: string;
  name: string;
  sans: string[];
}

let lineCache: OpeningLine[] | null = null;

/** Every named opening from the vendored TSVs, with its defining line as
    SAN. The dataset repeats a name once per TRANSPOSITION (17 rows of one
    Giuoco Pianissimo); a picker wants each opening once, under its most
    direct move order — so duplicates collapse to the shortest line. Parsed
    once; the TSVs only change with the app. */
function openingLines(): OpeningLine[] {
  if (lineCache) return lineCache;
  const byName = new Map<string, OpeningLine>();
  for (const [eco, name, pgn] of openingRows()) {
    const sans = pgn.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t));
    const key = `${eco}\t${name}`;
    const seen = byName.get(key);
    if (!seen || sans.length < seen.sans.length) byName.set(key, { eco, name, sans });
  }
  lineCache = [...byName.values()];
  return lineCache;
}

export function openingsApi(): Hono {
  const api = new Hono();
  // The full ECO catalogue, for the repertoire's opening picker. Answers
  // 503 rather than throwing if the dataset is missing: a picker that says
  // it has nothing to offer is recoverable, a 500 is a broken page.
  api.get('/openings', (c) => {
    try {
      const openings = openingLines();
      c.header('cache-control', 'private, max-age=86400');
      return c.json({ openings });
    } catch {
      return c.json({ error: 'the opening catalogue is missing from this install' }, 503);
    }
  });

  // One position's name and book membership, for the explorer pane's
  // title line and the analysis views' book tags. `book` can be true with
  // a null name: a waypoint inside theory that no row happens to end on.
  api.get('/opening', (c) => {
    const fen = c.req.query('fen');
    if (!fen) return c.json({ error: 'missing ?fen=' }, 400);
    try {
      const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
      const key = hashSetup(pos.toSetup()).toString(16);
      return c.json({ opening: openingForKey(key), book: isBookKey(key) });
    } catch {
      return c.json({ error: 'invalid FEN' }, 400);
    }
  });
  return api;
}
