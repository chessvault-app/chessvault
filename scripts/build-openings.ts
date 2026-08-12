/**
 * Compile the vendored lichess chess-openings TSVs into data/openings.json.
 *
 * The server does this for itself when the file is missing (see
 * server/openings.ts) — nobody has to run this for the app to name
 * openings. It stays a command for rebuilding deliberately: after the
 * vendored TSVs change, or after the Zobrist schema does.
 */
import { writeOpenings } from '../server/openings.ts';

const { path, count, lines, collisions } = writeOpenings();
console.log(
  `openings: ${lines} lines → ${count} positions` +
    (collisions ? ` (${collisions} duplicate positions ignored)` : '') +
    `\n  → ${path}`,
);
