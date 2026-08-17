import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA } from '../../server/paths.ts';

/**
 * The reference-game databases on this machine: everything in
 * `data/refgames/`, plus the single-file era's `data/refgames.sqlite` when
 * it is still there (a machine that has not run the server since the
 * layout became plural).
 */
export function refgamesFiles(): string[] {
  const files: string[] = [];
  const dir = resolve(DATA, 'refgames');
  try {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.sqlite')) files.push(resolve(dir, f));
    }
  } catch {
    // no directory yet
  }
  const legacy = resolve(DATA, 'refgames.sqlite');
  if (existsSync(legacy)) files.push(legacy);
  return files;
}

/**
 * The biggest of them — the honest default input for curators that shrink
 * a full database into a small one. Size is the signal: a curated set
 * also ends in .sqlite, and curating a curation quietly produces less
 * than was asked.
 */
export function biggestRefgames(): string | null {
  const files = refgamesFiles();
  if (files.length === 0) return null;
  return files.map((f) => ({ f, bytes: statSync(f).size })).sort((a, b) => b.bytes - a.bytes)[0]!.f;
}
