import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { DATA_OPENINGS, REPO_ROOT } from './paths.ts';

export interface Opening {
  eco: string;
  name: string;
}

interface OpeningsFile {
  byKey: Record<string, [string, string]>;
}

let cache: { mtimeMs: number; byKey: OpeningsFile['byKey'] } | null = null;

/**
 * Name a position by its Zobrist hash (unsigned hex, as produced by
 * `hashSetup(...).toString(16)`). Backed by data/openings.json from
 * `npm run build:openings`; returns null when the file is missing or the
 * position has no name. The file is reloaded if it changes on disk.
 */
export function openingForKey(hexKey: string): Opening | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(DATA_OPENINGS).mtimeMs;
  } catch {
    return null; // not built yet — the explorer just shows no name
  }
  if (!cache || cache.mtimeMs !== mtimeMs) {
    const parsed = JSON.parse(readFileSync(DATA_OPENINGS, 'utf-8')) as OpeningsFile;
    cache = { mtimeMs, byKey: parsed.byKey };
  }
  const entry = cache.byKey[hexKey];
  return entry ? { eco: entry[0], name: entry[1] } : null;
}

interface OpeningLine {
  eco: string;
  name: string;
  sans: string[];
}

let lineCache: OpeningLine[] | null = null;

/** Every named opening from the vendored lichess chess-openings TSVs, with
    its defining line as SAN. Parsed once; the TSVs only change with deploys. */
function openingLines(): OpeningLine[] {
  if (lineCache) return lineCache;
  const vendor = resolve(REPO_ROOT, 'scripts', 'vendor', 'chess-openings');
  const all: OpeningLine[] = [];
  for (const file of ['a', 'b', 'c', 'd', 'e']) {
    for (const line of readFileSync(resolve(vendor, `${file}.tsv`), 'utf-8').split('\n')) {
      const [eco, name, pgn] = line.split('\t');
      if (!eco || !name || !pgn || eco === 'eco') continue; // header/blank
      const sans = pgn.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t));
      all.push({ eco, name, sans });
    }
  }
  lineCache = all;
  return all;
}

export function openingsApi(): Hono {
  const api = new Hono();
  // The full ECO catalogue, for the repertoire's opening picker.
  api.get('/openings', (c) => {
    c.header('cache-control', 'private, max-age=86400');
    return c.json({ openings: openingLines() });
  });
  return api;
}
