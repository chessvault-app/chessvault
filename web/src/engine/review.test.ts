import { describe, expect, it } from 'vitest';
import { cpOf, judgeLine, judgeNag, moveAccuracy, moverChances, summarise } from './review';

describe('review judgments (lichess criteria)', () => {
  it('maps winning-chance drops to NAGs at the lila thresholds', () => {
    expect(judgeNag(0.04)).toBeNull();
    expect(judgeNag(0.05)).toBe(6); // ?!
    expect(judgeNag(0.1)).toBe(2); // ?
    expect(judgeNag(0.15)).toBe(4); // ??
    expect(judgeNag(0.5)).toBe(4);
  });

  it('scores accuracy 100 for lossless moves and decays with loss', () => {
    expect(moveAccuracy(50, 50)).toBeCloseTo(100, 3);
    expect(moveAccuracy(50, 60)).toBeCloseTo(100, 3); // gaining is not penalised
    expect(moveAccuracy(90, 40)).toBeLessThan(15);
    expect(moveAccuracy(50, 45)).toBeGreaterThan(75);
  });

  it('clamps mates to ±1000cp and flips chances for black', () => {
    expect(cpOf({ mate: 3 })).toBe(1000);
    expect(cpOf({ mate: -2 })).toBe(-1000);
    expect(cpOf({ cp: 2500 })).toBe(1000);
    expect(moverChances({ cp: 200 }, 'white')).toBeGreaterThan(0.6);
    expect(moverChances({ cp: 200 }, 'black')).toBeLessThan(0.4);
  });

  it('judges a line and attributes moves to the right side', () => {
    // Equal, equal, then white blunders a rook (white-POV scores; the
    // third move is black's and gains — never judged against black).
    const scores = [{ cp: 20 }, { cp: 15 }, { cp: 10 }, { cp: -500 }];
    const verdicts = judgeLine(scores, 'white');
    expect(verdicts).toHaveLength(3);
    expect(verdicts[0]!.mover).toBe('white');
    expect(verdicts[0]!.nag).toBeNull();
    expect(verdicts[1]!.mover).toBe('black');
    expect(verdicts[2]!.mover).toBe('white');
    expect(verdicts[2]!.nag).toBe(4); // ??

    const white = summarise(verdicts, 'white');
    expect(white.moves).toBe(2);
    expect(white.blunders).toBe(1);
    expect(white.acpl).toBeGreaterThan(200);
    const black = summarise(verdicts, 'black');
    expect(black.blunders).toBe(0);
    expect(black.accuracy).toBe(100);
  });

  it('withholds judgment inside the book prefix, but keeps measuring', () => {
    // White opens with a gambit worth ~7% of winning chances, black keeps
    // the pawn, then white blunders. Judged cold, move one is a ?!.
    const scores = [{ cp: 20 }, { cp: -60 }, { cp: -70 }, { cp: -400 }];
    expect(judgeLine(scores, 'white')[0]!.nag).toBe(6);

    // The same line with its first two moves known theory: the gambit is
    // book, not an inaccuracy — and judgment resumes the move after.
    const booked = judgeLine(scores, 'white', undefined, 2);
    expect(booked[0]!.book).toBe(true);
    expect(booked[0]!.nag).toBeNull();
    expect(booked[1]!.book).toBe(true);
    expect(booked[2]!.book).toBe(false);
    expect(booked[2]!.nag).toBe(4); // ??
    // Suppressed verdict, honest measurement: accuracy still took the hit.
    expect(booked[0]!.accuracy).toBeLessThan(100);

    const white = summarise(booked, 'white');
    expect(white.bookMoves).toBe(1);
    expect(white.inaccuracies).toBe(0);
    expect(white.blunders).toBe(1);
    expect(summarise(booked, 'black').bookMoves).toBe(1);
  });

  it('handles a black-to-move start (puzzle-like FENs)', () => {
    const scores = [{ cp: 0 }, { cp: 0 }, { cp: 0 }];
    const verdicts = judgeLine(scores, 'black');
    expect(verdicts[0]!.mover).toBe('black');
    expect(verdicts[1]!.mover).toBe('white');
  });
});
