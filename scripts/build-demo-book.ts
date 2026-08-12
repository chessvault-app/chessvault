/**
 * Curate a small opening book for the static demo.
 *
 * Not a sample — a WALK. Starting from the initial position, follow the
 * most-played moves outward to a fixed depth, keeping only positions the
 * walk actually reaches. A random subset of an opening book is useless: the
 * value of a book is that every position it holds has a continuation, and
 * rows picked by popularity alone are scattered across openings that never
 * connect to one another.
 *
 * This is what lets the demo run the repertoire trainer and the explorer,
 * both of which ask "what is played here?" and need an answer at every step
 * of a line rather than at most of them.
 *
 *   npx tsx scripts/build-demo-book.ts [--depth 16] [--width 6] [--min 20]
 */
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseUci } from 'chessops/util';
import { DATA_BOOKS, REPO_ROOT } from '../server/paths.ts';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';

const arg = (flag: string, fallback: number): number => {
  const at = process.argv.indexOf(flag);
  return at < 0 ? fallback : Number(process.argv[at + 1]);
};

const DEPTH = arg('--depth', 16);
const WIDTH = arg('--width', 6);
const MIN_GAMES = arg('--min', 20);
const OUT = resolve(REPO_ROOT, 'web/demo-assets/book.sqlite');

const source = readdirSync(DATA_BOOKS).find((n) => n.endsWith('.sqlite'));
if (!source) {
  console.error(`no opening book in ${DATA_BOOKS} — run npm run build:book first`);
  process.exit(1);
}

const from = new Database(resolve(DATA_BOOKS, source), { readonly: true });
rmSync(OUT, { force: true });
mkdirSync(resolve(OUT, '..'), { recursive: true });
const to = new Database(OUT);
to.exec(`
  CREATE TABLE book (
    -- TEXT, not INTEGER: the key is a 64-bit Zobrist hash, and the demo
    -- reads this file through sql.js, whose JS API cannot bind a BigInt.
    -- Stored as its decimal string, which the shim binds the same way.
    pos TEXT NOT NULL, uci TEXT NOT NULL,
    w INTEGER NOT NULL, d INTEGER NOT NULL, b INTEGER NOT NULL,
    PRIMARY KEY (pos, uci)
  ) WITHOUT ROWID;
  CREATE TABLE games (
    id INTEGER PRIMARY KEY, white TEXT NOT NULL, black TEXT NOT NULL,
    white_elo INTEGER NOT NULL, black_elo INTEGER NOT NULL,
    result TEXT NOT NULL, date TEXT, site TEXT
  );
  -- Empty, but it must EXIST: the route joins it to show sample games for
  -- a position, and a missing table is an error rather than no rows. The
  -- demo book carries no games, so the join simply finds none.
  CREATE TABLE top_games (pos TEXT, game_id INT, uci TEXT, elo INT);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const lookup = from.prepare(
  'SELECT uci, w, d, b FROM book WHERE pos = ? ORDER BY w + d + b DESC, uci LIMIT ?',
);
const insert = to.prepare('INSERT OR IGNORE INTO book (pos, uci, w, d, b) VALUES (?, ?, ?, ?, ?)');

const seen = new Set<string>();
let positions = 0;
let rows = 0;

/** Breadth-first so a shallow, wide book is preferred over a deep, thin one. */
let frontier: Chess[] = [Chess.default()];
for (let ply = 0; ply < DEPTH && frontier.length > 0; ply++) {
  const next: Chess[] = [];
  for (const pos of frontier) {
    const key = toDbKey(hashSetup(pos.toSetup()));
    const fingerprint = String(key);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const moves = (lookup.all(key, WIDTH) as { uci: string; w: number; d: number; b: number }[])
      .filter((row) => row.w + row.d + row.b >= MIN_GAMES);
    if (moves.length === 0) continue;

    positions++;
    for (const row of moves) {
      const move = parseUci(row.uci);
      if (!move || !pos.isLegal(move)) continue; // hash collision guard, as the route does
      insert.run(String(key), row.uci, row.w, row.d, row.b);
      rows++;
      const child = pos.clone();
      child.play(move);
      next.push(child);
    }
  }
  frontier = next;
  console.log(`  ply ${ply + 1}: ${positions} positions, ${rows} moves`);
}

to.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
  'source',
  `${source} — first ${DEPTH} plies, top ${WIDTH} moves, ${MIN_GAMES}+ games`,
);
to.exec('VACUUM');
to.close();
from.close();

console.log(
  `demo book: ${positions} positions, ${rows} moves -> ${OUT} (${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`,
);
