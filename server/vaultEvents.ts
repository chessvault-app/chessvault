/**
 * Telling the running server that its vault was replaced under it.
 *
 * Every module that remembers something about the vault's files keys it
 * on what a stat says, mostly the mtime: a study's chapter list, a games
 * file's parsed summaries, a puzzle book's ids, the link scan, the search
 * index, the games index. An edit moves the mtime and the memory follows.
 * A restore from a copy (server/restore.ts) is not an edit: it puts back
 * files carrying the copy's own times, at the paths the old files had, and
 * a time in a copy is whole seconds. A file whose old mtime happened to be
 * that same second would be answered from memory with what it held before,
 * for as long as the server ran. Unlikely is not the bar for a restore,
 * so each of those modules registers here what to forget, and the restore
 * calls them all the moment the swap is done.
 *
 * No node imports: the static demo runs the same route modules in a page,
 * and they register here there too. Nothing in the demo restores, so the
 * list is simply never called.
 */

const listeners = new Set<() => void>();

/** Run `forget` whenever the vault's files are replaced wholesale. */
export function onVaultReplaced(forget: () => void): void {
  listeners.add(forget);
}

/** The vault's files were just replaced: everything remembered about them goes. */
export function vaultReplaced(): void {
  for (const forget of listeners) {
    try {
      forget();
    } catch (error) {
      // One module failing to forget must not stop the rest; the mtime
      // keys still catch all but the same-second case.
      console.error('[vault] could not drop a cache after a restore:', (error as Error).message);
    }
  }
}
