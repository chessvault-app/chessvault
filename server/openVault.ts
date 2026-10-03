import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT, VAULT_SKELETON } from './paths.ts';
import { recoverInterruptedRestore } from './restore.ts';
import { seedWelcomeDocs } from './welcome.ts';

/**
 * What a start does to the vault before any route is built over it, in
 * order. Here rather than inline in server/index.ts so the order can be
 * tested against a vault of the test's own.
 */
export function openVault(vault: string = VAULT): void {
  // Before anything reads the vault or creates a folder in it: a restore
  // the server was killed in the middle of is put back (see
  // server/restore.ts), and a skeleton folder made first would stand where
  // one of its renames has to go back to.
  recoverInterruptedRestore(vault);

  // Opening an empty folder as a vault must Just Work: create the skeleton
  // up front so every listing endpoint finds its directory. The wipe and
  // the restore put back the same list (server/paths.ts).
  for (const name of VAULT_SKELETON) mkdirSync(resolve(vault, name), { recursive: true });

  // A fresh vault opens with a welcome study and note, onboarding as
  // content, seeded once and never resurrected (see welcome.ts).
  seedWelcomeDocs(vault);
}
