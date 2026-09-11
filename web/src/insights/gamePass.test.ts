import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from 'chessops/fen';
import { judgeLine } from '@/engine/review';
import { bookPrefix, buildRecord, lineOf, phaseOf } from './gamePass';

describe('engine pass bookkeeping', () => {
  it('turns a PGN into the position before every move', () => {
    const line = lineOf('[White "me"]\n[Black "foe"]\n\n1. e4 e5 2. Nf3 1-0')!;
    expect(line.plies).toBe(3);
    expect(line.fens[0]).toBe(INITIAL_FEN);
    // After 2.Nf3 it is Black to move.
    expect(line.fens[3]!.split(' ')[1]).toBe('b');
  });

  it('refuses what the index refuses, and stops at an illegal move', () => {
    expect(lineOf('[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n[SetUp "1"]\n\n1. Kb1 *')).toBeNull();
    expect(lineOf('[Variant "Chess960"]\n\n1. e4 *')).toBeNull();
    expect(lineOf('\n\n*')).toBeNull();
    expect(lineOf('1. e4 e5 2. Ke2 Ke7 3. Qh5 1-0')!.plies).toBe(4);
  });

  it('reads the phase off the pieces left', () => {
    expect(phaseOf(INITIAL_FEN)).toBe(0);
    // Fourteen pieces is still the opening; ten is the middlegame's ceiling.
    expect(phaseOf('r1bqkb1r/pppppppp/2n2n2/8/8/2N2N2/PPPPPPPP/R1BQKB1R w KQkq - 0 1')).toBe(0);
    expect(phaseOf('r2qkb1r/pppppppp/2n5/8/8/2N5/PPPPPPPP/R2QKB1R w KQkq - 0 1')).toBe(1);
    // Six pieces is the endgame's ceiling.
    expect(phaseOf('r2qk2r/pppppppp/8/8/8/8/PPPPPPPP/R2QK2R w KQkq - 0 1')).toBe(2);
    expect(phaseOf('not a fen')).toBe(1);
  });

  it('counts book moves until the first that is not', () => {
    expect(bookPrefix([true, true, false, true], 30)).toBe(2);
    expect(bookPrefix([true, true, true], 2)).toBe(2);
    expect(bookPrefix([], 30)).toBe(0);
  });

  it('builds the record from the verdicts of my own moves only', () => {
    const line = lineOf('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0')!;
    // White-POV scores: level, level, level, level, level, level, then
    // Black's 3...Nf6 walks into mate.
    const scores = [
      { cp: 20 }, { cp: 20 }, { cp: 20 }, { cp: 0 }, { cp: 10 }, { cp: 10 },
      { mate: 1 }, { mate: 0 },
    ];
    const verdicts = judgeLine(scores, 'white', undefined, 2);
    const record = buildRecord({
      file: 'chesscom/me/2026-08.pgn',
      index: 3,
      side: 'black',
      site: 'https://www.chess.com/game/live/1',
      depth: 12,
      fens: line.fens,
      verdicts,
    });
    expect(record.plies).toBe(7);
    expect(record.moves).toBe(3);
    // Black's plies are 1, 3, 5; the first is book.
    expect(record.perMove.map((m) => m[0])).toEqual([1, 3, 5]);
    expect(record.perMove[0]![4]).toBe(1);
    expect(record.perMove[2]![2]).toBe(4); // 3...Nf6?? allowed mate
    expect(record.blunders).toBe(1);
    expect(record.perMove.every((m) => m[3] === 0)).toBe(true); // all pieces still on
    expect(record.accuracy).toBeLessThan(100);
  });
});
