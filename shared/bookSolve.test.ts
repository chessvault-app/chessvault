import { describe, expect, it } from 'vitest';
import { solveBook } from './bookSolve.ts';
import type { ReadBoard } from './bookConfigSearch.ts';
import type { BookText, TextPage } from './bookImport.ts';

const BOOK: Omit<BookText, 'anchorStyle' | 'moveMarkers'> = {
  numberStyle: 'bare',
  maxNumber: 1001,
  solutionsAfterPage: 0,
};

const page = (n: number, text: string): TextPage => ({ page: n, width: 480, words: [], text });

/** Back-rank mates in one: a board, and the move that finishes it. */
const MATES: [string, string][] = [
  ['6k1/5ppp/8/8/8/8/8/R5K1', 'Ra8#'],
  ['7k/5ppp/8/8/8/8/8/R5K1', 'Ra8#'],
  ['6k1/5ppp/8/8/8/8/8/1R4K1', 'Rb8#'],
  ['7k/5ppp/8/8/8/8/8/1R4K1', 'Rb8#'],
  ['6k1/5ppp/8/8/8/8/8/2R3K1', 'Rc8#'],
  ['7k/5ppp/8/8/8/8/8/2R3K1', 'Rc8#'],
];

function book(count: number, write: (n: number, san: string) => string) {
  const boards = new Map<number, ReadBoard>();
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const [placement, san] = MATES[i % MATES.length]!;
    boards.set(i + 1, { placement, page: 3 });
    lines.push(write(i + 1, san));
  }
  return { boards, pages: [page(1, 'puzzles'), page(9, lines.join('\n'))] };
}

describe('turning read boards into verified puzzles', () => {
  it('writes a full FEN, a matching UCI line, and the book tier', () => {
    const { pages, boards } = book(30, (n, san) => `${n}) 1.${san}`);
    const out = solveBook(pages, boards, BOOK);
    expect(out.confident).toBe(true);
    expect(out.puzzles).toHaveLength(30);
    expect(out.unresolved).toEqual([]);

    const first = out.puzzles[0]!;
    expect(first.number).toBe(1);
    expect(first.fen).toBe('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    expect(first.san).toEqual(['Ra8#']);
    expect(first.uci).toEqual(['a1a8']);
    expect(first.provenance).toBe('book-parsed');
  });

  it('reports which boards it could not solve instead of dropping them', () => {
    const { pages, boards } = book(30, (n, san) => (n === 5 ? `${n}) 1.Qh8#` : `${n}) 1.${san}`));
    const out = solveBook(pages, boards, BOOK);
    expect(out.puzzles.map((p) => p.number)).not.toContain(5);
    expect(out.unresolved).toContain(5);
    expect(out.puzzles.length + out.unresolved.length).toBe(30);
  });

  it('works out the notation and where the answers are, unaided', () => {
    const { pages, boards } = book(30, (n, san) => `${n}) 1.${san}`);
    const out = solveBook(pages, boards, BOOK);
    expect(out.settings.anchorStyle).toBe('paren');
    expect(out.answerRanges).toEqual([[9, 9]]);
  });

  it('says so when it could not read the book, rather than half-importing it', () => {
    const { boards } = book(30, (n, san) => `${n}) 1.${san}`);
    const prose = [page(1, 'a chapter of prose, with no answers anywhere in it')];
    const out = solveBook(prose, boards, BOOK);
    expect(out.confident).toBe(false);
    expect(out.puzzles).toEqual([]);
    // The positions are still known — they are what a draft would carry.
    expect(out.unresolved).toHaveLength(30);
  });

  it('is not confident on a handful of lucky hits in a big book', () => {
    // 200 boards, five of which have an answer: read, but not read enough.
    const { boards } = book(200, (n, san) => `${n}) 1.${san}`);
    const few = [page(9, [1, 2, 3, 4, 5].map((n) => `${n}) 1.${MATES[(n - 1) % 6]![1]}`).join('\n'))];
    const out = solveBook(few, boards, BOOK);
    expect(out.puzzles.length).toBeLessThan(10);
    expect(out.confident).toBe(false);
  });

  it('reads a book whose anchor matches no named style', () => {
    const { pages, boards } = book(30, (n, san) => `Solution ${n}: 1.${san}`);
    const out = solveBook(pages, boards, BOOK);
    expect(out.settings.anchorPattern).toBeTruthy();
    expect(out.puzzles).toHaveLength(30);
    expect(out.confident).toBe(true);
  });
});
