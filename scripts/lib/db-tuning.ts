/**
 * Derived tables and indexes the API depends on for speed, in one place so
 * the build scripts and `npm run tune:dbs` (scripts/tune-dbs.ts) can never
 * drift apart. Everything here is `IF NOT EXISTS` and derived purely from
 * data already in the file, so applying it to an existing database is safe
 * to repeat and reversible with a DROP.
 */
import type Database from 'better-sqlite3';
import { REFGAMES_MOVE_COUNTS, REFGAMES_MOVE_COUNTS_LEGACY } from '../../server/refgamesIndex.ts';

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
 *
 * The three single-column indexes are the union-seek's arms (the search
 * route): a rare query resolves its names against the lookup tables and
 * then SEEKS the games that carry them — white through the composite's
 * leading column, the rest through these — instead of walking ten
 * million rows to find nothing.
 */
export const REFGAMES_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_games_players ON games (white, black, opening, eco);
  CREATE INDEX IF NOT EXISTS idx_games_black ON games (black);
  CREATE INDEX IF NOT EXISTS idx_games_opening ON games (opening);
  CREATE INDEX IF NOT EXISTS idx_games_eco ON games (eco);
`;

/**
 * Small lookup tables the search seeks through instead of scanning.
 *
 * The search box's `white LIKE '%q%' OR black LIKE '%q%' OR …` cannot use
 * an index for seeking — a leading wildcard never can — so every
 * keystroke was a covering scan of the whole index, which grows with the
 * database (~30 MB at 280 k games). Distinct players and openings number
 * in the tens of thousands whatever the game count, so the LIKE runs over
 * these instead, and the games table is probed with hash-set IN
 * (semantically identical: `white IN (names LIKE ?)` ≡ `white LIKE ?`).
 * Derived purely from `games`, so an existing database upgrades in place.
 */
export const REFGAMES_LOOKUPS = `
  CREATE TABLE IF NOT EXISTS players AS
    SELECT name, COUNT(*) AS games, SUM(w) AS as_white, SUM(b) AS as_black, MAX(elo) AS max_elo
    FROM (
      SELECT white AS name, 1 AS w, 0 AS b, white_elo AS elo FROM games
      UNION ALL
      SELECT black AS name, 0 AS w, 1 AS b, black_elo AS elo FROM games
    )
    GROUP BY name;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name ON players (name);
  CREATE TABLE IF NOT EXISTS openings AS
    SELECT opening, eco, COUNT(*) AS games FROM games
    WHERE opening IS NOT NULL OR eco IS NOT NULL
    GROUP BY opening, eco;
  CREATE TABLE IF NOT EXISTS events AS
    SELECT event, COUNT(*) AS games FROM games
    WHERE event IS NOT NULL
    GROUP BY event;
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
    // IF NOT EXISTS throughout, so a file that has players but predates
    // the events table (added later) derives just what it lacks.
    if (!has(db, 'players') || !has(db, 'events')) {
      db.exec(REFGAMES_LOOKUPS);
      applied.push('players', 'openings', 'events');
    }
  }
  // The per-move sums the unfiltered explore answers from — derived from
  // the position index, so only a database that carries one can have them.
  // The SQL lives with that index (server/refgamesIndex.ts), which also
  // builds this on a fresh pass and drops it on a rebuild. A plies table
  // from before the result column gets the joined variant.
  if (has(db, 'games') && has(db, 'plies') && !has(db, 'move_counts')) {
    const hasResult =
      db.prepare("SELECT 1 FROM pragma_table_info('plies') WHERE name = 'r'").get() !== undefined;
    db.exec(hasResult ? REFGAMES_MOVE_COUNTS : REFGAMES_MOVE_COUNTS_LEGACY);
    applied.push('move_counts');
  }
  return applied;
}
