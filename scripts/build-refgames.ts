/**
 * Index full games (headers + mainline SAN) into a browsable reference
 * database — the elite-games browser in the Games tab reads it.
 *
 *   npm run build:refgames                     all vault/sources/*.pgn
 *   npm run build:refgames -- elite-2025-11.pgn
 *
 * Unlike the opening books (positions only), this stores the movetext, so
 * any game can be opened on the board. Output: data/refgames.sqlite via
 * temp + rename, ~200 MB for a Lichess Elite month.
 */
import Database from 'better-sqlite3';
import { createReadStream, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { PgnParser, type Game, type PgnNodeData } from 'chessops/pgn';
import { DATA, VAULT_SOURCES } from '../server/paths.ts';

const OUT = resolve(DATA, 'refgames.sqlite');

const args = process.argv.slice(2);
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

const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
setMeta.run('games', String(games));
setMeta.run('sources', sources.map((s) => basename(s)).join(', '));
setMeta.run('built_at', new Date().toISOString());

db.close();
renameSync(tmp, OUT);
console.log(
  `done: ${games.toLocaleString()} games, ${skipped.toLocaleString()} skipped, ${((Date.now() - started) / 1000).toFixed(1)}s → ${OUT}`,
);
