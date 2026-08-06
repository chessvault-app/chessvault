import { describe, expect, it } from 'vitest';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { hashSetup, toDbKey } from './zobrist.ts';

function play(sans: string[]): Chess {
  const pos = Chess.default();
  for (const san of sans) {
    const move = parseSan(pos, san);
    if (!move) throw new Error(`illegal san ${san}`);
    pos.play(move);
  }
  return pos;
}

function hashFen(fen: string): bigint {
  return hashSetup(
    Chess.fromSetup(parseFen(fen).unwrap()).unwrap().toSetup(),
  );
}

describe('zobrist', () => {
  it('is locked to the published scheme (books must outlive processes)', () => {
    // If these change, every built book becomes unreadable. Bump
    // BOOK_SCHEMA_VERSION and force rebuilds instead of editing the vectors.
    expect(hashSetup(Chess.default().toSetup()).toString(16)).toBe('a3179e4796df93c0');
    expect(hashSetup(play(['e4']).toSetup()).toString(16)).toBe('6f3dc93e14abccea');
  });

  it('hashes transpositions identically', () => {
    expect(hashSetup(play(['d4', 'd5', 'c4']).toSetup())).toBe(
      hashSetup(play(['c4', 'd5', 'd4']).toSetup()),
    );
  });

  it('normalises a non-capturable en-passant square away', () => {
    // After 1.e4 chessops sets epSquare internally, but no black pawn can
    // capture on e3, so a FEN that still carries "e3" must hash the same as
    // the played position. This is the index-vs-query consistency guarantee.
    const viaPlay = hashSetup(play(['e4']).toSetup());
    const viaFen = hashFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(viaFen).toBe(viaPlay);
  });

  it('keeps a capturable en-passant square in the hash', () => {
    // 1.e4 c5 2.e5 d5 — exd6 is legal, so d6 is part of the position.
    const board = 'rnbqkbnr/pp2pppp/8/2ppP3/8/8/PPPP1PPP/RNBQKBNR w KQkq';
    expect(hashFen(`${board} d6 0 3`)).not.toBe(hashFen(`${board} - 0 3`));
    expect(hashSetup(play(['e4', 'c5', 'e5', 'd5']).toSetup())).toBe(
      hashFen(`${board} d6 0 3`),
    );
  });

  it('distinguishes turn and castling rights', () => {
    const base = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
    expect(hashFen(`${base} w KQkq - 0 1`)).not.toBe(hashFen(`${base} b KQkq - 0 1`));
    expect(hashFen(`${base} w KQkq - 0 1`)).not.toBe(hashFen(`${base} w Qkq - 0 1`));
  });

  it('ignores move counters (book keys are EPD-level)', () => {
    const board = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
    expect(hashFen(`${board} 0 1`)).toBe(hashFen(`${board} 30 60`));
  });

  it('maps to a signed 64-bit SQLite key and back', () => {
    const h = 0xa3179e4796df93c0n; // high bit set → negative as INTEGER
    expect(toDbKey(h)).toBe(h - (1n << 64n));
    expect(BigInt.asUintN(64, toDbKey(h))).toBe(h);
    expect(toDbKey(0x1234n)).toBe(0x1234n);
  });
});
