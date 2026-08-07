import Database from 'better-sqlite3';
import { createReadStream } from 'node:fs';
import { Chess } from 'chessops/chess';
import { PgnParser, type Game, type PgnNodeData } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { BOOK_SCHEMA_VERSION, hashSetup, toDbKey } from '../../shared/zobrist.ts';

export interface BuildOptions {
  /** Book name recorded in meta; the file name is the caller's business. */
  name: string;
  /** PGN files to index, merged into one book. */
  sources: string[];
  /** Output SQLite path. Overwritten if it exists. */
  out: string;
  /** Index positions up to this ply (default 24 = move 12). */
  maxPly?: number;
  /** Drop positions reached by fewer games than this (default 2). */
  minGames?: number;
  /** Reference games kept per position, 0 disables (default 3). */
  topGames?: number;
  /** Flush the in-memory tally to SQLite at this many rows (default 4M). */
  flushRows?: number;
  onProgress?: (p: BuildProgress) => void;
}

export interface BuildProgress {
  games: number;
  skipped: number;
  parseErrors: number;
  seconds: number;
}

export interface BuildResult extends BuildProgress {
  positions: number;
  rows: number;
  bytes: number;
}

const PROGRESS_EVERY = 10_000;

/**
 * Index PGN games into an opening book.
 *
 * Positions are keyed by the shared 64-bit Zobrist hash (see
 * shared/zobrist.ts for the index/query consistency rule). Only mainlines
 * count — variations are analysis, not game results. The whole file is
 * streamed, never buffered: chessops's PgnParser accepts chunked input, so a
 * multi-GB source costs the same memory as a small one. The tally lives in a
 * Map and is flushed to SQLite with UPSERTs whenever it grows past
 * `flushRows`, which bounds memory for arbitrarily large inputs.
 */
