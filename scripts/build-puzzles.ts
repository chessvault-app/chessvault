/**
 * Build the puzzle database from the Lichess puzzle dump.
 *
 *   npm run build:puzzles                     downloads the dump if it is missing
 *   npm run build:puzzles -- path/to/file.csv.zst
 *   npm run build:puzzles -- --progress-json  one JSON event per line (the app)
 *
 * The dump (https://database.lichess.org/lichess_db_puzzle.csv.zst, CC0,
 * ~304 MB, 6.1 M puzzles) is fetched here rather than by the reader: a
 * desktop user has no shell to curl it with, and the server spawns this
 * same file to answer the app's "build the puzzle database" button. What it
 * downloads itself, it deletes afterwards; a dump that was already on disk
 * is left alone, because it is somebody's file and not ours. The two have
 * different names, so that what is ours can be told apart afterwards: see
 * PUZZLE_DUMP_DOWNLOAD.
 *
 * Output lands at data/puzzles.sqlite via a temp file + rename, so a running
 * server keeps serving the old database until the build completes.
 *
 * CSV columns (no quoting — lichess guarantees comma-free fields):
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,
 *   GameUrl,OpeningTags,DailyDate
 *
 * `FEN` is the position BEFORE the setup move; `Moves` is UCI, where the
 * first move is the opponent's setup move and the solver answers from the
 * second move on.
 */
import { createReadStream, createWriteStream, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Decompress } from 'fzstd';
import Database from 'better-sqlite3';
import { DATA, DATA_PUZZLES, PUZZLE_DUMP_DOWNLOAD, PUZZLE_DUMP_PLACED } from '../server/paths.ts';
import { PUZZLE_COUNT_TABLES } from './lib/db-tuning.ts';
import { resolve } from 'node:path';

export const PUZZLE_SCHEMA_VERSION = 1;

const DUMP_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

/** What the app's progress bar is drawn from. One per line on stdout. */
type Event =
  | { phase: 'downloading'; bytes: number; total: number }
  | { phase: 'building'; rows: number }
  | { phase: 'indexing' }
  | { phase: 'done'; puzzles: number; seconds: number };

const args = process.argv.slice(2);
const JSON_PROGRESS = args.includes('--progress-json');
const positional = args.find((a) => !a.startsWith('--'));

/**
 * A failure, as the app is told it: one line on stderr, the error's own.
 *
 * The server shows the last line the child wrote to stderr (buildFailure
 * in server/puzzles.ts), and Node's report of an uncaught error ends on
 * its version banner. So every failure that was thrown rather than
 * printed, a full disk, a dropped download or a dump that stops decoding
 * half way, reached the Puzzles page and Settings as "Node.js v24.19.0",
 * under a Try again. Only for the app's runs: from a terminal the stack
 * is worth more than the line. The cause goes along when there is one,
 * since fetch's own message ("fetch failed") names nothing. Exit waits on
 * the write, which a pipe may not have flushed yet.
 */
if (JSON_PROGRESS) {
  process.on('uncaughtException', (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
    process.stderr.write(`${message}${cause}\n`, () => process.exit(1));
  });
}

const report = (event: Event): void => {
  if (JSON_PROGRESS) {
    console.log(JSON.stringify(event));
    return;
  }
  if (event.phase === 'downloading') {
    const mb = (n: number): string => (n / 1e6).toFixed(0);
    console.log(`  downloaded ${mb(event.bytes)} / ${event.total ? mb(event.total) : '?'} MB`);
  } else if (event.phase === 'building') {
    console.log(`  ${event.rows.toLocaleString()} puzzles…`);
  } else if (event.phase === 'indexing') {
    console.log('indexing…');
  } else {
    console.log(`done: ${event.puzzles.toLocaleString()} puzzles in ${event.seconds.toFixed(1)}s`);
  }
};

/** A dump somebody put in the data directory, which a build uses and keeps. */
const placed = resolve(DATA, PUZZLE_DUMP_PLACED);
const fetched = !positional && !existsSync(placed);
const source = positional
  ? resolve(process.cwd(), positional)
  : fetched
    ? resolve(DATA, PUZZLE_DUMP_DOWNLOAD)
    : placed;

/**
 * Fetch the dump beside its target and rename it into place, so an
 * interrupted download is never mistaken for a complete one.
 *
 * Progress is emitted at most every 2 MB: a 304 MB download would otherwise
 * produce tens of thousands of lines for a bar that moves in percent.
 */
async function downloadDump(to: string): Promise<void> {
  const response = await fetch(DUMP_URL);
  if (!response.ok || !response.body) {
    throw new Error(`could not download the puzzle dump (HTTP ${response.status})`);
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  const part = `${to}.part`;
  rmSync(part, { force: true });

  let bytes = 0;
  let reported = 0;
  report({ phase: 'downloading', bytes: 0, total });
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    async function* (chunks) {
      for await (const chunk of chunks) {
        bytes += (chunk as Buffer).length;
        if (bytes - reported >= 2e6) {
          reported = bytes;
          report({ phase: 'downloading', bytes, total });
        }
        yield chunk;
      }
    },
    createWriteStream(part),
  );
  report({ phase: 'downloading', bytes, total: total || bytes });
  renameSync(part, to);
}

