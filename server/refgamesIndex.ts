import Database from 'better-sqlite3';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';
import { SCAN_PACK_META, SCAN_PACK_VERSION, encodeScanPack } from '../shared/scanPack.ts';

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
    r INTEGER NOT NULL,
    eb INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_plies_pos ON plies (pos);
`;

/** The packed scan-index (shared/scanPack.ts): one blob per game, in
    the same file — no sidecar. Keyed by game id; the future scanner
    walks it in id order. */
const SCAN_PACK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS scan_pack (
    game_id INTEGER PRIMARY KEY,
    pack BLOB NOT NULL
  );
`;

/** The game's result as one small integer carried on every ply row, so
    the per-move sums need no join: 0 white won, 1 drawn, 2 black won. */
export const resultCode = (result: string): number =>
  result === '1-0' ? 0 : result === '0-1' ? 2 : 1;

/**
 * The game's level as a 200-point bucket of its LOWER rating — a 2700
 * flagged against a 2200 is not a 2700-level game, the same floor logic
 * the strength filter uses. Carried on every ply row so the per-move
 * sums can be sliced by band without a join: "what do people at MY
 * level play here" is the statistics an improving player should be
 * reading, and corpus-wide sums from much stronger players answer a
 * different question.
 */
export const eloBucket = (whiteElo: number, blackElo: number): number =>
  Math.max(0, Math.floor(Math.min(whiteElo, blackElo) / 200));

/**
 * How many men each side still has when the game ends, from the SAN
 * alone: every capture is an 'x' and removes exactly one man from the
 * side NOT moving, and ply parity says who moved. No move generation —
 * a string scan — which is what lets deep search's reachability
 * prefilter come from columns that cost the index pass nothing. Men
 * only leave the board, so a game whose final counts exceed a target
 * position's cannot contain it.
 */
export const finalMen = (moves: string): { w: number; b: number } => {
  let w = 16;
  let b = 16;
  let ply = 0;
  for (const san of moves.split(' ')) {
    if (san.includes('x')) {
      if (ply % 2 === 0) b -= 1;
      else w -= 1;
    }
    ply += 1;
  }
  return { w, b };
};

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
    SELECT pos, uci, eb,
           SUM(r = 0) AS w,
           SUM(r = 1) AS d,
           SUM(r = 2) AS b
    FROM plies
    GROUP BY pos, uci, eb;
  CREATE TEMP TABLE mc_thin AS
    SELECT pos FROM move_counts GROUP BY pos HAVING SUM(w + d + b) < ${MOVE_COUNT_MIN_GAMES};
  DELETE FROM move_counts WHERE pos IN (SELECT pos FROM mc_thin);
  DROP TABLE mc_thin;
  CREATE INDEX IF NOT EXISTS idx_move_counts_pos ON move_counts (pos);