export async function buildBook(options: BuildOptions): Promise<BuildResult> {
  const maxPly = options.maxPly ?? 24;
  const minGames = options.minGames ?? 2;
  // 8 (was 3): the explorer now leans on reference games for discovery, so
  // a position keeps a longer bench of its strongest games.
  const topGames = options.topGames ?? 8;
  const flushRows = options.flushRows ?? 4_000_000;

  const db = new Database(options.out);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -262144'); // 256 MB of page cache

  db.exec(`
    DROP TABLE IF EXISTS book;
    DROP TABLE IF EXISTS games;
    DROP TABLE IF EXISTS top_games;
    DROP TABLE IF EXISTS meta;
    CREATE TABLE book (
      pos INTEGER NOT NULL,
      uci TEXT NOT NULL,
      w INTEGER NOT NULL,
      d INTEGER NOT NULL,
      b INTEGER NOT NULL,
      PRIMARY KEY (pos, uci)
    ) WITHOUT ROWID;
    CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      white TEXT NOT NULL,
      black TEXT NOT NULL,
      white_elo INTEGER NOT NULL,
      black_elo INTEGER NOT NULL,
      result TEXT NOT NULL,
      date TEXT,
      site TEXT
    );
    CREATE TABLE top_games (
      pos INTEGER NOT NULL,
      game_id INTEGER NOT NULL,
      uci TEXT NOT NULL,
      elo INTEGER NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const upsert = db.prepare(`
    INSERT INTO book (pos, uci, w, d, b) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (pos, uci) DO UPDATE SET
      w = w + excluded.w, d = d + excluded.d, b = b + excluded.b
  `);
  const insertGame = db.prepare(
    'INSERT INTO games (white, black, white_elo, black_elo, result, date, site) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertTopGame = db.prepare(
    'INSERT INTO top_games (pos, game_id, uci, elo) VALUES (?, ?, ?, ?)',
  );

  // pos hash -> uci -> [white wins, draws, black wins]
  let tally = new Map<bigint, Map<string, [number, number, number]>>();
  // pos hash -> up to `topGames` reference games, sorted by elo descending
  let refs = new Map<bigint, { gameId: number; uci: string; elo: number }[]>();
  let tallyRows = 0;

  const progress: BuildProgress = { games: 0, skipped: 0, parseErrors: 0, seconds: 0 };
  const started = Date.now();

  const flush = (): void => {
    for (const [pos, moves] of tally) {
      const key = toDbKey(pos);
      for (const [uci, [w, d, b]] of moves) upsert.run(key, uci, w, d, b);
    }
    for (const [pos, candidates] of refs) {
      const key = toDbKey(pos);
      for (const c of candidates) insertTopGame.run(key, c.gameId, c.uci, c.elo);
    }
    tally = new Map();
    refs = new Map();
    tallyRows = 0;
    db.exec('COMMIT; BEGIN');
  };

  const handleGame = (game: Game<PgnNodeData>, err: Error | undefined): void => {
    if (err) {
      progress.parseErrors += 1;
      return;
    }

    const headers = game.headers;
    const variant = (headers.get('Variant') ?? 'standard').toLowerCase();
    const result = headers.get('Result');
    const resultIndex = result === '1-0' ? 0 : result === '1/2-1/2' ? 1 : result === '0-1' ? 2 : -1;
    // Books describe standard chess from the standard start. Games from a
    // set-up position or another variant would poison the statistics. (Note
    // chessops's parseVariant maps Chess960 to 'chess', so it can't be used
    // as this filter.)
    const standard = ['standard', 'chess', 'classical', 'normal'].includes(variant);
    if (!standard || headers.has('FEN') || resultIndex === -1) {
      progress.skipped += 1;
      return;
    }

    const whiteElo = Number(headers.get('WhiteElo')) || 0;
    const blackElo = Number(headers.get('BlackElo')) || 0;
    const gameElo = Math.round((whiteElo + blackElo) / 2);
    // The games row is only written if this game becomes a reference
    // somewhere, so the games table never holds unreferenced rows in bulk.
    let gameId: number | null = null;

    const pos = Chess.default();
    let ply = 0;
    for (const data of game.moves.mainline()) {
      if (ply >= maxPly) break;
      const move = parseSan(pos, data.san);
      if (!move) {
        progress.parseErrors += 1;
        break;
      }
      const hash = hashSetup(pos.toSetup());
      const uci = makeUci(move);

      let moves = tally.get(hash);
      if (!moves) tally.set(hash, (moves = new Map()));
      const counts = moves.get(uci);
      if (counts) {
        counts[resultIndex] += 1;
      } else {
        const fresh: [number, number, number] = [0, 0, 0];
        fresh[resultIndex] = 1;
        moves.set(uci, fresh);
        tallyRows += 1;
      }

      if (topGames > 0) {
        const candidates = refs.get(hash);
        if (!candidates || candidates.length < topGames || gameElo > candidates.at(-1)!.elo) {
          gameId ??= Number(
            insertGame.run(
              headers.get('White') ?? '?',
              headers.get('Black') ?? '?',
              whiteElo,
              blackElo,
              result!,
              headers.get('UTCDate') ?? headers.get('Date') ?? null,
              headers.get('Site') ?? null,
            ).lastInsertRowid,
          );
          const entry = { gameId, uci, elo: gameElo };
          if (!candidates) {
            refs.set(hash, [entry]);
          } else {
            const at = candidates.findIndex((c) => c.elo < gameElo);
            candidates.splice(at === -1 ? candidates.length : at, 0, entry);
            if (candidates.length > topGames) candidates.pop();
          }
        }
      }

      pos.play(move);
      ply += 1;
    }

    progress.games += 1;
    if (progress.games % PROGRESS_EVERY === 0) {
      progress.seconds = (Date.now() - started) / 1000;
      options.onProgress?.({ ...progress });
    }
    if (tallyRows >= flushRows) flush();
  };

  db.exec('BEGIN');
  const parser = new PgnParser(handleGame, () => new Map());
  for (const source of options.sources) {
    const stream = createReadStream(source, { encoding: 'utf-8' });
    for await (const chunk of stream) parser.parse(chunk as string, { stream: true });
  }
  parser.parse(''); // finish the stream
  flush();
  db.exec('COMMIT');

  // Prune per POSITION, not per row: a position three games reached with
  // three different moves keeps all three 1-game rows, matching how the
  // Lichess explorer behaves. (This is what the measured 15.2 MB assumed.)
  db.prepare(
    'DELETE FROM book WHERE pos IN (SELECT pos FROM book GROUP BY pos HAVING SUM(w + d + b) < ?)',
  ).run(minGames);

  // Reduce staged reference games to the best N per surviving position.
  db.prepare(`
    CREATE TABLE top_games_final AS
    SELECT pos, game_id, uci, elo FROM (
      SELECT *, row_number() OVER (PARTITION BY pos ORDER BY elo DESC, game_id) AS rn
      FROM (SELECT DISTINCT pos, game_id, uci, elo FROM top_games)
      WHERE pos IN (SELECT DISTINCT pos FROM book)
    ) WHERE rn <= ?
  `).run(topGames);
  db.exec(`
    DROP TABLE top_games;
    ALTER TABLE top_games_final RENAME TO top_games;
    CREATE INDEX top_games_pos ON top_games (pos);
    DELETE FROM games WHERE id NOT IN (SELECT game_id FROM top_games);
  `);

  const counts = db
    .prepare('SELECT COUNT(DISTINCT pos) AS positions, COUNT(*) AS rows FROM book')
    .get() as { positions: number; rows: number };

  const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  setMeta.run('schemaVersion', String(BOOK_SCHEMA_VERSION));
  setMeta.run('name', options.name);
  setMeta.run('sources', JSON.stringify(options.sources));
  setMeta.run('maxPly', String(maxPly));
  setMeta.run('minGames', String(minGames));
  setMeta.run('topGames', String(topGames));
  setMeta.run('games', String(progress.games));
  setMeta.run('positions', String(counts.positions));
  setMeta.run('rows', String(counts.rows));
  setMeta.run('builtAt', new Date().toISOString());

  db.exec('ANALYZE; VACUUM');
  const bytes = (db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count
    * (db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
  db.close();

  progress.seconds = (Date.now() - started) / 1000;
  return { ...progress, ...counts, bytes };
}
