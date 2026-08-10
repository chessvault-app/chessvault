import { describe, expect, it } from 'vitest';
import {
  answerPages,
  deriveAnchors,
  scoreSettings,
  searchSettings,
  type ReadBoard,
} from './bookConfigSearch.ts';
import type { BookText, TextPage } from './bookImport.ts';

const BOOK: Omit<BookText, 'anchorStyle' | 'moveMarkers'> = {
  numberStyle: 'bare',
  maxNumber: 1001,
  solutionsAfterPage: 0,
};

const page = (n: number, text: string): TextPage => ({ page: n, width: 480, words: [], text });

/** A book of mate-in-ones, written in whichever notation the test needs. */
function tinyBook(
  write: (n: number, line: string) => string,
  count = 6,
): { pages: TextPage[]; boards: Map<number, ReadBoard> } {
  // Six back-rank mates in one, each with its own rook and its own answer.
  const mates: [string, string][] = [
    ['6k1/5ppp/8/8/8/8/8/R5K1', 'Ra8#'],
    ['7k/5ppp/8/8/8/8/8/R5K1', 'Ra8#'],
    ['6k1/5ppp/8/8/8/8/8/1R4K1', 'Rb8#'],
    ['7k/5ppp/8/8/8/8/8/1R4K1', 'Rb8#'],
    ['6k1/5ppp/8/8/8/8/8/2R3K1', 'Rc8#'],
    ['7k/5ppp/8/8/8/8/8/2R3K1', 'Rc8#'],
  ];
  const boards = new Map<number, ReadBoard>();
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const [placement, san] = mates[i % mates.length]!;
    boards.set(i + 1, { placement, page: 1 });
    lines.push(write(i + 1, san));
  }
  return { pages: [page(9, lines.join('\n'))], boards };
}

describe('scoring a set of settings', () => {
  it('counts the solutions that actually replay', () => {
    const { pages, boards } = tinyBook((n, san) => `${n}) 1.${san}`);
    const right = scoreSettings(pages, boards, BOOK, {
      anchorStyle: 'paren',
      moveMarkers: 'dotted',
      sidePrinted: false,
    });
    expect(right.entries).toBe(6);
    expect(right.validated).toBe(6);

    // The wrong anchor finds nothing to score.
    const wrong = scoreSettings(pages, boards, BOOK, {
      anchorStyle: 'dash',
      moveMarkers: 'dotted',
      sidePrinted: false,
    });
    expect(wrong.validated).toBe(0);
  });

  it('is not fooled by an anchor that finds entries it cannot replay', () => {
    // Every entry is anchored, but no position has a queen to play it.
    const { pages, boards } = tinyBook((n) => `${n}) 1.Qh8#`);
    const score = scoreSettings(pages, boards, BOOK, {
      anchorStyle: 'paren',
      moveMarkers: 'dotted',
      sidePrinted: false,
    });
    expect(score.entries).toBe(6);
    expect(score.validated).toBe(0);
  });
});

describe('searching for the settings', () => {
  it('ranks the notation the book actually uses first', () => {
    const { pages, boards } = tinyBook((n, san) => `${n}) 1.${san}`);
    const best = searchSettings(pages, boards, BOOK)[0]!;
    expect(best.validated).toBe(6);
    expect(best.anchorPattern ?? best.anchorStyle).toBe('paren');
  });

  it('finds a book whose anchor matches none of the named styles', () => {
    // "Solution 3:" is not dash, paren or dot — it has to be derived, and
    // deriving needs a run long enough not to be a coincidence.
    const { pages, boards } = tinyBook((n, san) => `Solution ${n}: 1.${san}`, 40);
    const named = searchSettings(pages, boards, BOOK).filter((s) => !s.anchorPattern);
    expect(Math.max(...named.map((s) => s.validated))).toBe(0);

    const best = searchSettings(pages, boards, BOOK)[0]!;
    expect(best.anchorPattern).toBeTruthy();
    expect(best.validated).toBe(40);
  });

  it('reports a book it cannot read instead of picking a least-bad guess', () => {
    const { boards } = tinyBook((n, san) => `${n}) 1.${san}`);
    const noAnswers = [page(9, 'a chapter of prose with no solutions in it at all')];
    expect(searchSettings(noAnswers, boards, BOOK)[0]!.validated).toBe(0);
  });
});

describe('deriving an anchor from the answers themselves', () => {
  const numbered = (write: (n: number) => string, count = 40): TextPage[] => [
    page(1, Array.from({ length: count }, (_, i) => write(i + 1)).join('\n')),
  ];

  it('picks up whatever punctuation carries the climbing number', () => {
    const [pattern] = deriveAnchors(numbered((n) => `Solution ${n}: 1.Qh5#`), 1001);
    expect(pattern).toBeTruthy();
    expect(new RegExp(pattern!).exec('Solution 7: 1.Qh5#')?.[1]).toBe('7');
  });

  it('ignores a shape whose numbers do not count upwards', () => {
    // Page furniture: the same few numbers over and over.
    expect(deriveAnchors(numbered(() => 'page 12 of 40'), 1001)).toEqual([]);
  });

  it('ignores a shape that appears only a handful of times', () => {
    expect(deriveAnchors(numbered((n) => `Solution ${n}:`, 5), 1001)).toEqual([]);
  });
});

describe('finding the answer pages', () => {
  it('groups the pages the anchor fires on into ranges', () => {
    const answers = (from: number): string =>
      [from, from + 1, from + 2].map((n) => `${n}) 1.Qh5#`).join('\n');
    const pages = [
      page(1, 'puzzles'),
      page(2, answers(1)),
      page(3, answers(4)),
      page(4, 'more puzzles'),
      page(5, answers(7)),
    ];
    const book: BookText = { ...BOOK, anchorStyle: 'paren', moveMarkers: 'dotted' };
    expect(answerPages(pages, book)).toEqual([
      [2, 3],
      [5, 5],
    ]);
  });
});
