import { describe, expect, it } from 'vitest';
import { pageNumbers, solutionEntries, type BookText } from '@shared/bookImport';
import { textPageFromItems, type PdfTextItem } from './pdfText';

const SIZE = { width: 480, height: 700 };

/** A pdf.js text run: x and y are PDF space, counting up from the bottom. */
const run = (str: string, x: number, yFromBottom: number, width = str.length * 6): PdfTextItem => ({
  str,
  transform: [1, 0, 0, 10, x, yFromBottom],
  width,
  height: 10,
  hasEOL: true,
});

describe('pdf.js text layer -> importer page', () => {
  it('flips the origin, so y counts down from the top like a render does', () => {
    const [word] = textPageFromItems(1, [run('49', 50, 600)], SIZE).words;
    // The run sits 600pt up from the bottom of a 700pt page, so 90pt down
    // from the top, and its box is the line's height.
    expect(word!.y0).toBeCloseTo(90, 5);
    expect(word!.y1).toBeCloseTo(100, 5);
  });

  it('splits a run into words with proportional boxes', () => {
    const page = textPageFromItems(1, [run('49 W', 50, 600, 24)], SIZE);
    expect(page.words.map((w) => w.text)).toEqual(['49', 'W']);
    const [number, side] = page.words;
    expect(number!.x0).toBeCloseTo(50, 5);
    expect(number!.x1).toBeCloseTo(62, 5);
    // "W" starts at index 3 of 4 characters across 24pt.
    expect(side!.x0).toBeCloseTo(68, 5);
  });

  it('keeps line breaks, which the answers parser anchors on', () => {
    const page = textPageFromItems(
      1,
      [run('1) 1.Qa4m', 40, 600), run('2) 1.Ba4m', 40, 580)],
      SIZE,
    );
    expect(page.text).toBe('1) 1.Qa4m\n2) 1.Ba4m\n');
  });

  it('joins a wrapped run with a space rather than gluing words together', () => {
    const items = [
      { ...run('the black', 40, 600), hasEOL: false },
      run('queen', 100, 600),
    ];
    expect(textPageFromItems(1, items, SIZE).text).toBe('the black queen\n');
  });

  it('ignores structural items that carry no text', () => {
    const items = [run('7', 50, 600), { marked: true } as unknown as PdfTextItem];
    // A caller filtering on `str`/`transform` is what extractTextPage does;
    // here the guard is that a blank run contributes no words.
    expect(textPageFromItems(1, [items[0]!, run('   ', 60, 600)], SIZE).words).toHaveLength(1);
  });
});

describe('what the importer then makes of it', () => {
  const BOOK: BookText = {
    numberStyle: 'bare',
    anchorStyle: 'paren',
    moveMarkers: 'dotless',
    maxNumber: 1001,
    solutionsAfterPage: 0,
  };

  it('finds the puzzle numbers on a page laid out like a real one', () => {
    // Two columns of four, the way The Ultimate Chess Puzzle Book prints.
    const items: PdfTextItem[] = [];
    for (const [column, x] of [[0, 50], [1, 252]] as const) {
      for (let row = 0; row < 4; row++) {
        items.push(run(String(49 + column * 4 + row), x, 600 - row * 145));
      }
    }
    const page = textPageFromItems(20, items, SIZE);
    expect(pageNumbers(page.words, BOOK).map((n) => n.value).sort((a, b) => a - b)).toEqual([
      49, 50, 51, 52, 53, 54, 55, 56,
    ]);
  });

  it('reads answers straight out of a pdf.js page', () => {
    const page = textPageFromItems(
      28,
      [run('1) 1.Qa4m', 40, 600), run('2) 1.Ba4m', 40, 580)],
      SIZE,
    );
    const entries = solutionEntries([page], BOOK);
    expect([...entries.keys()]).toEqual([1, 2]);
    expect(entries.get(1)).toContain('Qa4');
  });
});
