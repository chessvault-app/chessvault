import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { hashSetup, toDbKey } from '../../shared/zobrist.ts';
import { buildBook, type BuildResult } from './book-builder.ts';

/**
 * Seven games, hand-checkable:
 *  1. e4 e5 Nf3, 1-0, 2500/2400          counted
 *  2. e4 e5 Nf3, ½-½, 2600/2600          counted
 *  3. e4 c5,     0-1, 2000/2000          counted
 *  4. d4 d5,     1-0, 2200/2200          counted (after-d4 pruned: 1 game)
 *  5. atomic variant                      skipped
 *  6. unfinished (*)                      skipped
 *  7. from a set-up position              skipped
 */
const PGN = `
[White "Ann"]
[Black "Ben"]
[WhiteElo "2500"]
[BlackElo "2400"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0

[White "Cy"]
[Black "Dee"]
[WhiteElo "2600"]
[BlackElo "2600"]
[UTCDate "2026.01.15"]
[Result "1/2-1/2"]

1. e4 e5 2. Nf3 1/2-1/2

[White "Eve"]
[Black "Fox"]
[WhiteElo "2000"]
[BlackElo "2000"]
[Result "0-1"]

1. e4 c5 0-1

[White "Gil"]
[Black "Hal"]
[WhiteElo "2200"]
[BlackElo "2200"]
[Result "1-0"]

1. d4 d5 1-0

[Variant "Atomic"]
[Result "1-0"]

1. e4 e5 1-0

[White "Ida"]
[Black "Jo"]
[Result "*"]

1. e4 *

[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]
[SetUp "1"]
[Result "1-0"]

1. Rh8+ 1-0
`;

function keyAfter(sans: string[]): bigint {
  const pos = Chess.default();
  for (const san of sans) pos.play(parseSan(pos, san)!);
  return toDbKey(hashSetup(pos.toSetup()));
}

describe('buildBook', () => {
  let dir: string;
  let db: InstanceType<typeof Database>;
  let result: BuildResult;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'book-test-'));
    const source = join(dir, 'games.pgn');
    writeFileSync(source, PGN);
    result = await buildBook({
      name: 'test',
      sources: [source],
      out: join(dir, 'test.sqlite'),
      // Tiny flush threshold so the upsert/merge path is exercised too.
      flushRows: 2,
    });
    db = new Database(join(dir, 'test.sqlite'), { readonly: true });
  });

  afterAll(() => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts games and skips variant/unfinished/set-up games', () => {
    expect(result.games).toBe(4);
    expect(result.skipped).toBe(3);
    expect(result.parseErrors).toBe(0);
  });

  it('tallies w/d/b per move from the start position', () => {
    const rows = db
      .prepare('SELECT uci, w, d, b FROM book WHERE pos = ? ORDER BY w + d + b DESC')
      .all(keyAfter([])) as { uci: string; w: number; d: number; b: number }[];
    expect(rows).toEqual([
      { uci: 'e2e4', w: 1, d: 1, b: 1 },
      { uci: 'd2d4', w: 1, d: 0, b: 0 },
    ]);
  });

  it('keeps positions reached by >= minGames games, prunes the rest', () => {
    expect(result.positions).toBe(3); // start, after e4, after e4 e5
    expect(result.rows).toBe(5); // e4+d4, e5+c5, Nf3
    const afterD4 = db
      .prepare('SELECT COUNT(*) AS n FROM book WHERE pos = ?')
      .get(keyAfter(['d4'])) as { n: number };
    expect(afterD4.n).toBe(0);
  });

  it('a single-game move at a popular position survives (per-position pruning)', () => {
    const row = db
      .prepare('SELECT w, d, b FROM book WHERE pos = ? AND uci = ?')
      .get(keyAfter(['e4']), 'c7c5') as { w: number; d: number; b: number };
    expect(row).toEqual({ w: 0, d: 0, b: 1 });
  });

  it('stores top reference games ordered by rating', () => {
    const top = db
      .prepare(`
        SELECT g.white, g.black, t.uci, t.elo FROM top_games t
        JOIN games g ON g.id = t.game_id
        WHERE t.pos = ? ORDER BY t.elo DESC
      `)
      .all(keyAfter([])) as { white: string; black: string; uci: string; elo: number }[];
    expect(top.map((t) => [t.white, t.uci, t.elo])).toEqual([
      ['Cy', 'e2e4', 2600],
      ['Ann', 'e2e4', 2450],
      ['Gil', 'd2d4', 2200],
    ]);
  });

  it('drops reference games for pruned positions and unreferenced game rows', () => {
    const orphanRefs = db
      .prepare('SELECT COUNT(*) AS n FROM top_games WHERE pos NOT IN (SELECT pos FROM book)')
      .get() as { n: number };
    expect(orphanRefs.n).toBe(0);
    const orphanGames = db
      .prepare('SELECT COUNT(*) AS n FROM games WHERE id NOT IN (SELECT game_id FROM top_games)')
      .get() as { n: number };
    expect(orphanGames.n).toBe(0);
  });

  it('records build settings in meta', () => {
    const meta = Object.fromEntries(
      (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[])
        .map((r) => [r.key, r.value]),
    );
    expect(meta.schemaVersion).toBe('1');
    expect(meta.games).toBe('4');
    expect(meta.maxPly).toBe('24');
    expect(meta.minGames).toBe('2');
  });
});
