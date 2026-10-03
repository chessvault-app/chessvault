/**
 * What the puzzle database build says about itself, in the words the
 * builder (scripts/build-puzzles.ts), the server (server/puzzles.ts) and
 * the app (web/src/puzzles/PuzzleDbSetup.tsx) share.
 */

/**
 * Where a build reads the dump from: one already in the database's
 * folder (PUZZLE_DUMP_PLACED in server/paths.ts), or a fresh download
 * from Lichess.
 */
export type PuzzleDumpSource = 'dump' | 'download';
