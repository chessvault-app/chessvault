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
    // ply 0 — the move that gave the queen, not ply 1 where the ledger
    // reads deepest (that is Black recapturing).
    expect(tags.sacrifice).toMatchObject({ kind: 'sham', amount: 4, ply: 0 });
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

  it('does not call a queen trade a skewer (found live on the opening mainline)', () => {
    // Qxd8+ Kxd8: the geometry (queen on d8, king in front of the f8
    // rook... or on the file) matches, but the queen is simply captured.
    const tags = tagLine('3qk3/8/8/8/8/8/8/3QK3 w - - 0 1', ['d1d8', 'e8d8']);
    expect(tags.motif).toBeUndefined();
  });

  it('does not call a capturable attacker a trap (found live: Nxc6 vs the d8 queen)', () => {
    // After 5.Nxc6 the queen's only flight square is covered — but
    // ...dxc6 takes the knight, and that ends the "hunt".
    const tags = tagLine(INITIAL, [
      'e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f3d4', 'g8f6', 'd4c6',
    ]);
    expect(tags.motif).toBeUndefined();
  });

  it('does not call it a fork when the forker can simply be taken (found live)', () => {
    // Nb6 "forks" the rooks on a8 and c8 — and ...cxb6 removes it. A
    // fork by a piece the opponent can capture at no cost is an offer.
    const tags = tagLine('r1r4k/2p5/8/8/N7/8/8/4K3 w - - 0 1', ['a4b6']);
    expect(tags.motif).toBeUndefined();
  });

  it('keeps the fork when the forker holds its square (found live in a vault game)', () => {
    // 10.exd5, queen-defended, hitting the c6 knight and e6 bishop at
    // once — the game ended on this move.
    const tags = tagLine('r2qkb1r/1p3ppp/p1npb3/3np3/4P3/1N2B3/PPPQ1PPP/R3KB1R w KQkq - 0 10', [
      'e4d5',
    ]);
    expect(tags.motif).toMatchObject({ type: 'fork', piece: 'pawn', square: 'd5', ply: 0 });
  });

  it('does not call a bishop pinning a bishop a pin (found live)', () => {
    // Bb5 lines the c6 bishop up with the king, but ...Bxb5 is an even
    // trade: geometry a capture dissolves at no cost is not a tactic —
    // even with the slider defended, as by the a4 pawn here.
    const tags = tagLine('4k3/8/2b5/8/P7/8/8/4KB2 w - - 0 1', ['f1b5']);
    expect(tags.motif).toBeUndefined();
  });

  it('does not call a routine defended opening pin a pin (found live: every ...Bb4 line)', () => {
    // ...Bb4 against Nc3 with b2 holding the knight: an opening, not a
    // tactic — the pin wins nothing.
    const tags = tagLine('rn1qkb1r/pp3ppp/2p1pn2/5b2/P1BP4/2N1PN2/1P3PPP/R1BQK2R b KQkq - 0 7', [
      'f8b4',
    ]);
    expect(tags.motif).toBeUndefined();
  });

  it('keeps the pin when it is winning the pinned piece', () => {
    // Bb5 pins the c6 knight, which b7 defends — but the d5 pawn attacks
    // it too, so the piece is falling, not merely held.
    const tags = tagLine('4k3/1p6/2n5/3P4/8/8/8/4KB2 w - - 0 1', ['f1b5']);
    expect(tags.motif).toMatchObject({ type: 'pin', piece: 'knight', square: 'c6' });
  });

  it('does not call an even, defended collection a skewer', () => {
    // The queen version of this position is the skewer test above; with a
    // king-defended KNIGHT behind the king instead, Bxh8 trades at best.
    const tags = tagLine('7n/6k1/8/8/8/8/8/2B1K3 w - - 0 1', ['c1b2']);
    expect(tags.motif).toBeUndefined();
  });

  it('does not call a bare discovered check a discovered attack', () => {
    // Nc1 reveals Re1+ and does nothing else with the tempo.
    const tags = tagLine('4k3/8/8/8/8/8/4N3/4R1K1 w - - 0 1', ['e2c1']);
    expect(tags.motif).toBeUndefined();
  });

  it('keeps the discovered check when the moved piece spends the tempo', () => {
    // The same Nc1, now also attacking the queen on d3.
    const tags = tagLine('4k3/8/8/8/8/3q4/4N3/4R1K1 w - - 0 1', ['e2c1']);
    expect(tags.motif).toMatchObject({ type: 'discovered', piece: 'rook', ply: 0 });
  });

  it('does not call a promotion into an immediate recapture a promotion', () => {
    // c8=Q with the d8 rook standing right there: a pawn trade on the
    // eighth, not a new queen.
    const tags = tagLine('3r3k/2P5/8/8/8/8/8/K7 w - - 0 1', ['c7c8q']);
    expect(tags.motif).toBeUndefined();
  });

  it('does not call an ordinary trade sequence a sacrifice (found live on a QGD line)', () => {
    // ...Bxc3 bxc3 dxc4 Qxc4: the balance dips while recaptures are
    // pending, but nobody sacrificed anything.
    const tags = tagLine(INITIAL, [
      'd2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'd1b3', 'b8c6',
      'e2e3', 'g8f6', 'a2a3', 'b4c3', 'b2c3', 'd5c4', 'b3c4',
    ]);
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

  it('never reads central pawn play as a storm against an uncastled king (found live)', () => {
    const plan = summarisePlan(INITIAL, [
      'e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f3d4', 'g8f6',
    ]);
    expect(plan?.gestures.some((g) => g.type === 'storm')).not.toBe(true);
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
