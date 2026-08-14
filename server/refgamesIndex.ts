import Database from 'better-sqlite3';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';

/**
 * The position index inside a reference-games database.
 *
 * A reference database stored whole games and an opening book stored
 * positions with the games summed away — opposite projections of the same
 * PGN, kept as two artifacts holding the same corpus twice. This is the
 * unification (lanph3re's call): one `plies` table per database, one row
 * per (position, move, game) exactly as data/mygames.sqlite keeps yours,
 * so the explorer can answer from a reference database — and, because the
 * game dimension survives, answer FILTERED questions no book can ("2700+
 * only", "since 2025", "decisive games"), while the elite browser keeps
 * reading the games table beside it.
 *
 * Derived purely from the `moves` column already in the file, so it can be
 * added to any existing database in place — no re-upload, no rebuild.
 * Fresh builds run this pass before the file is renamed into place.
 */

/**
 * Plies indexed per game.
 *
 * Between a book's 24 and my-games' 60, leaning shallow: a reference
 * corpus answers "what is played here", which fades past theory, and
 * every ply is ~10 MB across an Elite month. 30 plies is move 15 —
 * about where theory hands over — at roughly half the games table's own
 * size. My games goes deeper because "have I been here" stays worth
 * asking at move 25; "has anyone" does not.
 */
export const REF_MAX_PLY = 30;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS plies (
    pos INTEGER NOT NULL,
    uci TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    ply INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_plies_pos ON plies (pos);
`;

/** Whether a database already carries the index (and how many rows). */
export function positionIndexInfo(db: InstanceType<typeof Database>): { indexed: boolean; plies: number } {
  const has = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plies'")
    .get();
  if (!has) return { indexed: false, plies: 0 };
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'plies'").get() as
    | { value: string }
    | undefined;
  return {
    indexed: true,
    plies: Number(meta?.value) || (db.prepare('SELECT COUNT(*) AS n FROM plies').get() as { n: number }).n,
  };
}

/**
 * Build (or rebuild) the position index of one database, in place.
 *
 * Runs in whatever process calls it and is CPU-bound — the server always
 * spawns it as a child (scripts/index-refgames-positions.ts), never on a
 * request. Games are replayed with the same chessops + zobrist pipeline
 * the my-games index and the books use, so index-time and query-time keys
 * agree by construction; a game whose SAN stops replaying keeps the plies
 * that did replay, matching indexGame's behaviour.
 */
export function indexPositions(
  dbPath: string,
  { maxPly = REF_MAX_PLY, log = () => {} }: { maxPly?: number; log?: (line: string) => void } = {},
): { games: number; plies: number } {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    // WAL, not journal OFF: the in-place path runs against a database the
    // server may be answering queries from at the same time, and OFF would
    // let a concurrent reader see a half-written file. WAL gives readers a
    // consistent snapshot throughout; busy_timeout rides out their locks.
    // Folded back to a single plain file at the end so the artifact stays
    // one .sqlite with no sidecars.
    db.pragma('busy_timeout = 30000');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec('DROP INDEX IF EXISTS idx_plies_pos; DROP TABLE IF EXISTS plies;');
    db.exec(SCHEMA.replace('CREATE INDEX IF NOT EXISTS idx_plies_pos ON plies (pos);', ''));

    const insert = db.prepare('INSERT INTO plies (pos, uci, game_id, ply) VALUES (?, ?, ?, ?)');
    const total = (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
    let games = 0;
    let plies = 0;

    // Keyset-paged batches, not one .iterate() over games: better-sqlite3
    // refuses writes while a cursor is open on the same connection, and
    // .all()-ing every movetext at once would hold a whole Elite month's
    // moves (~140 MB) in memory for no reason.
    const page = db.prepare('SELECT id, moves FROM games WHERE id > ? ORDER BY id LIMIT 5000');
    let lastId = 0;
    for (;;) {
      const batch = page.all(lastId) as { id: number; moves: string }[];
      if (batch.length === 0) break;
      db.exec('BEGIN');
      for (const row of batch) {
        const pos = Chess.default();
        let ply = 0;
        for (const san of row.moves.split(' ')) {
          if (ply >= maxPly) break;
          const move = parseSan(pos, san);
          if (!move) break;
          insert.run(toDbKey(hashSetup(pos.toSetup())), makeUci(move), row.id, ply);
          pos.play(move);
          ply += 1;
          plies += 1;
        }
        games += 1;
      }
      db.exec('COMMIT');
      lastId = batch.at(-1)!.id;
      if (games % 25_000 === 0 || games === total) {
        log(`  positions: ${games.toLocaleString()} of ${total.toLocaleString()} games…`);
      }
    }

    log('  positions: indexing…');
    db.exec(SCHEMA); // now the index, over the finished table

    const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    setMeta.run('plies', String(plies));
    setMeta.run('index_max_ply', String(maxPly));
    setMeta.run('indexed_at', new Date().toISOString());
    db.pragma('journal_mode = DELETE');
    return { games, plies };
  } finally {
    db.close();
  }
}
