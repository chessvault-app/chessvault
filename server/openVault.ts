import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT, VAULT_SKELETON } from './paths.ts';
import { recoverInterruptedRestore } from './restore.ts';
import { seedWelcomeDocs } from './welcome.ts';

/**
 * What a start does to the vault before any route is built over it, in
 * order. Here rather than inline in server/index.ts so the order can be
 * tested against a vault of the test's own.
 *
 * `partWay` is true when a restore stands part way and could not be put
 * back (server/restore.ts): the server then starts guarded, and nothing
 * the start does may make a folder or write a file in the vault. A folder
 * made now stands where one set aside has to go back to, and the put-back
 * skips a rename whose source is there again, so the vault's own folder
 * would stay set aside with nothing in the app to fetch it. The routes are
 * told the same (mountVault's `partWay`), and the history writer waits
 * for the journal to go before it opens its repo (server/vaultBackup.ts).
 * Once the vault is put back its folders are the ones it had, made by an
 * earlier start; the welcome waits for the next start.
 */
export function openVault(
  vault: string = VAULT,
  options: { move?: (from: string, to: string) => void } = {},
): { partWay: boolean } {
  // Before anything reads the vault or creates a folder in it: a restore
  // the server was killed in the middle of is put back.
  if (recoverInterruptedRestore(vault, options) === 'part-way') return { partWay: true };

  // Opening an empty folder as a vault must Just Work: create the skeleton
  // up front so every listing endpoint finds its directory. The wipe and
  // the restore put back the same list (server/paths.ts).
  for (const name of VAULT_SKELETON) mkdirSync(resolve(vault, name), { recursive: true });

  // A fresh vault opens with a welcome study and note, onboarding as
  // content, seeded once and never resurrected (see welcome.ts).
  seedWelcomeDocs(vault);
  return { partWay: false };
}
