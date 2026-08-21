import { renameSync, writeFileSync, type WriteFileOptions } from 'node:fs';

/**
 * Replace a file's content with no window where it is truncated.
 *
 * A bare writeFileSync truncates the target before the new bytes land, so
 * a crash or power loss mid-write leaves damaged JSON — and the readers'
 * deliberate corrupt-file fallbacks ([], {}) then make the NEXT write
 * persist the empty state, turning a transient crash into permanent loss.
 * Writing beside the target and renaming over it means the file is only
 * ever one complete version or the other; the studies PUT has always done
 * this, and everything that overwrites vault data should match it.
 */
export function writeAtomic(path: string, data: string, options?: WriteFileOptions): void {
  const tmp = `${path}.tmp`;
  if (options === undefined) writeFileSync(tmp, data);
  else writeFileSync(tmp, data, options);
  renameRetrying(tmp, path);
}

/**
 * renameSync, surviving Windows' transient EPERM.
 *
 * Exported because a book's folder moves the same way when it is renamed
 * (server/puzzlebooks.ts), and a directory is MORE exposed to this than a
 * file: anything holding one page image of a book open holds the folder.
 *
 * On Windows a rename over a file something else briefly holds open —
 * Defender scanning the bytes that were just written, the search indexer
 * — throws EPERM/EACCES/EBUSY even though nothing is actually wrong, and
 * a settings save 500ed on exactly this (caught as a once-in-several-runs
 * test flake). Retried a handful of times with a short synchronous pause;
 * anything still failing after that, or failing with any other code, is a
 * real error and is thrown. POSIX never takes the retry path.
 */
export function renameRetrying(from: string, to: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
      if (!transient || attempt >= 4) throw error;
      // Synchronous on purpose: every caller is synchronous, and the
      // pause is 5–25ms a handful of times in a path that runs rarely.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * (attempt + 1));
    }
  }
}
