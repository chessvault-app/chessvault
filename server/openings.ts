import { readFileSync, statSync } from 'node:fs';
import { DATA_OPENINGS } from './paths.ts';

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
