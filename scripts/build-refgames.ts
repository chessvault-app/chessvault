/**
 * Index full games (headers + mainline SAN) into a browsable reference
 * database — the elite-games browser in the Games tab reads it.
 *
 *   npm run build:refgames                     all vault/sources/*.pgn
 *   npm run build:refgames -- elite-2025-11.pgn
 *   npm run build:refgames -- a.pgn b.pgn --name otb
 *
 * Databases are plural: output is data/refgames/<name>.sqlite via temp +
 * rename, ~200 MB for a Lichess Elite month. Without --name, the file's
 * name when one source is given, and `refgames` otherwise.
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
import { REFGAMES_INDEXES } from './lib/db-tuning.ts';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const rawArgs = process.argv.slice(2);
const nameAt = rawArgs.indexOf('--name');
const namedAs = nameAt >= 0 ? rawArgs[nameAt + 1] : undefined;
const args = nameAt >= 0 ? [...rawArgs.slice(0, nameAt), ...rawArgs.slice(nameAt + 2)] : rawArgs;

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

const tmp = `${OUT}.building`;
rmSync(tmp, { force: true });
const db = new Database(tmp);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');

db.exec(`
  CREATE TABLE games (
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
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const insert = db.prepare(
  'INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, opening, moves) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);

let games = 0;
let skipped = 0;
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

  insert.run(
    headers.get('White') ?? '?',
    headers.get('Black') ?? '?',
    Number(headers.get('WhiteElo')) || 0,
    Number(headers.get('BlackElo')) || 0,
    result,
    headers.get('UTCDate') ?? headers.get('Date') ?? null,
    headers.get('Event') ?? null,
    headers.get('ECO') ?? null,
    headers.get('Opening') ?? null,
    sans.join(' '),
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

const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
setMeta.run('games', String(games));
setMeta.run('sources', sources.map((s) => basename(s)).join(', '));
setMeta.run('built_at', new Date().toISOString());

db.close();

// The position index, in the same pass: one row per (position, move,
// game) for the opening plies, which is what lets the explorer answer —
// and answer FILTERED — from this database. Built into the .building file
// before the rename, so a database is never live without its index.
console.log('position index…');
indexPositions(tmp, { log: console.log });
try {
  renameSync(tmp, OUT);
} catch (error) {
  // Windows: a server holding the old database open blocks the rename
  // (EPERM). Leave the .building file — the server that spawned this build
  // closes its handle and finishes the swap itself, as with books.
  if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  console.log('rename deferred (target busy) — server will swap the file in');
}
console.log(
  `done: ${games.toLocaleString()} games, ${skipped.toLocaleString()} skipped, ${((Date.now() - started) / 1000).toFixed(1)}s → ${OUT}`,
);
