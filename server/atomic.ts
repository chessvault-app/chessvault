import { renameSync, writeFileSync } from 'node:fs';

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
export function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
