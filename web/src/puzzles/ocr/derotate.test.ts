import { describe, expect, it } from 'vitest';
import type { Gray } from './image';
import type { TextPage } from '@shared/bookImport';
import { groupRuns, isUpsideDown, numbersForRun, readingOrder, rotate180 } from './derotate';

const page = (n: number, text: string, words: string[]): TextPage => ({
  page: n,
  width: 480,
  text,
  words: words.map((t, i) => ({ text: t, x0: 10 + i, x1: 20 + i, y0: 10, y1: 20 })),
});

describe('spotting a page that went in upside down', () => {
  it('takes a page full of diagrams with no numbers and no English', () => {
    const scrambled = page(25, 'C Q:I Q., t) H a 3', ['C', 'Q:I']);
    expect(isUpsideDown(scrambled, 8)).toBe(true);
  });

  it('leaves a prose page alone even though it has few numbers', () => {
    // Caption pages carry two numbers and plenty of words.
    const prose = page(38, 'White checkmates in three moves. How?', ['133', '134']);
    expect(isUpsideDown(prose, 6)).toBe(false);
  });

  it('leaves an ordinary puzzle page alone', () => {
    const normal = page(20, 'ELEMENTARY PUZZLES', ['49', '50', '51', '52', '53']);
    expect(isUpsideDown(normal, 8)).toBe(false);
  });

  it('needs diagrams before it will call a page anything', () => {
    expect(isUpsideDown(page(3, '  ::5', []), 0)).toBe(false);
  });
});

describe('turning the picture back over', () => {
  it('reverses the pixels, losing nothing', () => {
    const gray: Gray = { w: 2, h: 2, data: new Uint8ClampedArray([1, 2, 3, 4]) };
    expect([...rotate180(gray).data]).toEqual([4, 3, 2, 1]);
    expect([...rotate180(rotate180(gray)).data]).toEqual([1, 2, 3, 4]);
  });
});

describe('numbering the pages that were turned', () => {
  const solidGray = (w = 100, h = 100): Gray => ({ w, h, data: new Uint8ClampedArray(w * h) });

  it('groups consecutive pages into one run', () => {
    expect(groupRuns([26, 25, 78, 77, 84])).toEqual([[25, 26], [77, 78], [84]]);
  });

  it('reads a page down the left column, then the right', () => {
    const rects = [
      { x: 300, y: 10, w: 100, h: 100 },
      { x: 10, y: 200, w: 100, h: 100 },
      { x: 10, y: 10, w: 100, h: 100 },
      { x: 300, y: 200, w: 100, h: 100 },
    ];
    expect(readingOrder(rects, 480).map((r) => `${r.x},${r.y}`)).toEqual([
      '10,10',
      '10,200',
      '300,10',
      '300,200',
    ]);
  });

  it('refuses when the gap in the numbering is not the size of the run', () => {
    // One page, but the neighbours leave room for far more than it holds.
    const turned = new Map([[26, solidGray()]]);
    const neighbours = (p: number): number[] => (p === 25 ? [88, 87, 86, 85] : p === 27 ? [105, 106, 107, 108] : []);
    expect(numbersForRun([26], turned, neighbours, [13, 224])).toBeNull();
  });

  it('refuses when there is no readable page on one side', () => {
    const turned = new Map([[26, solidGray()]]);
    const neighbours = (p: number): number[] => (p === 25 ? [88, 87, 86, 85] : []);
    expect(numbersForRun([26], turned, neighbours, [13, 224])).toBeNull();
  });
});
