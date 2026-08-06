/**
 * Build the puzzle database from the Lichess puzzle dump.
 *
 *   npm run build:puzzles                     uses data/lichess_db_puzzle.csv.zst
 *   npm run build:puzzles -- path/to/file.csv.zst
 *
 * The dump (https://database.lichess.org/lichess_db_puzzle.csv.zst, CC0,
 * ~304 MB, 3.08 M puzzles) must be downloaded first. Output lands at
 * data/puzzles.sqlite via a temp file + rename, so a running server keeps
 * serving the old database until the build completes.
 *
 * CSV columns (no quoting — lichess guarantees comma-free fields):
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,
 *   GameUrl,OpeningTags,DailyDate
 *
 * `FEN` is the position BEFORE the setup move; `Moves` is UCI, where the
 * first move is the opponent's setup move and the solver answers from the
 * second move on.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, renameSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { DATA, DATA_PUZZLES } from '../server/paths.ts';
import { resolve } from 'node:path';

export const PUZZLE_SCHEMA_VERSION = 1;

const source = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(DATA, 'lichess_db_puzzle.csv.zst');

if (!existsSync(source)) {
  console.error(
    `source not found: ${source}\n` +
      'download it first:\n' +
      '  curl -L -o data/lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst',
  );
  process.exit(1);
}

const tmp = `${DATA_PUZZLES}.building`;
rmSync(tmp, { force: true });
const db = new Database(tmp);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');
db.pragma('cache_size = -262144');

db.exec(`
  CREATE TABLE puzzles (
    id TEXT PRIMARY KEY,
    fen TEXT NOT NULL,
    moves TEXT NOT NULL,
    rating INTEGER NOT NULL,
    rd INTEGER NOT NULL,
    popularity INTEGER NOT NULL,
    plays INTEGER NOT NULL,
    themes TEXT NOT NULL,
    game_url TEXT,
    opening_tags TEXT
  );
  CREATE TABLE themes (
    theme TEXT NOT NULL,
    rating INTEGER NOT NULL,
    id TEXT NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const insert = db.prepare(
  'INSERT INTO puzzles (id, fen, moves, rating, rd, popularity, plays, themes, game_url, opening_tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const insertTheme = db.prepare('INSERT INTO themes (theme, rating, id) VALUES (?, ?, ?)');

const zstd = spawn('zstd', ['-dc', source], { stdio: ['ignore', 'pipe', 'inherit'] });
const lines = createInterface({ input: zstd.stdout, crlfDelay: Infinity });

let rows = 0;
let skipped = 0;
let themeRows = 0;
let header = true;
const started = Date.now();

db.exec('BEGIN');
for await (const line of lines) {
  if (header) {
    header = false;
    if (!line.startsWith('PuzzleId,FEN,Moves,Rating')) {
      console.error(`unexpected header: ${line}`);
      process.exit(1);
    }
    continue;
  }
  if (!line) continue;

  const f = line.split(',');
  if (f.length < 10) {
    skipped++;
    continue;
  }
  const [id, fen, moves, rating, rd, popularity, plays, themes, gameUrl, openingTags] = f;
  insert.run(
    id,
    fen,
    moves,
    Number(rating),
    Number(rd),
    Number(popularity),
    Number(plays),
    themes,
    gameUrl || null,
    openingTags || null,
  );
  for (const theme of themes!.split(' ')) {
    if (!theme) continue;
    insertTheme.run(theme, Number(rating), id);
    themeRows++;
  }

  rows++;
  if (rows % 200_000 === 0) {
    db.exec('COMMIT; BEGIN');
    console.log(`  ${rows.toLocaleString()} puzzles…`);
  }
}
db.exec('COMMIT');

await new Promise<void>((res, rej) => {
  zstd.on('close', (code) =>
    code === 0 ? res() : rej(new Error(`zstd exited with ${code}`)),
  );
});

console.log('indexing…');
db.exec(`
  CREATE INDEX idx_puzzles_rating ON puzzles (rating);
  CREATE INDEX idx_themes ON themes (theme, rating);
`);

const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
setMeta.run('schema_version', String(PUZZLE_SCHEMA_VERSION));
setMeta.run('puzzles', String(rows));
setMeta.run('built_at', new Date().toISOString());
setMeta.run('source', source);

db.exec('VACUUM');
db.close();
renameSync(tmp, DATA_PUZZLES);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `done: ${rows.toLocaleString()} puzzles, ${themeRows.toLocaleString()} theme rows, ${skipped} skipped, ${seconds}s`,
);
console.log(`  → ${DATA_PUZZLES}`);
