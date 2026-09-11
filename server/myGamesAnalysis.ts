import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * What the engine pass found in each of the owner's games.
 *
 * The pass runs in the CLIENT: the server has no engine, and the app is
 * HTTP-API-only, so the browser's Stockfish walks a game, judges it with
 * the same code the analysis board's review uses (web/src/engine/
 * review.ts) and puts the summary here. This file is the memory of that
 * work. It is derived data, but expensive derived data: hours of engine
 * time for a big vault, which is why it is its own database and not a
 * column of the games index. Deleting data/mygames.sqlite costs one
 * reindex; deleting this costs the pass again.
 *
 * A record is keyed the way the index keys a game, by file and position
 * in it, and carries the game's URL and length beside the key. An
 * archive month is rewritten when it is browsed again, and if games move
 * within the file a record would attach to the wrong game silently: the
 * URL (or, for a hand-imported file with none, the length) is checked
 * at read time and a record that no longer fits is treated as absent, so
 * the pass does that game again rather than report another game's
 * numbers under its name.
 */

/** One judged move of the OWNER's, compact: the ply, the accuracy, the
    quality NAG (0 for none), the phase the position was in (0 opening,
    1 middlegame, 2 endgame) and whether it was book (1) or judged (0). */
export type PerMove = [ply: number, accuracy: number, nag: number, phase: number, book: number];

