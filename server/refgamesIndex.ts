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
    ply INTEGER NOT NULL,
    r INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_plies_pos ON plies (pos);
`;

/** The game's result as one small integer carried on every ply row, so
    the per-move sums need no join: 0 white won, 1 drawn, 2 black won. */
export const resultCode = (result: string): number =>
  result === '1-0' ? 0 : result === '0-1' ? 2 : 1;

/**
 * Per-(position, move) result sums, precomputed from the index above.
 *
 * The explorer's UNFILTERED question — what was played here, over the
 * whole corpus — is also the opening map's, asked about every charted
 * position at once. Answering it live aggregates the join per request,
 * and near the root that is a sum over most of the database: measured on
 * the deployed server's own log, the map's first 128-position batch (the
 * shallowest positions, so the biggest row sets) spent 4–5 seconds in
 * these sums on every visit. Reading a handful of precomputed rows takes
 * microseconds, and the corpus a reference database holds never changes
 * between index builds. Filtered questions still aggregate live — that
 * they can is the whole point of keeping the game dimension.
 *
 * Two shapes of the same derivation:
 *
 * - No join. Summing through `games` cost 63.8 s of the Elite month's
 *   80 s index pass — 8.3 M rowid lookups — where summing the result
 *   code the plies rows now carry costs 5.7 s (both measured).
 *
 * - Thin positions are NOT stored. Positions reached by fewer than five
 *   games were 92% of the table's rows (3.76 M of 4.07 M; 101 MB down
 *   to 8 MB, measured on the same month) and are exactly the positions
 *   whose live aggregation is instant (0.06 ms measured) — so the
 *   explorer answers them live, through the same fallback older
 *   databases use for everything.
 *
 * Derived purely from plies, so it belongs to this index: built here
 * after the plies pass, dropped here when plies is rebuilt, and added to
 * older files by scripts/tune-dbs.ts (which falls back to a joined
 * variant when the plies table predates the result column).
 */
export const MOVE_COUNT_MIN_GAMES = 5;
export const REFGAMES_MOVE_COUNTS = `
  CREATE TABLE IF NOT EXISTS move_counts AS
    SELECT pos, uci,
           SUM(r = 0) AS w,
           SUM(r = 1) AS d,
           SUM(r = 2) AS b
    FROM plies
    GROUP BY pos, uci;
  CREATE TEMP TABLE mc_thin AS
    SELECT pos FROM move_counts GROUP BY pos HAVING SUM(w + d + b) < ${MOVE_COUNT_MIN_GAMES};
  DELETE FROM move_counts WHERE pos IN (SELECT pos FROM mc_thin);
  DROP TABLE mc_thin;
  CREATE INDEX IF NOT EXISTS idx_move_counts_pos ON move_counts (pos);
`;

/** The same table for a database whose plies predate the result column —
    scripts/tune-dbs.ts only; fresh index passes always take the fast one. */
export const REFGAMES_MOVE_COUNTS_LEGACY = REFGAMES_MOVE_COUNTS.replace(
  /SELECT pos, uci,[\s\S]*?GROUP BY pos, uci;/,
  `SELECT p.pos AS pos, p.uci AS uci,
           SUM(g.result = '1-0') AS w,
           SUM(g.result = '1/2-1/2') AS d,
           SUM(g.result = '0-1') AS b
    FROM plies p JOIN games g ON g.id = p.game_id
    GROUP BY p.pos, p.uci;`,
);

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
    // move_counts is derived from plies, so it falls with it — a rebuilt
    // index summed against a stale table would answer with the old corpus.
    db.exec(
      'DROP INDEX IF EXISTS idx_plies_pos; DROP TABLE IF EXISTS plies; ' +
        'DROP INDEX IF EXISTS idx_move_counts_pos; DROP TABLE IF EXISTS move_counts;',
    );
    db.exec(SCHEMA.replace('CREATE INDEX IF NOT EXISTS idx_plies_pos ON plies (pos);', ''));

    const insert = db.prepare(
      'INSERT INTO plies (pos, uci, game_id, ply, r) VALUES (?, ?, ?, ?, ?)',
    );
    const total = (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
    let games = 0;
    let plies = 0;

    // Keyset-paged batches, not one .iterate() over games: better-sqlite3
    // refuses writes while a cursor is open on the same connection, and
    // .all()-ing every movetext at once would hold a whole Elite month's
    // moves (~140 MB) in memory for no reason.
    const page = db.prepare(
      'SELECT id, moves, result FROM games WHERE id > ? ORDER BY id LIMIT 5000',
    );
    let lastId = 0;
    for (;;) {
      const batch = page.all(lastId) as { id: number; moves: string; result: string }[];
      if (batch.length === 0) break;
      db.exec('BEGIN');
      for (const row of batch) {
        const pos = Chess.default();
        const r = resultCode(row.result);
        let ply = 0;
        for (const san of row.moves.split(' ')) {
          if (ply >= maxPly) break;
          const move = parseSan(pos, san);
          if (!move) break;
          insert.run(toDbKey(hashSetup(pos.toSetup())), makeUci(move), row.id, ply, r);
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
    log('  positions: summing per move…');
    db.exec(REFGAMES_MOVE_COUNTS);

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
