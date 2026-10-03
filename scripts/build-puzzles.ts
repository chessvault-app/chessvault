/**
 * Build the puzzle database from the Lichess puzzle dump.
 *
 *   npm run build:puzzles                     downloads the dump if it is missing
 *   npm run build:puzzles -- path/to/file.csv.zst
 *   npm run build:puzzles -- --download       downloads the newest dump even
 *                                             with one in place, and deletes
 *                                             that one once the database is built
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
 * Unless the build is asked for the newest set instead (`--download`, the
 * app's Rebuild question when a dump is in place). A dump in place was
 * otherwise built from on every build, so one an older version left
 * behind, or one somebody put there a year ago, held every rebuild to
 * that set, and only deleting the file on the server's disk got newer
 * puzzles. Asked to download, the build leaves the dump in place alone
 * while it works and deletes it once the new database is built, because
 * a dump older than the database is no use to anyone and the question
 * that asked says so. A build that fails keeps it.
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
import { machineReasonOf, type PuzzleBuildFailureReason } from '../shared/puzzleBuild.ts';
import { PUZZLE_COUNT_TABLES } from './lib/db-tuning.ts';
import { resolve } from 'node:path';

export const PUZZLE_SCHEMA_VERSION = 1;

/**
 * Where the dump comes from. `CHESS_TEST_PUZZLE_DUMP_URL` is for tests
 * only and is not a setting: it points the download at a local server,
 * so that a test of the download can run without fetching 300 MB from
 * Lichess (server/puzzles.test.ts).
 */
const DUMP_URL =
  process.env.CHESS_TEST_PUZZLE_DUMP_URL || 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

/**
 * What the app's progress bar is drawn from. One per line on stdout. The
 * last, when there is one, is a `failed`: why, for the app to say in a
 * sentence of its own (see the handler below).
 */
type Event =
  | { phase: 'downloading'; bytes: number; total: number }
  | { phase: 'building'; rows: number }
  | { phase: 'indexing' }
  | { phase: 'done'; puzzles: number; seconds: number }
  | { phase: 'failed'; reason: PuzzleBuildFailureReason; detail: string };

const args = process.argv.slice(2);
const JSON_PROGRESS = args.includes('--progress-json');
/** The newest set, whether or not a dump is in place (see the top). */
const DOWNLOAD = args.includes('--download');
const positional = args.find((a) => !a.startsWith('--'));

