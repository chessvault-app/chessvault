/**
 * Index full games (headers + mainline SAN) into a browsable reference
 * database — the elite-games browser in the Games tab reads it.
 *
 *   npm run build:refgames                     all vault/sources/*.pgn
 *   npm run build:refgames -- elite-2025-11.pgn
 *   npm run build:refgames -- a.pgn b.pgn --name otb
 *   npm run build:refgames -- dec.pgn --name elite --append
 *
 * Databases are plural: output is data/refgames/<name>.sqlite via temp +
 * rename, ~200 MB for a Lichess Elite month. Without --name, the file's
 * name when one source is given, and `refgames` otherwise.
 *
 * `--append` grows an existing database in place instead of building a
 * fresh file: games already present (same players, result, date and
 * movetext — an index-seeked existence check per incoming game) are
 * skipped, only the new games are replayed into the position index, and
 * the derived tables are refreshed. The write runs in WAL so the server
 * can keep answering from the same file, exactly as the in-place index
 * pass does.
 *
 * The movetext is stored alongside the position index, so any game the
 * explorer lists can be opened on the board.
 */
import Database from 'better-sqlite3';
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { PgnParser, type Game, type PgnNodeData } from 'chessops/pgn';
import { DATA, VAULT_SOURCES } from '../server/paths.ts';
import { indexPositions } from '../server/refgamesIndex.ts';
import { REFGAMES_INDEXES, REFGAMES_LOOKUPS } from './lib/db-tuning.ts';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const rawArgs = process.argv.slice(2);
const appendMode = rawArgs.includes('--append');
const argsNoAppend = rawArgs.filter((a) => a !== '--append');
const nameAt = argsNoAppend.indexOf('--name');
const namedAs = nameAt >= 0 ? argsNoAppend[nameAt + 1] : undefined;
const args =
  nameAt >= 0 ? [...argsNoAppend.slice(0, nameAt), ...argsNoAppend.slice(nameAt + 2)] : argsNoAppend;

const sources =
  args.length > 0
    ? args.map((arg) => {
        for (const candidate of [
          isAbsolute(arg) ? arg : resolve(process.cwd(), arg),
          resolve(VAULT_SOURCES, arg),
        ]) {
          if (existsSync(candidate)) return candidate;
        }
        console.error(`source not found: ${arg}`);
        process.exit(1);
      })
    : readdirSync(VAULT_SOURCES)
        .filter((f) => f.toLowerCase().endsWith('.pgn'))
        .map((f) => resolve(VAULT_SOURCES, f));

if (sources.length === 0) {
  console.error(`no .pgn files in ${VAULT_SOURCES} — drop PGN collections there first`);
  process.exit(1);
}

const derived = sources.length === 1 ? basename(sources[0]!).replace(/\.pgn$/i, '') : 'refgames';
const name = namedAs ?? (NAME_RE.test(derived) ? derived : 'refgames');
if (!NAME_RE.test(name)) {
  console.error(`invalid database name: ${name}`);
  process.exit(1);
}
const OUT = resolve(DATA, 'refgames', `${name}.sqlite`);
mkdirSync(resolve(DATA, 'refgames'), { recursive: true });

if (appendMode && !existsSync(OUT)) {
  console.error(`--append: no database called ${name} to append to`);
  process.exit(1);
}

// A fresh build writes a temp file as fast as the disk allows and renames
// it into place; an append works ON the live file, in WAL, so a server
// reading it mid-append sees a consistent snapshot (the pattern the
// in-place index pass established).
const tmp = `${OUT}.building`;
if (!appendMode) rmSync(tmp, { force: true });
const db = new Database(appendMode ? OUT : tmp);
db.pragma('journal_mode = ' + (appendMode ? 'WAL' : 'OFF'));
db.pragma('synchronous = ' + (appendMode ? 'NORMAL' : 'OFF'));
if (appendMode) db.pragma('busy_timeout = 30000');

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    white TEXT NOT NULL COLLATE NOCASE,
    black TEXT NOT NULL COLLATE NOCASE,
    white_elo INTEGER NOT NULL,
    black_elo INTEGER NOT NULL,
    result TEXT NOT NULL,
    date TEXT,
    event TEXT,
    eco TEXT,
    opening TEXT,
    moves TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
// Appends dedup against what is already there, seeking through the
// player index — make sure it exists before the first probe.
if (appendMode) db.exec(REFGAMES_INDEXES);

