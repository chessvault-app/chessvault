import { describe, expect, it } from 'vitest';
import {
  cpOf,
  judgeLine,
  judgeNag,
  judgeTablebase,
  moveAccuracy,
  moverChances,
  outcomeOf,
  summarise,
  type Score,
} from './review';

describe('judging against the tables instead of the engine', () => {
  it('reads the fifty-move pair as the draw they end in', () => {
    expect(outcomeOf('win')).toBe('win');
    expect(outcomeOf('loss')).toBe('loss');
    expect(outcomeOf('draw')).toBe('draw');
    // A win the rule draws IS a draw, and its mirror likewise.
    expect(outcomeOf('cursed-win')).toBe('draw');
    expect(outcomeOf('blessed-loss')).toBe('draw');
    // Not sure is not a verdict to stamp a blunder on.
    expect(outcomeOf('maybe-win')).toBeNull();
    expect(outcomeOf('unknown')).toBeNull();
    expect(outcomeOf(null)).toBeNull();
  });

  it('blunders only on a changed result, and turns the reply round', () => {
    // The verdict after a move belongs to the OPPONENT: their loss is the
    // mover's win, so this one held everything.
    expect(judgeTablebase('win', 'loss')).toBeNull();
    // Won, then drawn: the whole point thrown away.
    expect(judgeTablebase('win', 'draw')).toBe(4);
    // Drawn, then lost.
    expect(judgeTablebase('draw', 'win')).toBe(4);
    // Already lost: there is nothing left to lose.
    expect(judgeTablebase('loss', 'win')).toBeNull();
    // Distance is not the point — a win is a win however far away.
    expect(judgeTablebase('win', 'loss')).toBeNull();
    // Nothing to compare against.
    expect(judgeTablebase('win', 'unknown')).toBeNull();
    expect(judgeTablebase(null, 'draw')).toBeNull();
  });

  it('lets the table overrule the engine in both directions', () => {
    // A collapse in evaluation that changed nothing: +9.0 to +3.0 is a
    // blunder by winning chances and is not a mistake at all in a won
    // ending. White to move both times, so the reply reads `loss`.
    const held = judgeLine([{ cp: 900 }, { cp: 300 }], 'white', undefined, 0, ['win', 'loss']);
    expect(judgeNag(moverChances({ cp: 900 }, 'white') - moverChances({ cp: 300 }, 'white'))).toBe(4);
    expect(held[0]!.nag).toBeNull();
    expect(held[0]!.tablebase).toBe(true);

    // And the other way: an evaluation that barely moved, over a move
    // that threw the win away.
    const thrown = judgeLine([{ cp: 300 }, { cp: 250 }], 'white', undefined, 0, ['win', 'draw']);
    expect(judgeNag(moverChances({ cp: 300 }, 'white') - moverChances({ cp: 250 }, 'white'))).toBeNull();
    expect(thrown[0]!.nag).toBe(4);
  });

  it('keeps measuring what it stops judging', () => {
    // The book rule's principle, applied here: withholding a verdict is
    // not the same as faking a figure, so accuracy and cp-loss stay the
    // engine's even where the NAG is the table's.
    const [move] = judgeLine([{ cp: 900 }, { cp: 300 }], 'white', undefined, 0, ['win', 'loss']);
    expect(move!.nag).toBeNull();
    expect(move!.accuracy).toBeLessThan(100);
    expect(move!.cpLoss).toBe(600);
  });

  it('judges by engine where the tables do not cover both ends', () => {
    const half = judgeLine([{ cp: 900 }, { cp: 300 }], 'white', undefined, 0, ['win', null]);
    expect(half[0]!.tablebase).toBe(false);
    expect(half[0]!.nag).toBe(4); // the engine's rule, unchanged
  });

  it('counts the covered moves per side', () => {
    // Three plies: white, black, white — the last two inside the tables.
    const verdicts = judgeLine(
      [{ cp: 10 }, { cp: 10 }, { cp: 10 }, { cp: 10 }],
      'white',
      undefined,
      0,
      [null, 'draw', 'draw', 'draw'],
    );
    expect(summarise(verdicts, 'white').tablebaseMoves).toBe(1);
    expect(summarise(verdicts, 'black').tablebaseMoves).toBe(1);
  });

  it('awards no brilliancy where the result is known', () => {
    // The same move that earns "!!" out of the tables earns nothing in
    // them: with the result settled there are no chances to offer.
    const scores: Score[] = [{ cp: 100 }, { cp: 100 }];
    expect(judgeLine(scores, 'white', [true], 0)[0]!.nag).toBe(3);
    expect(judgeLine(scores, 'white', [true], 0, ['win', 'loss'])[0]!.nag).toBeNull();
  });
});

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