/** A failure whose step knows what it was: see PuzzleBuildFailureReason. */
class BuildError extends Error {
  constructor(
    readonly reason: PuzzleBuildFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** An error's own words, with its cause's: fetch's message alone
    ("fetch failed") names nothing. */
const describe = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${message}${cause}`;
};

/**
 * A failure, as the app is told it: why, as a `failed` event on stdout,
 * and the error's own line on stderr for the server's log.
 *
 * It was the stderr line alone, which the server showed as it was: "invalid
 * zstd data", "database or disk is full", "terminated", in English on a
 * Korean card, and before that the version banner Node's report of an
 * uncaught error ends on. The reason is the step's (BuildError, thrown
 * where the step knows: the download, the reading of the dump) or the
 * machine's (a full disk, memory), and the app turns it into a sentence.
 * Only for the app's runs: from a terminal the stack is worth more. Exit
 * waits on both writes, which a pipe may not have flushed yet.
 */
if (JSON_PROGRESS) {
  process.on('uncaughtException', (error: unknown) => {
    const reason = error instanceof BuildError ? error.reason : (machineReasonOf(error) ?? 'other');
    // A BuildError's message already carries its cause's.
    const detail = error instanceof BuildError ? error.message : describe(error);
    process.stdout.write(`${JSON.stringify({ phase: 'failed', reason, detail } satisfies Event)}\n`, () =>
      process.stderr.write(`${detail}\n`, () => process.exit(1)),
    );
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
    console.log(event.rows === 0 ? 'building…' : `  ${event.rows.toLocaleString()} puzzles…`);
  } else if (event.phase === 'indexing') {
    console.log('indexing…');
  } else if (event.phase === 'done') {
    console.log(`done: ${event.puzzles.toLocaleString()} puzzles in ${event.seconds.toFixed(1)}s`);
  }
};

/** A dump somebody put in the data directory, which a build uses and
    keeps unless it was asked to download the newest set instead. */
const placed = resolve(DATA, PUZZLE_DUMP_PLACED);
/** The dump in place this build was asked to download past, deleted
    once the database is built. Only one that was there from the start:
    a file put there while the build ran is not the one the question named. */
const passedOver = !positional && DOWNLOAD && existsSync(placed);
const fetched = !positional && (DOWNLOAD || !existsSync(placed));
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
  // Two ways for it to fail, which the app tells apart: it never started
  // (no connection, or Lichess said no), or it started and was cut off.
  let response: Response;
  try {
    response = await fetch(DUMP_URL);
  } catch (error) {
    throw new BuildError('unreachable', describe(error), { cause: error });
  }
  if (!response.ok || !response.body) {
    throw new BuildError('unreachable', `HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  const part = `${to}.part`;
  rmSync(part, { force: true });

  let bytes = 0;
  let reported = 0;
  report({ phase: 'downloading', bytes: 0, total });
  try {
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
  } catch (error) {
    // A full disk fills under the .part file as readily as anywhere.
    throw new BuildError(machineReasonOf(error) ?? 'download', describe(error), { cause: error });
  }
  // A body that ended short of what the server said it would send is a
  // cut-off download too, whether or not the connection said so.
  if (total && bytes !== total) {
    throw new BuildError('download', `the download ended at ${bytes} of ${total} bytes`);
  }
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

/**
 * How many rows go by between two counts.
 *
 * The app's bar used to hear of the build only every 200,000 rows, at
 * each COMMIT. Until the first of those it went on saying what the
 * server or the download had said last: "Downloading the puzzle dump",
 * 0 MB of nothing when a dump was in place, and a full bar after a real
 * download. The first 200,000 rows took 1.9 s on a fast desktop and take
 * longer on a small server, and a dump that holds fewer never said
 * "building" at all. So the start is reported as zero rows (below), and the app is
 * told a count every 10,000: 610 short lines over the 6.1 M-row set, for
 * a bar the app reads once a second. A terminal keeps the old cadence,
 * where every count is a line someone has to scroll past.
 */
const REPORT_EVERY = JSON_PROGRESS ? 10_000 : 200_000;

const takeLine = (line: string): void => {
  if (header) {
    header = false;
    if (!line.startsWith('PuzzleId,FEN,Moves,Rating')) {
      // A file that decodes and is not the dump is, to whoever put it
      // there, a dump that cannot be read: the same answer either way.
      throw new BuildError('decode', `not a Lichess puzzle dump (unexpected header: ${line.slice(0, 80)})`);
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
  if (rows % 200_000 === 0) db.exec('COMMIT; BEGIN');
  if (rows % REPORT_EVERY === 0) report({ phase: 'building', rows });
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

// Whatever came before (a download, or nothing) is over: say so now,
// not at the first count.
report({ phase: 'building', rows: 0 });
db.exec('BEGIN');
/**
 * Reading the dump, where a failure is the dump's own unless it says
 * otherwise. fzstd's errors carry a numeric code ("invalid zstd data",
 * "unexpected EOF" for a file cut short); a code that is a string belongs
 * to the system or SQLite, a full disk or memory being the two worth
 * naming and anything else (a duplicate id, a permission) left as it is.
 */
try {
  for await (const chunk of createReadStream(source)) decompress.push(chunk as Uint8Array);
  decompress.push(new Uint8Array(0), true);
  if (carry) takeLine(carry);
} catch (error) {
  if (error instanceof BuildError) throw error;
  const code = (error as { code?: unknown } | null)?.code;
  throw new BuildError(machineReasonOf(error) ?? (typeof code === 'number' ? 'decode' : 'other'), describe(error), {
    cause: error,
  });
}
// Not a line at all: an empty file, or one that decodes to nothing.
if (header) throw new BuildError('decode', 'the dump holds no lines');
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

// Only what this run fetched: a dump the user put there is theirs,
if (fetched) rmSync(source, { force: true });
// unless they asked for the newest set instead of it. The database is
// whole by now, even where the server is left to rename it in.
if (passedOver) rmSync(placed, { force: true });

const seconds = (Date.now() - started) / 1000;
report({ phase: 'done', puzzles: rows, seconds });
if (!JSON_PROGRESS) {
  console.log(
    `  ${themeRows.toLocaleString()} theme rows, ${skipped} skipped, ` +
      `${(statSync(existsSync(DATA_PUZZLES) ? DATA_PUZZLES : tmp).size / 1e9).toFixed(2)} GB`,
  );
  console.log(`  → ${DATA_PUZZLES}`);
}
