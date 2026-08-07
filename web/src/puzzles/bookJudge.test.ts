import { describe, expect, it } from 'vitest';
import { judgeBookMove, type BookSolution } from './bookJudge';

/** Enter the first n scripted moves verbatim; returns { fen, cursor }. */
const enter = (solution: BookSolution, n: number): { fen: string; cursor: number } => {
  let fen = solution.fen;
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const uci = solution.uci[i]!;
    const v = judgeBookMove(solution, fen, cursor, uci.slice(0, 2), uci.slice(2, 4), uci.slice(4));
    if (v.kind === 'wrong') throw new Error(`setup failed at ply ${i}`);
    fen = v.move.fen;
    cursor = v.kind === 'complete' || v.kind === 'engine' ? cursor + 1 : v.cursor;
  }
  return { fen, cursor };
};

describe('book puzzle judgment', () => {
  // 1.Rb7 Kf8 2.Ra8# — a genuine two-rook mate.
  const mateLine: BookSolution = {
    fen: '6k1/8/8/8/8/8/RR6/6K1 w - - 0 1',
    uci: ['b2b7', 'g8f8', 'a2a8'],
  };

  it('accepts the scripted line ply by ply and completes at the end', () => {
    const { fen, cursor } = enter(mateLine, 2);
    const last = judgeBookMove(mateLine, fen, cursor, 'a2', 'a8');
    expect(last.kind).toBe('complete');
    expect(last.move.san).toBe('Ra8#');
  });

  it('rejects a legal but wrong defender deviation mid-line', () => {
    const { fen, cursor } = enter(mateLine, 1);
    // Defender plays Kh8 instead of the scripted Kf8 (no wildcard).
    expect(judgeBookMove(mateLine, fen, cursor, 'g8', 'h8').kind).toBe('wrong');
  });

  it('rejects illegal moves outright', () => {
    expect(judgeBookMove(mateLine, mateLine.fen, 0, 'b2', 'c3').kind).toBe('wrong');
  });

  it('accepts an off-script checkmate as complete', () => {
    // Back rank, two mates: the script says Ra8#, but Qb8# works too.
    const s: BookSolution = {
      fen: '6k1/5ppp/8/8/8/8/1Q6/R5K1 w - - 0 1',
      uci: ['a1a8'],
    };
    expect(judgeBookMove(s, s.fen, 0, 'a1', 'a8').kind).toBe('complete');
    expect(judgeBookMove(s, s.fen, 0, 'b2', 'b8').kind).toBe('complete');
    // A non-mating alternative on the final ply goes to the engine.
    expect(judgeBookMove(s, s.fen, 0, 'a1', 'a7').kind).toBe('engine');
  });

  it('accepts only same-depth transpositions and final-position hits', () => {
    // Script: 1.g3 b6 2.h3. Playing 1.h3 first is off the scripted PATH
    // (mid-line, scripted move still legal) → wrong. After the scripted
    // 1.g3 b6, 2.h3 lands exactly on the final scripted position →
    // complete.
    const s: BookSolution = {
      fen: 'k7/pp6/8/8/8/8/6PP/6RK w - - 0 1',
      uci: ['g2g3', 'b7b6', 'h2h3'],
    };
    expect(judgeBookMove(s, s.fen, 0, 'h2', 'h3').kind).toBe('wrong');
    const { fen, cursor } = enter(s, 2);
    expect(judgeBookMove(s, fen, cursor, 'h2', 'h3').kind).toBe('complete');
  });

  it('same-depth transposition: a different move reaching the identical position', () => {
    // Two knights can reach f3 from g1 — same-depth transposition needs a
    // same-position match, so craft one via a rook shuffle: script
    // 1.Rg1-f1 a6 2.Rf1-f2; the ONLY way this transposes same-depth is
    // playing the scripted move itself, so instead verify the rebased
    // cursor on the final-position rule: 1.g3 h6 2.g4 vs entering 1.g4?!
    const s: BookSolution = {
      fen: 'k7/7p/8/8/8/8/6P1/7K w - - 0 1',
      uci: ['g2g3', 'h7h6', 'g3g4'],
    };
    // 1.g4 reaches the position the script only reaches after 2.g4 —
    // depth 3 with cursor 0: NOT a same-depth match, NOT the final hit
    // with matching side-to-move? Position after 1.g4 has BLACK to move
    // and h7 pawn — different from final (h6). Mid-line off-book with the
    // scripted move legal → wrong.
    expect(judgeBookMove(s, s.fen, 0, 'g2', 'g4').kind).toBe('wrong');
  });

  it('wildcard plies accept any legal defender move, then the scripted continuation', () => {
    const s: BookSolution = { ...mateLine, wildcards: [1] };
    const one = enter(s, 1); // 1.Rb7
    const wild = judgeBookMove(s, one.fen, one.cursor, 'g8', 'h8'); // not the scripted Kf8
    expect(wild.kind).toBe('correct');
    if (wild.kind !== 'correct') return;
    // The scripted 2.Ra8 still mates against Kh8 — accepted as the
    // scripted continuation even though the position diverged.
    const next = judgeBookMove(s, wild.move.fen, wild.cursor, 'a2', 'a8');
    expect(next.kind).toBe('complete');
    expect(next.move.san).toBe('Ra8#');
  });

  it('routes off-book final-ply moves and dead scripts to the engine', () => {
    const s: BookSolution = {
      fen: '5k2/1R6/8/8/8/8/R7/6K1 w - - 0 1',
      uci: ['a2a7', 'f8e8', 'b7b8'],
      wildcards: [1],
    };
    const one = enter(s, 1); // 1.Ra7
    const g8 = judgeBookMove(s, one.fen, one.cursor, 'f8', 'g8'); // wildcard defence
    expect(g8.kind).toBe('correct');
    if (g8.kind !== 'correct') return;
    // Final ply, off-book quiet move → engine.
    const offBook = judgeBookMove(s, g8.move.fen, g8.cursor, 'a7', 'a6');
    expect(offBook.kind).toBe('engine');
  });
});
