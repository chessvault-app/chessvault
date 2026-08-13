/**
 * Add the derived tables and indexes the API needs for speed to databases
 * that were built before them.
 *
 *   npm run tune:dbs                      data/puzzles.sqlite + every refgames db
 *   npm run tune:dbs -- path/to/db.sqlite
 *
 * Idempotent: everything is `IF NOT EXISTS`, so a second run is a no-op and
 * costs milliseconds. A fresh `build:puzzles` / `build:refgames` already
 * includes all of it — this exists so an existing multi-gigabyte file does
 * not have to be rebuilt to get it. Reversible with DROP TABLE / DROP INDEX.
 *
 * Deploys run it automatically (scripts/deploy.sh) so the server's copies
 * never fall behind the code that expects them.
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_PUZZLES } from '../server/paths.ts';
import { tune } from './lib/db-tuning.ts';
import { refgamesFiles } from './lib/refgamesFiles.ts';

const targets =
  process.argv.length > 2
    ? process.argv.slice(2).map((arg) => resolve(process.cwd(), arg))
    : [DATA_PUZZLES, ...refgamesFiles()];

for (const path of targets) {
  if (!existsSync(path)) {
    console.log(`skip (not built): ${path}`);
    continue;
  }
  const started = Date.now();
  const db = new Database(path);
  const applied = tune(db);
  db.close();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    applied.length === 0
      ? `nothing to tune in ${path}`
      : `${path}: ${applied.join(', ')} (${seconds}s)`,
  );
}
