import { describe, expect, it } from 'vitest';
import { chessFencePgn } from './chessFence.ts';
import { mainlineEndFen, pgnToChapters } from './pgn.ts';

const ROOK_ENDING = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';

describe('chessFencePgn', () => {
  it('reads a bare FEN as a set-up position, not as junk movetext', () => {
    // The demo's "Thinking process" note: this drew the starting position
    // in the note and no board on its card.
    const pgn = chessFencePgn(ROOK_ENDING);
    expect(pgn).toBe(`[FEN "${ROOK_ENDING}"]\n[SetUp "1"]\n\n*`);
    expect(mainlineEndFen(pgn!)).toBe(ROOK_ENDING);
    const chapter = pgnToChapters(pgn!)[0]!;
    expect(chapter.headers['FEN']).toBe(ROOK_ENDING);
    expect(chapter.tree.nodes[chapter.tree.rootId]!.children).toHaveLength(0);
  });

  it('tolerates the whitespace a fence carries around its one line', () => {
    expect(chessFencePgn(`\n  ${ROOK_ENDING}  \n`)).toContain(`[FEN "${ROOK_ENDING}"]`);
  });

  it('refuses a FEN that does not parse rather than starting from the opening', () => {
    expect(chessFencePgn('6k1/5ppp/8/8/8/8/5PPP/R5K1X w - - 0 1')).toBeNull();
  });

  it('passes PGN through: bare moves, headers, a set-up position with moves', () => {
    expect(chessFencePgn('1. e4 e5 *')).toBe('1. e4 e5 *');
    const lucena = '[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n[SetUp "1"]\n\n1. Rh8+ *';
    expect(chessFencePgn(lucena)).toBe(lucena);
    expect(chessFencePgn('[Event "x"]\n\n1. d4 d5 2. c4 *')).toContain('1. d4 d5');
  });

  it('reads an empty body or a lone result as an empty board', () => {
    expect(chessFencePgn('')).toBe('*');
    expect(chessFencePgn('  \n ')).toBe('*');
    expect(chessFencePgn('*')).toBe('*');
    expect(chessFencePgn('[Result "*"]\n\n*')).toBe('[Result "*"]\n\n*');
  });

  it('refuses movetext that yields no move', () => {
    expect(chessFencePgn('hello world')).toBeNull();
    expect(chessFencePgn('1. Zz9 *')).toBeNull();
    expect(chessFencePgn('[FEN "not a fen"]\n[SetUp "1"]\n\n1. e4 *')).toBeNull();
  });
});
