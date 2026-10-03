/**
 * What the puzzle database build says about itself, in the words the
 * builder (scripts/build-puzzles.ts), the server (server/puzzles.ts) and
 * the app (web/src/puzzles/PuzzleDbSetup.tsx) share.
 *
 * The failure half is shared because each of the three names the same
 * things: the builder knows which step failed and why, the server adds
 * what only it can see (a signal, a swap that did not go through), and
 * the app turns the reason into a sentence in the reader's language. The
 * app used to be handed the builder's last line, "invalid zstd data" or a
 * SQLite error, and showed it as it was, English in a Korean card.
 */

/**
 * Where a build reads the dump from: one already in the database's
 * folder (PUZZLE_DUMP_PLACED in server/paths.ts), or a fresh download
 * from Lichess.
 */
export type PuzzleDumpSource = 'dump' | 'download';

/**
 * Why a build failed.
 *
 * - `unreachable`: the download never started (no connection, or Lichess
 *   answered with an error).
 * - `download`: the download started and was cut off.
 * - `decode`: the dump does not decode, or is not a Lichess puzzle dump.
 * - `disk`: the disk filled up.
 * - `memory`: memory ran out, or the system killed the build the way it
 *   kills a process that runs out of it.
 * - `stopped`: some other signal stopped it.
 * - `swap`: the database was built and could not be put in place.
 * - `other`: anything else; the detail is all there is.
 */
export type PuzzleBuildFailureReason =
  | 'unreachable'
  | 'download'
  | 'decode'
  | 'disk'
  | 'memory'
  | 'stopped'
  | 'swap'
  | 'other';

export interface PuzzleBuildFailure {
  reason: PuzzleBuildFailureReason;
  /** The builder's or the system's own words, untranslated: an HTTP
      status, a signal, an error message. Shown only where it helps. */
  detail: string | null;
}

/**
 * A full disk or exhausted memory, by the error's own code, whichever
 * step threw it; null for anything else.
 *
 * Read before the step's own reason, because either can surface from any
 * step: the disk fills under the download's `.part` file (ENOSPC) as
 * readily as under SQLite's inserts or its closing VACUUM (SQLITE_FULL,
 * "database or disk is full"), and SQLite reports its own allocations
 * failing as SQLITE_NOMEM. better-sqlite3 puts the extended code on
 * `code`, so a full disk can also arrive as SQLITE_FULL's family.
 */
export function machineReasonOf(error: unknown): 'disk' | 'memory' | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== 'string') return null;
  if (code === 'ENOSPC' || code === 'EDQUOT' || code.startsWith('SQLITE_FULL')) return 'disk';
  if (code === 'ENOMEM' || code.startsWith('SQLITE_NOMEM')) return 'memory';
  return null;
}
