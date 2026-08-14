import { describe, expect, it } from 'vitest';
import { classifyRefutation, nullMoveFen, summarisePlan, tagLine } from './explain.ts';

const INITIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('tagLine motifs', () => {
  it('finds a knight fork of king and rook', () => {
    // White Nd5 hops to c7: check on e8, rook hanging on a8.
    const tags = tagLine('r3k3/8/8/3N4/8/8/8/6K1 w - - 0 1', ['d5c7']);
    expect(tags.motif).toMatchObject({ type: 'fork', piece: 'knight', square: 'c7', ply: 0 });
  });

  it('finds an absolute pin', () => {
    // Bf1–b5 pins the c6 knight against the king on e8.
    const tags = tagLine('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', ['f1b5']);
    expect(tags.motif).toMatchObject({ type: 'pin', piece: 'knight', square: 'c6' });
  });

  it('finds a skewer through the king', () => {
    // Bc1–b2+: the king on g7 must step off the diagonal and the queen
    // on h8 falls.
    const tags = tagLine('7q/6k1/8/8/8/8/8/2B1K3 w - - 0 1', ['c1b2']);
    expect(tags.motif).toMatchObject({ type: 'skewer', piece: 'bishop', square: 'b2' });
  });

  it('reads a queen sacrifice into a back-rank mate as sham', () => {
    // Qxe8 Rxe8 Rxe8#: nine points invested, mate collected.
    const tags = tagLine('4rrk1/5ppp/8/4Q3/8/8/8/4R1K1 w - - 0 1', [
      'e5e8',
      'f8e8',
      'e1e8',
    ]);
    expect(tags.motif).toMatchObject({ type: 'backRankMate', piece: 'rook' });
    expect(tags.sacrifice).toMatchObject({ kind: 'sham', amount: 4 });
  });

  it('reads an exchange sacrifice with no recovery as real', () => {
    // Rxc6 bxc6 and life goes on: the exchange is not coming back.
    const tags = tagLine('6k1/pp6/2n5/8/8/8/PB6/2R3K1 w - - 0 1', [
      'c1c6',
      'b7c6',
      'b2e5',
      'a7a6',
    ]);
    expect(tags.sacrifice).toMatchObject({ kind: 'real', amount: 2 });
  });

  it('tags a promotion', () => {
    const tags = tagLine('7k/P7/8/8/8/8/8/K7 w - - 0 1', ['a7a8q']);
    expect(tags.motif).toMatchObject({ type: 'promotion', square: 'a8' });
  });

  it('stays silent on a quiet developing move', () => {
    const tags = tagLine(INITIAL, ['g1f3']);
    expect(tags.motif).toBeUndefined();
    expect(tags.sacrifice).toBeUndefined();
  });
});

describe('summarisePlan', () => {
  it('reads an outpost plant and a pawn break', () => {
    // Nc3–d5 lands on a pawn-guarded hole (Black has no c- or e-pawn),
    // then f4–f5 offers the break against g6.
    const plan = summarisePlan('6k1/8/3p2p1/8/4P3/2N5/5P2/6K1 w - - 0 1', [
      'c3d5',
      'g8h8',
      'f2f4',
      'h8g8',
      'f4f5',
      'g8h8',
    ]);
    expect(plan?.side).toBe('white');
    expect(plan?.gestures).toEqual([
      expect.objectContaining({ type: 'plant', piece: 'knight', square: 'd5' }),
      expect.objectContaining({ type: 'break', square: 'f5' }),
    ]);
  });

  it('reads a queen trade', () => {
    const plan = summarisePlan('r2q2k1/8/8/8/8/8/8/R2Q2K1 w - - 0 1', [
      'd1d8',
      'a8d8',
      'a1b1',
      'g8f8',
      'b1a1',
      'f8g8',
    ]);
    expect(plan?.gestures).toEqual([expect.objectContaining({ type: 'trade', role: 'queen' })]);
  });

  it('calls a line quiet when nothing at all happens', () => {
    const plan = summarisePlan('6kr/8/8/8/8/8/8/6KR w - - 0 1', [
      'h1h2',
      'h8h7',
      'h2h1',
      'h7h8',
      'g1f1',
      'g8f8',
    ]);
    expect(plan?.gestures).toEqual([expect.objectContaining({ type: 'quiet' })]);
  });

  it('hands combinations to the motif tagger instead', () => {
    // The queen-sac mate line is not a plan.
    const plan = summarisePlan('4rrk1/5ppp/8/4Q3/8/8/8/4R1K1 w - - 0 1', [
      'e5e8',
      'f8e8',
      'e1e8',
    ]);
    expect(plan).toBeNull();
  });

  it('returns null for a line too short to carry a plan', () => {
    expect(summarisePlan(INITIAL, ['e2e4', 'e7e5'])).toBeNull();
  });
});

describe('classifyRefutation', () => {
  it('names mate when the score says mate', () => {
    expect(classifyRefutation(INITIAL, 'f2f3', ['e7e5'], -2)).toEqual({
      kind: 'mate',
      movesUntil: 2,
    });
  });

  it('names the material a move loses', () => {
    // Qd4?? runs into Rxd4.
    const verdict = classifyRefutation('3r2k1/8/8/8/8/8/8/3Q2K1 w - - 0 1', 'd1d4', ['d8d4']);
    expect(verdict).toEqual({ kind: 'material', amount: 9 });
  });

  it('falls back to positional when nothing concrete shows', () => {
    expect(classifyRefutation(INITIAL, 'g1f3', ['g8f6'])).toEqual({ kind: 'positional' });
  });
});

describe('nullMoveFen', () => {
  it('flips the side to move and clears en passant', () => {
    const after = nullMoveFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(after).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
  });

  it('refuses when the side to move is in check', () => {
    expect(nullMoveFen('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1')).toBeNull();
  });

  it('refuses garbage', () => {
    expect(nullMoveFen('not a fen')).toBeNull();
  });
});
