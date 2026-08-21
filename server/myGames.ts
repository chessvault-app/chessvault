import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { PgnParser } from 'chessops/pgn';
import { makeSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { indexGame, pathUser, type Speed } from '../shared/gameIndex.ts';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';
import { openingForKey } from './openings.ts';
import { DATA_MYGAMES, VAULT_GAMES } from './paths.ts';

/**
 * Your own games, explorable at any position, under any filter.
 *
 * This is deliberately NOT an opening book. A book is built, frozen and
 * rebuilt; adding the games you played last week means finding the sources
 * it was built from and running the whole thing again. Worse, the build
 * sums the results away, so a book can never answer a filtered question —
 * and every interesting question about your own games is filtered.
 *
 * So the vault's games are indexed rather than compiled: one row per
 * (position, move, game), the game's metadata beside it, and the summing
 * done per query. Nothing is ever "rebuilt" — the index notices a changed
 * file and reindexes that file alone, which is what makes "I played five
 * games this morning" show up without the user doing anything about it.
 *
 * The index is derived data. Deleting data/mygames.sqlite costs one
 * reindex and nothing else; the games themselves are the PGN files.
 *
 * COST, measured on this machine at ~300 µs per game: 84 games 70 ms,
 * 1k 228 ms, 5k 1.2 s, 20k 5.9 s, and about 2 KB of index per game. Only
 * the FIRST sync pays it — once the `files` table matches the directory a
 * pass is 2–5 ms. It runs inside the request that asks, so a vault in the
 * tens of thousands stalls the server for those seconds once. That is
 * acceptable at the scale this is for and would not be beyond it: the fix,
 * if a vault ever gets there, is to walk the file list across ticks and let
 * lookups answer from what is indexed so far.
 */

export interface MyGamesFilters {
  /** Which side the vault's owner played. */
  side?: 'white' | 'black';
  /** Outcome from the owner's point of view; needs a known side. */
  outcome?: 'win' | 'loss' | 'draw';
  speeds?: Speed[];
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string;
  to?: string;
  /** Only the curated collection, rather than every archived game. */
  collectionOnly?: boolean;
}

interface MoveRow {
  uci: string;
  w: number;
  d: number;
  b: number;
}

interface GameRow {
  uci: string;
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: number;
  date: string | null;
  site: string | null;
  file: string;
  idx: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    mtime_ms REAL NOT NULL,
    bytes INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    file TEXT NOT NULL,
    idx INTEGER NOT NULL,
    white TEXT NOT NULL,
    black TEXT NOT NULL,
    white_elo INTEGER NOT NULL,
    black_elo INTEGER NOT NULL,
    result INTEGER NOT NULL,
    date TEXT,
    speed TEXT,
    eco TEXT,
    user_side TEXT,
    collection INTEGER NOT NULL,
    site TEXT,
    /* One game, two files — see stamp(). The losing copy stays indexed
       and answers nothing: every query goes through where(). */
    shadowed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS plies (
    pos INTEGER NOT NULL,
    uci TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    ply INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS plies_pos ON plies (pos);
  CREATE INDEX IF NOT EXISTS games_file ON games (file);
  CREATE INDEX IF NOT EXISTS games_site ON games (site);
`;

/** Every .pgn under a directory, relative to it. */
function pgnsUnder(root: string): string[] {
  try {
    return (readdirSync(root, { recursive: true }) as unknown as string[])
      .map((entry) => String(entry).split('\\').join('/'))
      .filter((rel) => rel.endsWith('.pgn'));
  } catch {
    return [];
  }
}

/**
 * The live index over a games directory.
 *
 * Kept as a class rather than module state because the tests and the demo
 * each want their own, pointed at their own vault.
 */
class MyGamesIndex {
  private db: InstanceType<typeof Database> | null = null;
  private nextId = 1;
  private lastScan = 0;
  /** Set when the database could not be opened at all (a read-only demo). */
  private broken = false;

  constructor(
    private readonly gamesDir: string,
    private readonly dbPath: string,
  ) {}

  /**
   * Rescan at most this often.
   *
   * The explorer looks up a position on every move, and a scan stats every
   * PGN in the vault. Statting a few hundred files is cheap but not free,
   * and nothing about a vault changes between two arrow-key presses.
   * Scanning the filesystem rather than trusting the app's own writes is
   * deliberate: files also arrive by git pull, by rsync, by hand.
   */
  private static readonly SCAN_INTERVAL_MS = 2000;

  private open(): InstanceType<typeof Database> | null {
    if (this.db) return this.db;
    if (this.broken) return null;
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    } catch {
      // The directory may already exist, or be unwritable — the open below
      // is what actually decides.
    }
    try {
      const db = new Database(this.dbPath);
      db.pragma('journal_mode = WAL');
      db.exec(SCHEMA);
      // `shadowed` arrived after the first vaults did, and CREATE TABLE IF
      // NOT EXISTS does not add a column to a table that is already there.
      // The index is derived and could simply be rebuilt, but a rebuild is
      // a full rescan (seconds on a big vault) and this is one ALTER and
      // one stamping pass. Every row lands at 0, so the pass is not
      // optional: without it an upgraded vault double-counts until the
      // next file changes.
      const columns = db.prepare('PRAGMA table_info(games)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'shadowed')) {
        db.exec('ALTER TABLE games ADD COLUMN shadowed INTEGER NOT NULL DEFAULT 0');
        this.stamp(db);
      }
      const max = db.prepare('SELECT MAX(id) AS id FROM games').get() as { id: number | null };
      this.nextId = (max.id ?? 0) + 1;
      this.db = db;
      return db;
    } catch {
      this.broken = true;
      return null;
    }
  }

  /** Reindex whatever changed. Cheap when nothing did. */
  sync(force = false): void {
    const db = this.open();
    if (!db) return;
    const now = Date.now();
    if (!force && now - this.lastScan < MyGamesIndex.SCAN_INTERVAL_MS) return;
    this.lastScan = now;

    const known = new Map(
      (db.prepare('SELECT path, mtime_ms, bytes FROM files').all() as {
        path: string;
        mtime_ms: number;
        bytes: number;
      }[]).map((r) => [r.path, r]),
    );

    const seen = new Set<string>();
    let changed = false;
    for (const rel of pgnsUnder(this.gamesDir)) {
      seen.add(rel);
      let stat;
      try {
        stat = statSync(`${this.gamesDir}/${rel}`);
      } catch {
        continue; // listed then vanished
      }
      const before = known.get(rel);
      if (before && before.mtime_ms === stat.mtimeMs && before.bytes === stat.size) continue;
      this.indexFile(db, rel, stat.mtimeMs, stat.size);
      changed = true;
    }

    for (const path of known.keys()) {
      if (!seen.has(path)) {
        this.forget(db, path);
        changed = true;
      }
    }

    // Both halves matter, which is why this is one flag and not two: a new
    // file can shadow an existing one, and DELETING a file can un-shadow
    // the copy that was standing behind it. Keeping the game you kept and
    // then deleting the cached month must leave the game answering, not
    // silently drop it out of every count.
    if (changed) this.stamp(db);
  }

  /**
   * Decide which copy of a game answers, when the vault holds more than
   * one.
   *
   * Keeping a game COPIES it into collection/ and leaves the archive month
   * cached, so one game is two rows — and every count was summing both.
   * `site` is the game's own URL (chess.com's [Link], Lichess's [Site]),
   * which is the only thing in a PGN that says "these are the same game"
   * rather than merely resembling it.
   *
   * A row is shadowed when a BETTER copy of it exists: the kept one, and
   * failing that the older row. Exactly one survivor per URL, and the
   * survivor is the annotatable copy.
   *
   * Two guards, both load-bearing:
   * - No URL, no merge. A hand-imported PGN has no `site`, and two games
   *   alike in players, moves and date are what a rematch is.
   * - `user_side` must match. The archive browser caches ANY player's
   *   months, so a vault that has browsed both seats of one game holds it
   *   twice with opposite sides. Those are two rows on purpose: merging
   *   them would answer a "games I had White in" question with the copy
   *   filed under Black.
   *
   * Runs on a changed vault, not on a query — one table scan per sync
   * that did something, and none at all on the usual sync that found
   * nothing new. MEASURED on this machine over 5,500 games, 500 of them
   * kept copies: 3–4 ms, against 661 ms for the first full index of the
   * same vault and 30 ms for a sync that finds nothing.
   */
  private stamp(db: InstanceType<typeof Database>): void {
    db.prepare(`
      UPDATE games SET shadowed = CASE WHEN site IS NOT NULL AND EXISTS (
        SELECT 1 FROM games o
        WHERE o.site = games.site
          AND o.id <> games.id
          AND o.user_side IS games.user_side
          AND (o.collection > games.collection
               OR (o.collection = games.collection AND o.id < games.id))
      ) THEN 1 ELSE 0 END
    `).run();
  }

  private forget(db: InstanceType<typeof Database>, rel: string): void {
    db.prepare('DELETE FROM plies WHERE game_id IN (SELECT id FROM games WHERE file = ?)').run(rel);
    db.prepare('DELETE FROM games WHERE file = ?').run(rel);
    db.prepare('DELETE FROM files WHERE path = ?').run(rel);
  }

  private indexFile(
    db: InstanceType<typeof Database>,
    rel: string,
    mtimeMs: number,
    bytes: number,
  ): void {
    let text: string;
    try {
      text = readFileSync(`${this.gamesDir}/${rel}`, 'utf-8');
    } catch {
      return;
    }

    const user = pathUser(rel);
    const collection = rel.startsWith('collection/') ? 1 : 0;
    const insertGame = db.prepare(`
      INSERT INTO games (id, file, idx, white, black, white_elo, black_elo, result, date, speed, eco, user_side, collection, site)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPly = db.prepare('INSERT INTO plies (pos, uci, game_id, ply) VALUES (?, ?, ?, ?)');

    // One transaction per file: a half-indexed file would be worse than an
    // unindexed one, because the `files` row would claim it was done.
    const run = db.transaction(() => {
      this.forget(db, rel);
      let idx = 0;
      const parser = new PgnParser((game, err) => {
        const at = idx;
        idx += 1;
        if (err) return;
        const indexed = indexGame(game, { file: rel, idx: at, user });
        if (!indexed) return;
        const id = this.nextId;
        this.nextId += 1;
        insertGame.run(
          id,
          rel,
          at,
          indexed.white,
          indexed.black,
          indexed.whiteElo,
          indexed.blackElo,
          indexed.score,
          indexed.date,
          indexed.speed,
          indexed.eco,
          indexed.userSide,
          collection,
          indexed.site,
        );
        for (const p of indexed.plies) insertPly.run(toDbKey(p.hash), p.uci, id, p.ply);
      });
      parser.parse(text);
      db.prepare('INSERT INTO files (path, mtime_ms, bytes) VALUES (?, ?, ?)').run(rel, mtimeMs, bytes);
    });
    run();
  }

  /**
   * The WHERE fragment and binds for a filter set.
   *
   * Outcome is expressed against `user_side` rather than stored: a "win" is
   * a white win in a game you had White in. Games where the side is unknown
   * cannot answer the question and are excluded rather than guessed at.
   *
   * Every query that counts games goes through here, which is the point:
   * the shadowed clause is unconditional, so a second copy of a game
   * cannot reach an aggregate by way of a query that forgot about it.
   */
  private where(f: MyGamesFilters): { sql: string; binds: unknown[] } {
    // See stamp(). Not a filter the caller can turn off — a game counted
    // twice is wrong under every filter, "Kept only" included: the copy
    // that survives a pair is the kept one, so that chip still finds it.
    const clauses: string[] = ['g.shadowed = 0'];
    const binds: unknown[] = [];
    if (f.side) {
      clauses.push('g.user_side = ?');
      binds.push(f.side);
    }
    if (f.outcome) {
      clauses.push('g.user_side IS NOT NULL');
      if (f.outcome === 'draw') {
        clauses.push('g.result = 0');
      } else {
        const winning = f.outcome === 'win';
        clauses.push(
          `((g.user_side = 'white' AND g.result = ?) OR (g.user_side = 'black' AND g.result = ?))`,
        );
        binds.push(winning ? 1 : -1, winning ? -1 : 1);
      }
    }
    if (f.speeds?.length) {
      clauses.push(`g.speed IN (${f.speeds.map(() => '?').join(', ')})`);
      binds.push(...f.speeds);
    }
    if (f.from) {
      clauses.push('g.date >= ?');
      binds.push(f.from);
    }
    if (f.to) {
      clauses.push('g.date <= ?');
      binds.push(f.to);
    }
    if (f.collectionOnly) clauses.push('g.collection = 1');
    // Never empty now — the shadowed clause is always in it.
    return { sql: ` AND ${clauses.join(' AND ')}`, binds };
  }

  /**
   * What was played from this position, and the games that played it.
   *
   * `topGames` is newest-first rather than strongest-first, which is the
   * opposite of a book: a book's reference games are there because they are
   * authoritative, and yours are there because they are yours — the one you
   * played last week is the one you remember.
   */
  /** Just the moves at one position — lookup() without the game list,
      which is all the batch endpoint answers with. */
  movesAt(pos: Chess, filters: MyGamesFilters): (MoveRow & { san: string; total: number })[] {
    const db = this.open();
    if (!db) return [];
    const key = toDbKey(hashSetup(pos.toSetup()));
    const { sql, binds } = this.where(filters);

    const rows = db
      .prepare(`
        SELECT p.uci AS uci,
               SUM(g.result = 1) AS w,
               SUM(g.result = 0) AS d,
               SUM(g.result = -1) AS b
        FROM plies p JOIN games g ON g.id = p.game_id
        WHERE p.pos = ?${sql}
        GROUP BY p.uci
        ORDER BY w + d + b DESC, p.uci
      `)
      .all(key, ...binds) as MoveRow[];

    return rows.flatMap((row) => {
      const move = parseUci(row.uci);
      // Two different positions can share a hash. A move that is not legal
      // here proves this row belongs to the other one.
      if (!move || !pos.isLegal(move)) return [];
      return [{ ...row, san: makeSan(pos, move), total: row.w + row.d + row.b }];
    });
  }

  lookup(
    pos: Chess,
    filters: MyGamesFilters,
    limit = 8,
  ): { moves: (MoveRow & { san: string; total: number })[]; topGames: GameRow[]; games: number } {
    const db = this.open();
    if (!db) return { moves: [], topGames: [], games: 0 };
    const key = toDbKey(hashSetup(pos.toSetup()));
    const { sql, binds } = this.where(filters);

    const moves = this.movesAt(pos, filters);

    const topGames = db
      .prepare(`
        SELECT p.uci AS uci, g.white, g.black, g.white_elo, g.black_elo,
               g.result, g.date, g.site, g.file, g.idx
        FROM plies p JOIN games g ON g.id = p.game_id
        WHERE p.pos = ?${sql}
        ORDER BY g.date DESC, g.id DESC
        LIMIT ?
      `)
      .all(key, ...binds, limit) as GameRow[];

    return { moves, topGames, games: moves.reduce((sum, m) => sum + m.total, 0) };
  }

  /**
   * Where each recent game left a prepared set of positions.
   *
   * The set arrives from the client because only the client can build it:
   * the map's union of prepared positions comes from parsing studies,
   * which the server deliberately never does. Keys are the book scheme's
   * Zobrist hashes, so this walk speaks the same identity as the rest of
   * the index. A game "leaves the book" at the first position that is in
   * the set while the position after its move is not; a game whose whole
   * indexed prefix stays inside never appears.
   *
   * `limit` bounds the games read, newest first, and a shadowed copy is
   * not one of them — the window is that many distinct games.
   */
  deviations(
    keys: ReadonlySet<bigint>,
    side: 'white' | 'black',
    limit: number,
  ): {
    file: string;
    idx: number;
    white: string;
    black: string;
    result: number;
    date: string | null;
    site: string | null;
    ply: number;
    sans: string[];
    key: string;
    userDeviated: boolean;
    /** Kept in the collection, rather than only cached from an archive. */
    collection: boolean;
  }[] {
    const db = this.open();
    if (!db) return [];
    const games = db
      .prepare(`
        SELECT id, file, idx, white, black, result, date, site, collection
        FROM games g
        WHERE g.user_side = ? AND g.shadowed = 0
        ORDER BY g.date DESC, g.id DESC
        LIMIT ?
      `)
      .all(side, limit) as {
      id: number;
      file: string;
      idx: number;
      white: string;
      black: string;
      result: number;
      date: string | null;
      site: string | null;
      collection: number;
    }[];
    // The pair a kept game makes is resolved in the index rather than
    // here — `shadowed` above — so this list and the explorer's numbers
    // agree on what one game is. It was JavaScript in this method first,
    // which fixed the panel and left every count still summing both.
    //
    // `pos` is a 64-bit key and a plain JS number would silently mangle it
    // past 2^53. better-sqlite3 answers that with safeIntegers, which hands
    // back a BigInt — but this same code runs in the static demo over
    // sql.js, which has no BigInt in its API at all: it threw on the
    // method, and stubbing the method would not have helped, because the
    // value has already been through a double by the time JS sees it.
    // CAST to text is exact in both, and the read is the only place this
    // column is taken out of the database rather than bound into a query.
    const pliesOf = db.prepare(
      'SELECT CAST(pos AS TEXT) AS pos, uci FROM plies WHERE game_id = ? ORDER BY ply',
    );

    const out: ReturnType<MyGamesIndex['deviations']> = [];
    for (const game of games) {
      const plies = (pliesOf.all(game.id) as { pos: string; uci: string }[]).map((row) => ({
        pos: BigInt(row.pos),
        uci: row.uci,
      }));
      if (plies.length === 0 || !keys.has(plies[0]!.pos)) continue;
      let at = -1;
      for (let k = 0; k < plies.length; k += 1) {
        if (!keys.has(plies[k]!.pos)) break;
        if (k + 1 >= plies.length || !keys.has(plies[k + 1]!.pos)) {
          at = k;
          break;
        }
      }
      // The indexed prefix never left the set — nothing to report. A game
      // that merely ran out of indexed plies inside the book is the same.
      if (at < 0 || at + 1 >= plies.length) continue;
      // SANs up to and including the deviating move, replayed from the
      // start; an index row that fails to replay proves a hash collision
      // and drops the game rather than reporting nonsense.
      const pos = Chess.default();
      const sans: string[] = [];
      let ok = true;
      for (let k = 0; k <= at; k += 1) {
        const move = parseUci(plies[k]!.uci);
        if (!move || !pos.isLegal(move)) {
          ok = false;
          break;
        }
        sans.push(makeSan(pos, move));
        pos.play(move);
      }
      if (!ok) continue;
      out.push({
        file: game.file,
        idx: game.idx,
        white: game.white,
        black: game.black,
        result: game.result,
        date: game.date,
        site: game.site,
        collection: game.collection === 1,
        ply: at,
        sans,
        key: BigInt.asUintN(64, plies[at]!.pos).toString(16),
        userDeviated: (at % 2 === 0) === (side === 'white'),
      });
    }
    return out;
  }

  /**
   * Row counts, for the pane's "indexed N games" line.
   *
   * `matching` answers the filter window's question — how many games the
   * chips in front of you still let through — which is the number worth
   * reading while setting them. It equals `games` when nothing is set,
   * which is why `games` counts what can answer rather than what is
   * stored: a shadowed copy is a row in the table but not a game you
   * played, and a line reading "482 games" beside 481 answerable ones is
   * the double-count wearing a different hat.
   */
  stats(filters: MyGamesFilters = {}): { games: number; positions: number; matching: number } {
    const db = this.open();
    if (!db) return { games: 0, positions: 0, matching: 0 };
    const games = (
      db.prepare('SELECT COUNT(*) AS n FROM games WHERE shadowed = 0').get() as { n: number }
    ).n;
    const positions = (
      db.prepare('SELECT COUNT(DISTINCT pos) AS n FROM plies').get() as { n: number }
    ).n;
    const { sql, binds } = this.where(filters);
    const matching = (
      db.prepare(`SELECT COUNT(*) AS n FROM games g WHERE 1 = 1${sql}`).get(...binds) as {
        n: number;
      }
    ).n;
    return { games, positions, matching };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

const RESULT_TEXT: Record<number, string> = { 1: '1-0', 0: '1/2-1/2', [-1]: '0-1' };
const SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Read the filter set out of a query string, ignoring anything malformed. */
function parseFilters(query: (key: string) => string | undefined): MyGamesFilters {
  const side = query('side');
  const outcome = query('outcome');
  const speeds = (query('speeds') ?? '')
    .split(',')
    .filter((s): s is Speed => (SPEEDS as string[]).includes(s));
  const from = query('from');
  const to = query('to');
  return {
    side: side === 'white' || side === 'black' ? side : undefined,
    outcome:
      outcome === 'win' || outcome === 'loss' || outcome === 'draw' ? outcome : undefined,
    speeds: speeds.length > 0 && speeds.length < SPEEDS.length ? speeds : undefined,
    from: from && DATE_RE.test(from) ? from : undefined,
    to: to && DATE_RE.test(to) ? to : undefined,
    collectionOnly: query('collection') === '1',
  };
}

export function myGamesApi(
  gamesDir: string = VAULT_GAMES,
  dbPath: string = DATA_MYGAMES,
): Hono {
  const index = new MyGamesIndex(gamesDir, dbPath);
  const api = new Hono();

  api.get('/mygames', (c) => {
    const fen = c.req.query('fen');
    if (!fen) return c.json({ error: 'missing ?fen=' }, 400);
    let pos: Chess;
    try {
      pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    } catch {
      return c.json({ error: 'invalid FEN' }, 400);
    }

    index.sync();
    const filters = parseFilters((key) => c.req.query(key));
    const { moves, topGames, games } = index.lookup(pos, filters);

    return c.json({
      opening: openingForKey(hashSetup(pos.toSetup()).toString(16)),
      moves,
      games,
      topGames: topGames.map((g) => ({
        uci: g.uci,
        white: g.white,
        black: g.black,
        whiteElo: g.white_elo,
        blackElo: g.black_elo,
        result: RESULT_TEXT[g.result] ?? '*',
        date: g.date,
        site: g.site,
        // Yours, so the pane can open the game rather than only link out.
        file: g.file,
        index: g.idx,
      })),
    });
  });

  /**
   * The same answer as /mygames, for many positions at once and without
   * the parts only a single position needs — the shape the reference
   * database batch route answers, because the same caller asks both: the
   * opening map's field sweep, which wants every charted position.
   *
   * One request each was fine against localhost and seconds against a
   * small remote server: a phone runs about six requests at a time to
   * one origin, so a few-hundred-node map paid hundreds of round trips
   * for lookups the index answers in well under a millisecond each.
   */
  api.post('/mygames/explore-batch', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { fens?: unknown } | null;
    const fens = Array.isArray(body?.fens)
      ? body.fens.filter((f): f is string => typeof f === 'string')
      : null;
    if (!fens) return c.json({ error: 'expected fens' }, 400);
    // The reference batch route's ceiling; the client chunks well under it.
    if (fens.length > 256) return c.json({ error: 'too many positions' }, 400);

    index.sync();
    const filters = parseFilters((key) => c.req.query(key));
    const positions = fens.map((fen) => {
      let pos: Chess;
      try {
        pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
      } catch {
        // One bad FEN answers empty rather than failing the whole batch.
        return { fen, moves: [] };
      }
      return { fen, moves: index.movesAt(pos, filters) };
    });
    return c.json({ positions });
  });

  /** Where recent games left a prepared position set — see deviations(). */
  api.post('/mygames/deviations', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      keys?: unknown;
      side?: unknown;
      limit?: unknown;
    } | null;
    const side = body?.side;
    const rawKeys = body?.keys;
    if (
      (side !== 'white' && side !== 'black') ||
      !Array.isArray(rawKeys) ||
      rawKeys.length === 0 ||
      rawKeys.length > 50_000 ||
      !rawKeys.every((k) => typeof k === 'string' && /^[0-9a-f]{1,16}$/.test(k))
    ) {
      return c.json({ error: 'expected { keys: hex[], side }' }, 400);
    }
    const limit = Math.min(500, Math.max(1, Number(body?.limit) || 200));
    const keys = new Set<bigint>(rawKeys.map((k) => toDbKey(BigInt(`0x${k}`))));
    index.sync();
    return c.json({
      deviations: index
        .deviations(keys, side, limit)
        .map((d) => ({ ...d, result: RESULT_TEXT[d.result] ?? '*' })),
    });
  });

  /** What the index holds — and a way to make it catch up on demand. */
  api.get('/mygames/status', (c) => {
    index.sync();
    return c.json(index.stats(parseFilters((k) => c.req.query(k))));
  });

  api.post('/mygames/reindex', (c) => {
    index.sync(true);
    return c.json(index.stats());
  });

  return api;
}