`;

/** The same table for a database whose plies predate the result and
    bucket columns — scripts/tune-dbs.ts only; fresh index passes always
    take the fast one. Unbucketed: the explorer sums it corpus-wide and
    answers band questions live. */
export const REFGAMES_MOVE_COUNTS_LEGACY = REFGAMES_MOVE_COUNTS.replace(
  /SELECT pos, uci, eb,[\s\S]*?GROUP BY pos, uci, eb;/,
  `SELECT p.pos AS pos, p.uci AS uci,
           SUM(g.result = '1-0') AS w,
           SUM(g.result = '1/2-1/2') AS d,
           SUM(g.result = '0-1') AS b
    FROM plies p JOIN games g ON g.id = p.game_id
    GROUP BY p.pos, p.uci;`,
);

/** Whether a database already carries the index (and how many rows).
    `stale` — games exist above the index's high-water id, so an append
    died between its insert and its index pass; re-running the index (or
    the next append) heals it. Old files without the mark are not stale:
    the mark arrived with appendability, and their builds were atomic. */
export function positionIndexInfo(db: InstanceType<typeof Database>): {
  indexed: boolean;
  plies: number;
  stale: boolean;
} {
  const has = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plies'")
    .get();
  if (!has) return { indexed: false, plies: 0, stale: false };
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'plies'").get() as
    | { value: string }
    | undefined;
  const through = Number(
    (db.prepare("SELECT value FROM meta WHERE key = 'indexed_through'").get() as
      | { value: string }
      | undefined)?.value,
  );
  const maxId = through
    ? Number((db.prepare('SELECT MAX(id) AS n FROM games').get() as { n: number }).n) || 0
    : 0;
  return {
    indexed: true,
    plies: Number(meta?.value) || (db.prepare('SELECT COUNT(*) AS n FROM plies').get() as { n: number }).n,
    stale: through > 0 && maxId > through,
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
  {
    maxPly = REF_MAX_PLY,
    log = () => {},
    append = false,
  }: { maxPly?: number; log?: (line: string) => void; append?: boolean } = {},
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
    const readMeta = (key: string): string | undefined =>
      (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)
        ?.value;
    // Appending replays only the games above the index's high-water id,
    // at the DEPTH THE FILE WAS INDEXED AT — a corpus indexed to two
    // depths would answer differently above and below the seam, with
    // nothing to say so. The plies table itself must predate the result
    // column's arrival to be un-appendable; that shape forces a full pass.
    let sinceId = 0;
    if (append) {
      const hasR =
        db.prepare("SELECT 1 FROM pragma_table_info('plies') WHERE name = 'eb'").get() !==
        undefined;
      if (hasR) {
        maxPly = Number(readMeta('index_max_ply')) || maxPly;
        sinceId =
          Number(readMeta('indexed_through')) ||
          Number((db.prepare('SELECT MAX(game_id) AS n FROM plies').get() as { n: number }).n) ||
          0;
      } else {
        append = false; // old shape: rebuild whole, gaining the r column
      }
    }
    // Whether THIS pass emits scan packs. A full pass always does — it
    // replays every game, so the table it writes is complete. An append
    // only extends packs that exist at the current version: extending a
    // packless (or older-versioned) file would leave holes with a meta
    // key claiming otherwise, and a partially packed file is the one
    // shape the spec forbids. The skipped file simply stays packless
    // until its next full index pass.
    const packing =
      !append ||
      (readMeta(SCAN_PACK_META) === String(SCAN_PACK_VERSION) &&
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scan_pack'").get() !==
          undefined);
    if (!append) {
      // move_counts is derived from plies, so it falls with it — a rebuilt
      // index summed against a stale table would answer with the old
      // corpus.
      db.exec(
        'DROP INDEX IF EXISTS idx_plies_pos; DROP TABLE IF EXISTS plies; ' +
          'DROP INDEX IF EXISTS idx_move_counts_pos; DROP TABLE IF EXISTS move_counts; ' +
          'DROP TABLE IF EXISTS scan_pack;',
      );
      db.exec(SCHEMA.replace('CREATE INDEX IF NOT EXISTS idx_plies_pos ON plies (pos);', ''));
      db.exec(SCAN_PACK_SCHEMA);
    } else {
      // The sums are re-derived whole either way — since they carry no
      // join and skip thin positions they cost seconds (measured 78 s →
      // of which the sums are ~10), where merging them under the thin
      // threshold would need re-aggregating every touched position
      // anyway.
      db.exec('DROP INDEX IF EXISTS idx_move_counts_pos; DROP TABLE IF EXISTS move_counts;');
    }

    const insert = db.prepare(
      'INSERT INTO plies (pos, uci, game_id, ply, r, eb) VALUES (?, ?, ?, ?, ?, ?)',
    );
    // OR REPLACE: re-running an append over games a died pass already
    // packed must not throw on the primary key.
    const insertPack = packing
      ? db.prepare('INSERT OR REPLACE INTO scan_pack (game_id, pack) VALUES (?, ?)')
      : null;
    // Deep search's reachability columns, backfilled for databases built
    // before them — the page loop below already carries every movetext,
    // and the counts are a string scan (see finalMen).
    for (const column of ['ply_count', 'final_wmen', 'final_bmen']) {
      try {
        db.exec(`ALTER TABLE games ADD COLUMN ${column} INTEGER`);
      } catch {
        /* already there */
      }
    }
    const setMen = db.prepare(
      'UPDATE games SET ply_count = ?, final_wmen = ?, final_bmen = ? WHERE id = ?',
    );
    // What THIS pass will replay — for an append, the games above the
    // high-water id, not the whole table. Counted against the table's
    // total, a small append never hit the every-25k line or the
    // games === total one, so it logged no progress at all and the
    // status endpoint's bar had nothing to read.
    const total = (
      db.prepare('SELECT COUNT(*) AS n FROM games WHERE id > ?').get(sinceId) as { n: number }
    ).n;
    let games = 0;
    let plies = 0;

    // Keyset-paged batches, not one .iterate() over games: better-sqlite3
    // refuses writes while a cursor is open on the same connection, and
    // .all()-ing every movetext at once would hold a whole Elite month's
    // moves (~140 MB) in memory for no reason.
    const page = db.prepare(
      'SELECT id, moves, result, white_elo, black_elo, ply_count FROM games WHERE id > ? ORDER BY id LIMIT 5000',
    );
    let lastId = sinceId;
    for (;;) {
      const batch = page.all(lastId) as {
        id: number;
        moves: string;
        result: string;
        white_elo: number;
        black_elo: number;
        ply_count: number | null;
      }[];
      if (batch.length === 0) break;
      db.exec('BEGIN');
      for (const row of batch) {
        if (row.ply_count === null) {
          const men = finalMen(row.moves);
          setMen.run(row.moves.split(' ').length, men.w, men.b, row.id);
        }
        const pos = Chess.default();
        const r = resultCode(row.result);
        const eb = eloBucket(row.white_elo, row.black_elo);
        let ply = 0;
        for (const san of row.moves.split(' ')) {
          if (ply >= maxPly) break;
          const move = parseSan(pos, san);
          if (!move) break;
          insert.run(toDbKey(hashSetup(pos.toSetup())), makeUci(move), row.id, ply, r, eb);
          pos.play(move);
          ply += 1;
          plies += 1;
        }
        // The pack replays the game again, full depth, in its own
        // module: the loop above is golden-pinned behaviour and stops
        // at maxPly, and sharing its state to save one replay would
        // couple the frozen table to the versioned one.
        insertPack?.run(row.id, Buffer.from(encodeScanPack(row.moves)));
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
    if (packing) setMeta.run(SCAN_PACK_META, String(SCAN_PACK_VERSION));
    setMeta.run('plies', String(append ? (Number(readMeta('plies')) || 0) + plies : plies));
    setMeta.run('index_max_ply', String(maxPly));
    setMeta.run('indexed_at', new Date().toISOString());
    // The index's high-water mark: every game at or below this id has its
    // plies in. A database whose games run past it (an append that died
    // between the insert and this pass) is served as stale, and the
    // listing says so — the honest version of the stale-search-booster
    // failure every desktop database app ships with.
    setMeta.run(
      'indexed_through',
      String((db.prepare('SELECT MAX(id) AS n FROM games').get() as { n: number }).n ?? 0),
    );
    db.pragma('journal_mode = DELETE');
    return { games, plies };
  } finally {
    db.close();
  }
}
