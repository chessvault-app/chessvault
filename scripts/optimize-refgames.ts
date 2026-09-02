/**
 * Housekeeping for one reference database, in place:
 *
 *   npm run build:refgames -- --help   (this script runs via the app)
 *   npx tsx scripts/optimize-refgames.ts <name>
 *
 * - Exact duplicates go — same players, result, date and movetext, the
 *   key the append path deduplicates by, applied here to files built
 *   before it existed or from overlapping sources. Real DELETEs: SQLite
 *   needs no flag-and-compact model, and VACUUM returns the space.
 * - The derived tables (players, openings, events, position index, move sums)
 *   are re-derived whenever the sweep removed anything, so nothing keeps
 *   counting games that are gone.
 *
 * WAL while it works, like every in-place pass, so a server reading the
 * file keeps answering from a consistent snapshot.
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA } from '../server/paths.ts';
import { indexPositions } from '../server/refgamesIndex.ts';
import { REFGAMES_LOOKUPS } from './lib/db-tuning.ts';

const name = process.argv[2];
if (!name || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
  console.error('usage: optimize-refgames.ts <database-name>');
  process.exit(1);
}
const file = resolve(DATA, 'refgames', `${name}.sqlite`);
if (!existsSync(file)) {
  console.error(`no such database: ${name}`);
  process.exit(1);
}

const started = Date.now();
const db = new Database(file);
db.pragma('busy_timeout = 30000');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

console.log('sweeping duplicates…');
// Keep the lowest id of each identical game. ROW_NUMBER over the full
// text sorts once; the sweep is a maintenance action, not a request.
const swept = db
  .prepare(
    `DELETE FROM games WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY white, black, result, date, moves ORDER BY id
         ) AS rn FROM games
       ) WHERE rn > 1
     )`,
  )
  .run().changes;
console.log(`  ${swept.toLocaleString()} duplicate games removed`);

if (swept > 0) {
  // Every derived table summarised games that are gone.
  db.exec('DROP TABLE IF EXISTS players; DROP TABLE IF EXISTS openings; DROP TABLE IF EXISTS events;');
  db.exec(REFGAMES_LOOKUPS);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'games',
    String((db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n),
  );
}
const hadIndex =
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plies'").get() !==
  undefined;
// An interrupted append leaves games above the index's high-water id;
// this pass is also how that heals — incrementally when nothing was
// swept, whole when the sweep changed what the index should hold.
const through = Number(
  (db.prepare("SELECT value FROM meta WHERE key = 'indexed_through'").get() as
    | { value: string }
    | undefined)?.value,
);
const maxId = Number((db.prepare('SELECT MAX(id) AS n FROM games').get() as { n: number }).n) || 0;
const stale = through > 0 && maxId > through;
db.close();

if (hadIndex && (swept > 0 || stale)) {
  console.log('position index…');
  indexPositions(file, { log: console.log, append: swept === 0 });
}

console.log('vacuum…');
const compact = new Database(file);
// Fold back to a single plain file, like every in-place pass: without
// this, a sweep that removed nothing left the database in WAL — the
// index pass folds back itself, but it only runs when something
// changed, and the artifact convention is one .sqlite with no sidecars.
compact.pragma('journal_mode = DELETE');
compact.exec('VACUUM');
compact.close();
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
