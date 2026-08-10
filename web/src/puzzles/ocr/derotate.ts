import { detectDiagrams } from './detect';
import type { Gray } from './image';
import type { NumberBox, TextPage } from '@shared/bookImport';

/**
 * Pages a scanner fed in upside down.
 *
 * The diagrams are all still there, but the OCR of a rotated page is symbol
 * soup, so the printed number above each diagram is unreadable and every
 * puzzle on it drops out of the import. In one book that was ten pages and
 * eighty puzzles.
 *
 * Two things have to be fixed and only one of them can be read:
 *
 *  - the PICTURE, which is just the page turned back — 180° is the pixel
 *    array reversed, no resampling and no loss;
 *  - the NUMBERS, which cannot be recovered from the text layer at all.
 *    They come from arithmetic instead: a book numbers its puzzles in
 *    reading order, so a run of upside-down pages sits in a gap in the
 *    numbering, and the gap has to be exactly as wide as the run has
 *    diagrams. When it is, the assignment is forced rather than guessed;
 *    when it is not, the run is left alone.
 */

/**
 * A page of puzzles that offers no puzzle numbers has either been scanned
 * upside down or is not a page of puzzles. Ordinary English tells the two
 * apart: prose pages that carry few numbers are full of it, and rotated OCR
 * contains none.
 */
const READABLE = /\b(the|and|white|black|can|how|move|mate|wins?|position|test)\b/i;

export function isUpsideDown(page: TextPage, diagrams: number): boolean {
  if (diagrams < 4) return false;
  const numbers = page.words.filter((w) => /^\d{1,4}$/.test(w.text)).length;
  return numbers <= 2 && !READABLE.test(page.text);
}

/** 180° is the whole pixel array backwards. */
export function rotate180(gray: Gray): Gray {
  const data = new Uint8ClampedArray(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) data[i] = gray.data[gray.data.length - 1 - i]!;
  return { w: gray.w, h: gray.h, data };
}

/** The book prints its puzzles down the left column, then down the right. */
export function readingOrder<T extends { x: number; y: number; w: number }>(
  rects: T[],
  width: number,
): T[] {
  const column = (r: T): number => (r.x + r.w / 2 < width / 2 ? 0 : 1);
  return [...rects].sort((a, b) => column(a) - column(b) || a.y - b.y);
}

/** Consecutive pages belong to one run: they share one gap in the numbering. */
export function groupRuns(pages: number[]): number[][] {
  const runs: number[][] = [];
  for (const page of [...pages].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && page === last.at(-1)! + 1) last.push(page);
    else runs.push([page]);
  }
  return runs;
}

export interface RecoveredLabel {
  page: number;
  /** The diagram's place on the page, in page fractions. */
  rect: { x: number; y: number; w: number; h: number };
  number: number;
}

/**
 * Numbers for one run of upside-down pages, or null when the numbering does
 * not force them. `neighbours` gives the numbers already matched on each
 * readable page, which is the only trustworthy source: a page prints its
 * own page number too, and that is what a naive minimum picks up.
 */
export function numbersForRun(
  run: number[],
  turned: Map<number, Gray>,
  neighbours: (page: number) => number[],
  bounds: [number, number],
): RecoveredLabel[] | null {
  const perPage = run.map((page) => {
    const gray = turned.get(page)!;
    return { page, gray, rects: readingOrder(detectDiagrams(gray), gray.w) };
  });
  const diagrams = perPage.reduce((sum, p) => sum + p.rects.length, 0);

  let before = 0;
  for (let page = run[0]! - 1; page >= bounds[0] && before === 0; page--) {
    if (run.includes(page)) continue;
    const numbers = neighbours(page);
    if (numbers.length >= 4) before = Math.max(...numbers);
  }
  let after = 0;
  for (let page = run.at(-1)! + 1; page <= bounds[1] && after === 0; page++) {
    if (run.includes(page)) continue;
    const numbers = neighbours(page);
    if (numbers.length >= 4) after = Math.min(...numbers);
  }
  if (before === 0 || after === 0 || after - before - 1 !== diagrams) return null;

  let next = before + 1;
  const out: RecoveredLabel[] = [];
  for (const { page, gray, rects } of perPage) {
    for (const rect of rects) {
      out.push({
        page,
        rect: { x: rect.x / gray.w, y: rect.y / gray.h, w: rect.w / gray.w, h: rect.h / gray.h },
        number: next++,
      });
    }
  }
  return out;
}

/** A recovered label, as the number box the label matcher expects. */
export function asNumberBox(label: RecoveredLabel, page: { width: number; height: number }): NumberBox {
  const x0 = label.rect.x * page.width;
  return {
    value: label.number,
    x0,
    x1: x0 + 0.03 * page.width,
    y1: label.rect.y * page.height - 2,
  };
}
