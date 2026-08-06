/**
 * Compile the vendored lichess chess-openings TSVs into data/openings.json,
 * keyed by the shared Zobrist hash so the server can name any position with
 * one map lookup. Fully offline — the TSVs live in scripts/vendor/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { DATA_OPENINGS } from '../server/paths.ts';
import { BOOK_SCHEMA_VERSION, hashSetup } from '../shared/zobrist.ts';

const VENDOR = resolve(dirname(fileURLToPath(import.meta.url)), 'vendor/chess-openings');

const byKey: Record<string, [string, string]> = {};
let lines = 0;
let collisions = 0;

for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const tsv = readFileSync(resolve(VENDOR, `${file}.tsv`), 'utf-8');
  for (const line of tsv.split('\n')) {
    const [eco, name, pgn] = line.split('\t');
    if (!eco || !name || !pgn || eco === 'eco') continue; // header/blank

    const pos = Chess.default();
    for (const token of pgn.split(/\s+/)) {
      if (!token || /^\d+\.+$/.test(token)) continue; // move numbers
      const move = parseSan(pos, token);
      if (!move) throw new Error(`bad SAN "${token}" in ${eco} ${name}`);
      pos.play(move);
    }

    const key = hashSetup(pos.toSetup()).toString(16);
    if (byKey[key]) collisions += 1;
    else byKey[key] = [eco, name];
    lines += 1;
  }
}

mkdirSync(dirname(DATA_OPENINGS), { recursive: true });
writeFileSync(
  DATA_OPENINGS,
  JSON.stringify({ schemaVersion: BOOK_SCHEMA_VERSION, count: Object.keys(byKey).length, byKey }),
);
console.log(
  `openings: ${lines} lines → ${Object.keys(byKey).length} positions` +
  (collisions ? ` (${collisions} duplicate positions ignored)` : '') +
  `\n  → ${DATA_OPENINGS}`,
);
