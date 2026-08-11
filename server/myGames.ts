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
    site TEXT
  );
  CREATE TABLE IF NOT EXISTS plies (
    pos INTEGER NOT NULL,
    uci TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    ply INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS plies_pos ON plies (pos);
  CREATE INDEX IF NOT EXISTS games_file ON games (file);
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
export class MyGamesIndex {
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
    }

    for (const path of known.keys()) {
      if (!seen.has(path)) this.forget(db, path);
    }
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
   */
  private where(f: MyGamesFilters): { sql: string; binds: unknown[] } {
    const clauses: string[] = [];
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
    return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', binds };
  }

  /**
   * What was played from this position, and the games that played it.
   *
   * `topGames` is newest-first rather than strongest-first, which is the
   * opposite of a book: a book's reference games are there because they are
   * authoritative, and yours are there because they are yours — the one you
   * played last week is the one you remember.
   */
  lookup(
    pos: Chess,
    filters: MyGamesFilters,
    limit = 8,
  ): { moves: (MoveRow & { san: string; total: number })[]; topGames: GameRow[]; games: number } {
    const db = this.open();
    if (!db) return { moves: [], topGames: [], games: 0 };
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

    const moves = rows.flatMap((row) => {
      const move = parseUci(row.uci);
      // Two different positions can share a hash. A move that is not legal
      // here proves this row belongs to the other one.
      if (!move || !pos.isLegal(move)) return [];
      return [{ ...row, san: makeSan(pos, move), total: row.w + row.d + row.b }];
    });

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

  /** Row counts, for the pane's "indexed N games" line. */
  stats(): { games: number; positions: number } {
    const db = this.open();
    if (!db) return { games: 0, positions: 0 };
    const games = (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
    const positions = (
      db.prepare('SELECT COUNT(DISTINCT pos) AS n FROM plies').get() as { n: number }
    ).n;
    return { games, positions };
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
export function parseFilters(query: (key: string) => string | undefined): MyGamesFilters {
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

  /** What the index holds — and a way to make it catch up on demand. */
  api.get('/mygames/status', (c) => {
    index.sync();
    return c.json(index.stats());
  });

  api.post('/mygames/reindex', (c) => {
    index.sync(true);
    return c.json(index.stats());
  });

  return api;
}