const insert = db.prepare(
  'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
/** The same game, byte for byte: players, result, date and movetext.
    `date IS ?` rather than `=` so two missing dates also match. */
const exists = appendMode
  ? db.prepare(
      'SELECT 1 FROM games WHERE white = ? AND black = ? AND result = ? AND date IS ? AND moves = ? LIMIT 1',
    )
  : null;

let games = 0;
let skipped = 0;
let duplicates = 0;
const started = Date.now();

const handleGame = (game: Game<PgnNodeData>, err: Error | undefined): void => {
  if (err) {
    skipped += 1;
    return;
  }
  const headers = game.headers;
  const variant = (headers.get('Variant') ?? 'standard').toLowerCase();
  const result = headers.get('Result') ?? '*';
  if (
    !['standard', 'chess', 'classical', 'normal'].includes(variant) ||
    headers.has('FEN') ||
    !['1-0', '0-1', '1/2-1/2'].includes(result)
  ) {
    skipped += 1;
    return;
  }

  const sans: string[] = [];
  for (const data of game.moves.mainline()) sans.push(data.san);
  if (sans.length < 2) {
    skipped += 1;
    return;
  }

  const white = headers.get('White') ?? '?';
  const black = headers.get('Black') ?? '?';
  const date = headers.get('UTCDate') ?? headers.get('Date') ?? null;
  const moves = sans.join(' ');
  if (exists && exists.get(white, black, result, date, moves)) {
    duplicates += 1;
    return;
  }
  insert.run(
    white,
    black,
    Number(headers.get('WhiteElo')) || 0,
    Number(headers.get('BlackElo')) || 0,
    result,
    date,
    headers.get('Event') ?? null,
    headers.get('ECO') ?? null,
    headers.get('Opening') ?? null,
    moves,
  );
  games += 1;
  if (games % 50_000 === 0) {
    db.exec('COMMIT; BEGIN');
    console.log(`  ${games.toLocaleString()} games…`);
  }
};

db.exec('BEGIN');
const parser = new PgnParser(handleGame, () => new Map());
for (const source of sources) {
  console.log(`indexing ${basename(source)}…`);
  const stream = createReadStream(source, { encoding: 'utf-8' });
  for await (const chunk of stream) parser.parse(chunk as string, { stream: true });
}
parser.parse(''); // finish the stream
db.exec('COMMIT');

console.log('indexing…');
db.exec(REFGAMES_INDEXES);
// The lookup tables summarise the whole games table, so an append
// re-derives them (0.8 s measured on an Elite month) rather than merging.
if (appendMode) db.exec('DROP TABLE IF EXISTS players; DROP TABLE IF EXISTS openings;');
db.exec(REFGAMES_LOOKUPS);

const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
const readMeta = (key: string): string | undefined =>
  (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)
    ?.value;
// The tally and the source list are maintained, not written once: an
// append adds to both (sources deduped by name, so re-feeding a file
// does not list it twice).
const prevGames = appendMode ? Number(readMeta('games')) || 0 : 0;
const prevSources = appendMode ? (readMeta('sources') ?? '').split(', ').filter(Boolean) : [];
setMeta.run('games', String(prevGames + games));
setMeta.run(
  'sources',
  [...new Set([...prevSources, ...sources.map((s) => basename(s))])].join(', '),
);
setMeta.run('built_at', new Date().toISOString());

db.close();

// The position index, in the same pass: one row per (position, move,
// game) for the opening plies, which is what lets the explorer answer —
// and answer FILTERED — from this database. Built into the .building file
// before the rename, so a database is never live without its index; an
// append extends the live file's index from its high-water id instead.
console.log('position index…');
indexPositions(appendMode ? OUT : tmp, { log: console.log, append: appendMode });
if (!appendMode) {
  try {
    renameSync(tmp, OUT);
  } catch (error) {
    // Windows: a server holding the old database open blocks the rename
    // (EPERM). Leave the .building file — the server that spawned this build
    // closes its handle and finishes the swap itself, as with books.
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    console.log('rename deferred (target busy) — server will swap the file in');
  }
}
console.log(
  `done: ${games.toLocaleString()} games${appendMode ? ` added (${duplicates.toLocaleString()} already present)` : ''}, ${skipped.toLocaleString()} skipped, ${((Date.now() - started) / 1000).toFixed(1)}s → ${OUT}`,
);
