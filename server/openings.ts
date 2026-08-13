import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { DATA_OPENINGS, REPO_ROOT } from './paths.ts';
import { BOOK_SCHEMA_VERSION, hashSetup } from '../shared/zobrist.ts';

/**
 * The vendored lichess chess-openings TSVs: 3,810 named lines, and the
 * source BOTH opening indexes are made from — the picker's catalogue, and
 * the hash → name map the explorer titles positions with.
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
  let lines = 0;
  let collisions = 0;

  for (const [eco, name, pgn] of openingRows()) {
    const pos = Chess.default();
    for (const token of pgn.split(/\s+/)) {
      if (!token || /^\d+\.+$/.test(token)) continue; // move numbers
      const move = parseSan(pos, token);
      if (!move) throw new Error(`bad SAN "${token}" in ${eco} ${name}`);
      pos.play(move);
    }

    const key = hashSetup(pos.toSetup()).toString(16);
    if (byKey[key]) collisions += 1;
    else byKey[key] = [eco, name];
    lines += 1;
  }

  return {
    file: { schemaVersion: BOOK_SCHEMA_VERSION, count: Object.keys(byKey).length, byKey },
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

let cache: { mtimeMs: number; byKey: OpeningsFile['byKey'] } | null = null;
/** One failure is enough: without this, a missing TSV would be re-read, and
    re-fail, on every explorer request for the life of the process. */
let unbuildable = false;

/**
 * Name a position by its Zobrist hash (unsigned hex, as produced by
 * `hashSetup(...).toString(16)`). Backed by data/openings.json, which is
 * COMPILED ON FIRST USE if it is not there — a fresh vault, a fresh
 * checkout and a fresh install all have opening names without anybody
 * running anything. Returns null only if the vendored TSVs are missing too.
 * The file is reloaded if it changes on disk.
 */
export function openingsIndex(): OpeningsFile['byKey'] | null {
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
    const parsed = JSON.parse(readFileSync(DATA_OPENINGS, 'utf-8')) as OpeningsFile;
    cache = { mtimeMs, byKey: parsed.byKey };
  }
  return cache.byKey;
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
  return api;
}
