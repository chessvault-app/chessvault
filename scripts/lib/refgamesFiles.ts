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

/**
 * The database the DEMO curates from: the biggest LICHESS-sourced one,
 * falling back to the biggest of any origin only when no Lichess file
 * exists. Pinned by name on purpose (lanph3re's call, 2026-08-28): the
 * demo slice ships in the repository, Lichess dumps are CC0, and other
 * corpora on this machine (Lumbra's Gigabase, CC BY-NC-SA) must not
 * become repository content by silently growing past them in size.
 */
export function demoSourceRefgames(): string | null {
  const files = refgamesFiles();
  if (files.length === 0) return null;
  const bySize = files
    .map((f) => ({ f, bytes: statSync(f).size }))
    .sort((a, b) => b.bytes - a.bytes);
  const lichess = bySize.find(({ f }) =>
    f.replaceAll('\\', '/').split('/').pop()!.startsWith('lichess'),
  );
  return (lichess ?? bySize[0]!).f;
}
