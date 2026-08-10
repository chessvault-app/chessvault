import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file so it works regardless of cwd. */
export const REPO_ROOT = resolve(here, '..');

/** Env override, for deployments where the data lives outside the repo
    (the desktop app's local mode, a cloud volume). Empty means unset. */
const fromEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? resolve(value) : undefined;
};

/** The user's irreplaceable data. Plain files, intentionally git-friendly. */
export const VAULT = fromEnv('CHESS_VAULT_DIR') ?? resolve(REPO_ROOT, 'vault');
export const VAULT_STUDIES = resolve(VAULT, 'studies');
export const VAULT_NOTES = resolve(VAULT, 'notes');
export const VAULT_GAMES = resolve(VAULT, 'games');
/** PGN files the user drops in to be indexed into opening books. */
export const VAULT_SOURCES = resolve(VAULT, 'sources');
export const VAULT_CONFIG = resolve(VAULT, 'config.json');

/** Derived, rebuildable artefacts. Safe to delete at any time. */
export const DATA = fromEnv('CHESS_VAULT_DATA') ?? resolve(REPO_ROOT, 'data');
export const DATA_BOOKS = resolve(DATA, 'books');
export const DATA_PUZZLES = resolve(DATA, 'puzzles.sqlite');
export const DATA_OPENINGS = resolve(DATA, 'openings.json');
export const DATA_EXPLORER_CACHE = resolve(DATA, 'explorer-cache');

/**
 * Desktop update artefacts — `latest.yml` and the installers it names.
 *
 * Neither vault nor derived data: they are built on somebody's machine and
 * uploaded here, so they live on their own and are not backed up with the
 * vault (an installer is 80 MB of something you can rebuild) and not
 * deleted with the cache (deleting them would strand every installed app).
 */
export const UPDATES = fromEnv('CHESS_VAULT_UPDATES') ?? resolve(REPO_ROOT, 'updates');

/**
 * What this build is, read from package.json rather than written down.
 *
 * It was a literal in the health handler, and it stayed at 0.1.0 across
 * two releases — so the Settings page reported a version the server had
 * not been for some time. A number nobody has to remember to change is
 * the only kind that stays true.
 *
 * The packaged desktop server gets a copy beside its bundle (see
 * desktop/build-server.mjs); the repo reads its own.
 */
export const APP_VERSION = ((): string => {
  for (const at of [resolve(REPO_ROOT, 'package.json'), resolve(here, 'package.json')]) {
    try {
      const parsed = JSON.parse(readFileSync(at, 'utf-8')) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // Try the next place before giving up.
    }
  }
  return 'unknown';
})();