if (positional && !existsSync(source)) {
  console.error(`source not found: ${source}`);
  process.exit(1);
}
// Always afresh, even over a download an earlier run left: a build is
// asked for to get the newest puzzles, and a leftover could be months old.
if (fetched) await downloadDump(source);

const tmp = `${DATA_PUZZLES}.building`;
rmSync(tmp, { force: true });
const db = new Database(tmp);
/**
 * No rollback journal: the file is a temp file nobody reads until it is
 * renamed in, and a build that dies is started again from nothing.
 *
 * This line used to be the bare pragma, and it did nothing. better-sqlite3
 * opens every connection in SQLite's defensive mode, which refuses
 * `journal_mode = OFF` without an error and answers `delete`, so the
 * build kept a journal the whole way through. Measured on a 5,000,000-row
 * dump, that journal stood at 2.15 GB beside a 2.15 GB `.building` file
 * at the build's peak. Defensive mode is lifted for the one pragma and
 * put back; the mode it sets lasts the connection, VACUUM included.
 */
db.unsafeMode(true);
db.pragma('journal_mode = OFF');
db.unsafeMode(false);
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

let rows = 0;
let skipped = 0;
let themeRows = 0;
let header = true;
const started = Date.now();

const takeLine = (line: string): void => {
  if (header) {
    header = false;
    if (!line.startsWith('PuzzleId,FEN,Moves,Rating')) {
      console.error(`unexpected header: ${line}`);
      process.exit(1);
    }
    return;
  }
  if (!line) return;

  const f = line.split(',');
  if (f.length < 10) {
    skipped++;
    return;
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
    report({ phase: 'building', rows });
  }
};

/**
 * Decompression, in JavaScript.
 *
 * It was `spawn('zstd', …)`, which meant the build could only run where
 * somebody had installed the zstd command — true of a Linux server, false
 * of the Windows and macOS machines this app is installed on.
 *
 * node:zlib gained zstd and looked like the answer; it is not, for THIS
 * file. The Lichess dump is in the seekable zstd format: a skippable frame
 * first, then many frames. Measured against node:zlib, a leading skippable
 * frame decodes to nothing at all (silently — no error, no rows), and
 * concatenated frames yield only the first. fzstd reads the whole thing:
 * 6,100,961 lines in 13.8 s, matching the database the zstd command built.
 *
 * Lines are cut inside the decoder's callback and handed straight to the
 * inserts, so nothing buffers: the source stream is only pulled as fast as
 * sqlite writes.
 */
const decoder = new TextDecoder('utf-8');
let carry = '';
const decompress = new Decompress((chunk) => {
  const parts = (carry + decoder.decode(chunk, { stream: true })).split('\n');
  carry = parts.pop() ?? '';
  for (const part of parts) takeLine(part.endsWith('\r') ? part.slice(0, -1) : part);
});

db.exec('BEGIN');
for await (const chunk of createReadStream(source)) decompress.push(chunk as Uint8Array);
decompress.push(new Uint8Array(0), true);
if (carry) takeLine(carry);
db.exec('COMMIT');

report({ phase: 'indexing' });
db.exec(`
  CREATE INDEX idx_puzzles_rating ON puzzles (rating);
  CREATE INDEX idx_themes ON themes (theme, rating);
`);
// Precomputed: GROUP BY over ~28 M theme rows costs ~1 s, far too slow to
// run per /puzzles/meta request.
db.exec('CREATE TABLE theme_counts AS SELECT theme, COUNT(*) AS count FROM themes GROUP BY theme');
// Per-rating row counts, so serving a puzzle never walks a huge OFFSET —
// see the loadBuckets comment in server/puzzles.ts. Both tables are small
// (a few thousand / a few hundred thousand rows) and mirror the leading
// column of the indexes above.
db.exec(PUZZLE_COUNT_TABLES);

const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
setMeta.run('schema_version', String(PUZZLE_SCHEMA_VERSION));
setMeta.run('puzzles', String(rows));
setMeta.run('built_at', new Date().toISOString());
setMeta.run('source', source);

db.exec('VACUUM');
db.close();
try {
  renameSync(tmp, DATA_PUZZLES);
} catch (error) {
  // Windows: a server holding the old database open blocks the rename
  // (EPERM). Leave the .building file — the server that spawned this build
  // closes its handle and finishes the swap itself.
  if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  if (!JSON_PROGRESS) console.log('  rename deferred (target busy) — server will swap the file in');
}

// Only what this run fetched: a dump the user put there is theirs.
if (fetched) rmSync(source, { force: true });

const seconds = (Date.now() - started) / 1000;
report({ phase: 'done', puzzles: rows, seconds });
if (!JSON_PROGRESS) {
  console.log(
    `  ${themeRows.toLocaleString()} theme rows, ${skipped} skipped, ` +
      `${(statSync(existsSync(DATA_PUZZLES) ? DATA_PUZZLES : tmp).size / 1e9).toFixed(2)} GB`,
  );
  console.log(`  → ${DATA_PUZZLES}`);
}
