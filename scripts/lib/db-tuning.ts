/**
 * Derived tables and indexes the API depends on for speed, in one place so
 * the build scripts and `npm run tune:dbs` (scripts/tune-dbs.ts) can never
 * drift apart. Everything here is `IF NOT EXISTS` and derived purely from
 * data already in the file, so applying it to an existing database is safe
 * to repeat and reversible with a DROP.
 */
import type Database from 'better-sqlite3';
import { REFGAMES_MOVE_COUNTS } from '../../server/refgamesIndex.ts';

type Db = InstanceType<typeof Database>;

/**
 * Per-rating row counts. `LIMIT 1 OFFSET n` makes SQLite walk and discard n
 * index entries; over 6.1 M puzzles a mid-table draw spent ~90 ms on that
 * alone. With these, the server resolves a random offset to a rating and
 * then offsets only inside that rating — see loadBuckets in
 * server/puzzles.ts. Both mirror the leading column of an existing index,
 * so the distribution they describe is the one the walk produced.
 */
export const PUZZLE_COUNT_TABLES = `
  CREATE TABLE IF NOT EXISTS rating_counts AS
    SELECT rating, COUNT(*) AS n FROM puzzles GROUP BY rating;
  CREATE TABLE IF NOT EXISTS theme_rating_counts AS
    SELECT theme, rating, COUNT(*) AS n FROM themes GROUP BY theme, rating;
  CREATE INDEX IF NOT EXISTS idx_theme_rating_counts ON theme_rating_counts (theme, rating);
`;

/**
 * The reference-games table shipped with no index at all beyond the rowid.
 * `/api/refgames/find` (white = ? AND black = ?) full-scanned 280 k games,
 * reading every `moves` blob on the way. Leading with the two player
 * columns serves that as a seek; carrying `opening` and `eco` as well makes
 * the search box's four-way LIKE a covering index scan, so it reads ~30 MB
 * of index instead of the whole 146 MB table. `id` is the rowid and is
 * therefore already part of every index.
 */
export const REFGAMES_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_games_players ON games (white, black, opening, eco);
`;

/** True when the table exists (a database may predate part of the schema). */
const has = (db: Db, table: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
  undefined;

/** Apply whichever tuning the file's schema supports. Returns what it did. */
export function tune(db: Db): string[] {
  const applied: string[] = [];
  if (has(db, 'puzzles') && has(db, 'themes')) {
    db.exec(PUZZLE_COUNT_TABLES);
    applied.push('rating_counts', 'theme_rating_counts');
  }
  if (has(db, 'games')) {
    db.exec(REFGAMES_INDEXES);
    applied.push('idx_games_players');
  }
  // The per-move sums the unfiltered explore answers from — derived from
  // the position index, so only a database that carries one can have them.
  // The SQL lives with that index (server/refgamesIndex.ts), which also
  // builds this on a fresh pass and drops it on a rebuild.
  if (has(db, 'games') && has(db, 'plies') && !has(db, 'move_counts')) {
    db.exec(REFGAMES_MOVE_COUNTS);
    applied.push('move_counts');
  }
  return applied;
}