export interface AnalysisRecord {
  file: string;
  index: number;
  side: 'white' | 'black';
  /** The game's URL, when the PGN had one; the identity check. */
  site: string | null;
  /** The whole mainline's length, the identity check without a URL. */
  plies: number;
  /** The search depth every position was judged at. */
  depth: number;
  /** Per-game, the owner's moves: the review's SideSummary, flattened. */
  accuracy: number;
  acpl: number;
  moves: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  brilliancies: number;
  bookMoves: number;
  perMove: PerMove[];
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS analysis (
    file TEXT NOT NULL,
    idx INTEGER NOT NULL,
    side TEXT NOT NULL,
    site TEXT,
    plies INTEGER NOT NULL,
    depth INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    acpl INTEGER NOT NULL,
    moves INTEGER NOT NULL,
    inaccuracies INTEGER NOT NULL,
    mistakes INTEGER NOT NULL,
    blunders INTEGER NOT NULL,
    brilliancies INTEGER NOT NULL,
    book_moves INTEGER NOT NULL,
    per_move TEXT NOT NULL,
    analysed_at TEXT NOT NULL,
    PRIMARY KEY (file, idx)
  );
`;

interface Row {
  file: string;
  idx: number;
  side: 'white' | 'black';
  site: string | null;
  plies: number;
  depth: number;
  accuracy: number;
  acpl: number;
  moves: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  brilliancies: number;
  book_moves: number;
  per_move: string;
}

const rowToRecord = (r: Row): AnalysisRecord => ({
  file: r.file,
  index: r.idx,
  side: r.side,
  site: r.site,
  plies: r.plies,
  depth: r.depth,
  accuracy: r.accuracy,
  acpl: r.acpl,
  moves: r.moves,
  inaccuracies: r.inaccuracies,
  mistakes: r.mistakes,
  blunders: r.blunders,
  brilliancies: r.brilliancies,
  bookMoves: r.book_moves,
  perMove: JSON.parse(r.per_move) as PerMove[],
});

/** The key the index and this store agree on. */
export const analysisKey = (file: string, index: number): string => `${file}\t${index}`;

/**
 * Whether a stored record still describes the game now at its key: the
 * URL where the game has one, and where it has none, no URL on the
 * record either and the same length. A record that names a URL for a
 * game that has none was made from a different file state, whatever the
 * lengths say.
 */
export function recordFits(
  record: Pick<AnalysisRecord, 'site' | 'plies'>,
  game: { site: string | null; plies: number | null },
): boolean {
  if (game.site) return record.site === game.site;
  return record.site === null && game.plies !== null && record.plies === game.plies;
}

export class AnalysisStore {
  private db: InstanceType<typeof Database> | null = null;
  private broken = false;

  constructor(private readonly dbPath: string) {}

  private open(): InstanceType<typeof Database> | null {
    if (this.db) return this.db;
    if (this.broken) return null;
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    } catch {
      // The open below decides.
    }
    try {
      const db = new Database(this.dbPath);
      db.pragma('journal_mode = WAL');
      db.exec(SCHEMA);
      this.db = db;
      return db;
    } catch {
      this.broken = true;
      return null;
    }
  }

  /** Every record, keyed for the insights walk. Thousands of small rows
      at most; read whole rather than queried per game. */
  all(): Map<string, AnalysisRecord> {
    const db = this.open();
    const out = new Map<string, AnalysisRecord>();
    if (!db) return out;
    for (const row of db.prepare('SELECT * FROM analysis').all() as Row[]) {
      out.set(analysisKey(row.file, row.idx), rowToRecord(row));
    }
    return out;
  }

  put(record: AnalysisRecord): void {
    const db = this.open();
    if (!db) return;
    db.prepare(`
      INSERT INTO analysis (file, idx, side, site, plies, depth, accuracy, acpl, moves,
        inaccuracies, mistakes, blunders, brilliancies, book_moves, per_move, analysed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (file, idx) DO UPDATE SET
        side = excluded.side, site = excluded.site, plies = excluded.plies,
        depth = excluded.depth, accuracy = excluded.accuracy, acpl = excluded.acpl,
        moves = excluded.moves, inaccuracies = excluded.inaccuracies,
        mistakes = excluded.mistakes, blunders = excluded.blunders,
        brilliancies = excluded.brilliancies, book_moves = excluded.book_moves,
        per_move = excluded.per_move, analysed_at = excluded.analysed_at
    `).run(
      record.file,
      record.index,
      record.side,
      record.site,
      record.plies,
      record.depth,
      record.accuracy,
      record.acpl,
      record.moves,
      record.inaccuracies,
      record.mistakes,
      record.blunders,
      record.brilliancies,
      record.bookMoves,
      JSON.stringify(record.perMove),
      new Date().toISOString(),
    );
  }

  /** Forget everything: the pass starts over (a deeper search, say). */
  clear(): void {
    this.open()?.prepare('DELETE FROM analysis').run();
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

/**
 * Read a record out of a request body, strictly: a shape that does not
 * fit is refused rather than stored with holes, because a half record
 * would count in every average as a real one. Numbers are clamped to
 * what the review can produce.
 */
export function parseRecord(body: unknown): AnalysisRecord | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  const num = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  const file = typeof b.file === 'string' && b.file.length > 0 && b.file.length < 1024 ? b.file : null;
  const index = int(b.index, 0, 1_000_000);
  const side = b.side === 'white' || b.side === 'black' ? b.side : null;
  const site = b.site === null || b.site === undefined ? null : typeof b.site === 'string' ? b.site.slice(0, 512) : undefined;
  const plies = int(b.plies, 1, 2000);
  const depth = int(b.depth, 1, 60);
  const accuracy = num(b.accuracy, 0, 100);
  const acpl = int(b.acpl, 0, 1000);
  const moves = int(b.moves, 0, 1000);
  const inaccuracies = int(b.inaccuracies, 0, 1000);
  const mistakes = int(b.mistakes, 0, 1000);
  const blunders = int(b.blunders, 0, 1000);
  const brilliancies = int(b.brilliancies, 0, 1000);
  const bookMoves = int(b.bookMoves, 0, 1000);
  const perMove = Array.isArray(b.perMove) && b.perMove.length <= 1000 ? b.perMove : null;
  if (
    file === null || index === null || side === null || site === undefined || plies === null ||
    depth === null || accuracy === null || acpl === null || moves === null ||
    inaccuracies === null || mistakes === null || blunders === null || brilliancies === null ||
    bookMoves === null || perMove === null
  ) {
    return null;
  }
  const moveRows: PerMove[] = [];
  for (const m of perMove) {
    if (!Array.isArray(m) || m.length !== 5) return null;
    const ply = int(m[0], 0, 2000);
    const acc = num(m[1], 0, 100);
    const nag = int(m[2], 0, 6);
    const phase = int(m[3], 0, 2);
    const book = int(m[4], 0, 1);
    if (ply === null || acc === null || nag === null || phase === null || book === null) return null;
    moveRows.push([ply, acc, nag, phase, book]);
  }
  return {
    file, index, side, site, plies, depth, accuracy, acpl, moves,
    inaccuracies, mistakes, blunders, brilliancies, bookMoves, perMove: moveRows,
  };
}
