/**
 * Add (or rebuild) the position index of an existing reference-games
 * database, in place — the pass that makes it an explorer source.
 *
 *   npm run index:refgames -- lichess_elite_2025-11
 *
 * Fresh builds run the same pass themselves (build-refgames.ts); this
 * script exists for the databases built before the index did, spawned by
 * the server from the Databases page exactly like a build.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA } from '../server/paths.ts';
import { indexPositions } from '../server/refgamesIndex.ts';

const name = process.argv[2];
if (!name || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
  console.error('usage: index-refgames-positions.ts <database-name>');
  process.exit(1);
}
const path = resolve(DATA, 'refgames', `${name}.sqlite`);
if (!existsSync(path)) {
  console.error(`no such database: ${path}`);
  process.exit(1);
}

const started = Date.now();
const { games, plies } = indexPositions(path, { log: console.log });
console.log(
  `done: ${plies.toLocaleString()} positions from ${games.toLocaleString()} games, ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
