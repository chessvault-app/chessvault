/**
 * Rescue the pages a scanner fed in upside down.
 *
 *   npx tsx scripts/ml/derotate.ts <pages_dir> --book scripts/ml/books/<slug>.json
 *
 * A page scanned 180° out still holds its diagrams, but its OCR'd text
 * layer is symbol soup — so the printed puzzle number above each diagram is
 * unreadable and the whole page drops out of the import. In The Ultimate
 * Chess Puzzle Book that is ten pages and eighty puzzles.
 *
 * Two things have to be fixed, and only one of them can be read:
 *
 *  - the PICTURE, which is just the page rotated back, in place, so the
 *    measure stage detects and reads the diagrams normally;
 *  - the NUMBERS, which cannot be recovered from the text layer at all.
 *    They come from arithmetic instead: the book numbers its puzzles in
 *    reading order, so a run of upside-down pages sits in a gap in the
 *    numbering, and the gap has to be exactly as wide as the run has
 *    diagrams. When it is, the assignment is forced, not guessed — and
 *    when it is not, the run is reported and left alone.
 *
 * The assignment is written as an --extra-labels file, the same hook the
 * digit reader uses, so the measure stage needs no special case.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectDiagrams } from '../../web/src/puzzles/ocr/detect';
import type { Gray } from '../../web/src/puzzles/ocr/image';
import { REPO_ROOT } from '../../server/paths.ts';

const pagesDir = process.argv[2];
const bookAt = process.argv.indexOf('--book');
if (!pagesDir || bookAt < 0) {
  throw new Error('usage: derotate <pages_dir> --book scripts/ml/books/<slug>.json');
}
const BOOK = JSON.parse(readFileSync(process.argv[bookAt + 1]!, 'utf-8')) as {
  slug: string;
  text: string;
  report: string;
  pages: [number, number];
};

interface Page {
  page: number;
  width: number;
  height: number;
  text: string;
  words: { x0: number; y0: number; x1: number; y1: number; text: string }[];
}
const textPath = resolve(REPO_ROOT, BOOK.text);
const dump = JSON.parse(readFileSync(textPath, 'utf-8')) as { pages: Page[] };

const grayPath = (page: number): string =>
  resolve(pagesDir, `page-${String(page).padStart(3, '0')}.gray`);

function loadGray(path: string): Gray | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  return { w, h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, w * h) };
}

/** 180° is the whole pixel array backwards — no resampling, no loss. */
function rotate180(gray: Gray): Gray {
  const data = new Uint8ClampedArray(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) data[i] = gray.data[gray.data.length - 1 - i]!;
  return { w: gray.w, h: gray.h, data };
}

function writeGray(path: string, gray: Gray): void {
  const out = Buffer.alloc(8 + gray.w * gray.h);
  out.writeUInt32LE(gray.w, 0);
  out.writeUInt32LE(gray.h, 4);
  Buffer.from(gray.data.buffer, gray.data.byteOffset, gray.w * gray.h).copy(out, 8);
  writeFileSync(path, out);
}

// --- which pages are upside down ----------------------------------------------

/**
 * A page of puzzles that offers no puzzle numbers has either been scanned
 * upside down or is not a page of puzzles. Ordinary English tells the two
 * apart: the prose pages that carry few numbers are full of it, and rotated
 * OCR contains none.
 */
const READABLE = /\b(the|and|white|black|can|how|move|mate|wins?|position|test)\b/i;

const isPuzzlePage = (p: Page): boolean => p.page >= BOOK.pages[0] && p.page <= BOOK.pages[1];
const numberWords = (p: Page): number =>
  p.words.filter((w) => /^\d{1,4}$/.test(w.text)).length;

const flipped: number[] = [];
const diagramsOn = new Map<number, { x: number; y: number; w: number; h: number }[]>();

for (const p of dump.pages) {
  if (!isPuzzlePage(p)) continue;
  const gray = loadGray(grayPath(p.page));
  if (!gray) continue;
  const rects = detectDiagrams(gray);
  diagramsOn.set(p.page, rects);
  if (rects.length >= 4 && numberWords(p) <= 2 && !READABLE.test(p.text)) flipped.push(p.page);
}
console.log(`upside-down pages: ${flipped.join(' ') || '(none)'}`);
if (flipped.length === 0) process.exit(0);

// --- rotate the pictures, then work out the numbers ----------------------------

/** Consecutive pages belong to one run: they share one gap in the numbering. */
const runs: number[][] = [];
for (const page of flipped) {
  const last = runs.at(-1);
  if (last && page === last.at(-1)! + 1) last.push(page);
  else runs.push([page]);
}

/** The book prints its puzzles down the left column, then down the right. */
const readingOrder = (
  rects: { x: number; y: number; w: number; h: number }[],
  width: number,
): typeof rects =>
  [...rects].sort((a, b) => {
    const column = (r: (typeof rects)[number]): number => (r.x + r.w / 2 < width / 2 ? 0 : 1);
    return column(a) - column(b) || a.y - b.y;
  });

/**
 * Puzzle numbers already MATCHED to a diagram on a page, from the measure
 * report. The raw text layer is no good for this: a page prints its own
 * page number too, and that is the one a naive minimum picks up.
 */
const report = JSON.parse(readFileSync(resolve(REPO_ROOT, BOOK.report), 'utf-8')) as
  | { entries: { number: number; page: number }[] }
  | { number: number; page: number }[];
const matched = (Array.isArray(report) ? report : report.entries) as {
  number: number;
  page: number;
}[];
const numbersOn = (page: number): number[] =>
  matched.filter((e) => e.page === page).map((e) => e.number);

const labels: { page: number; rect: { x: number; y: number; w: number; h: number }; read: number }[] = [];

for (const run of runs) {
  const rotated = new Map<number, Gray>();
  let diagrams = 0;
  for (const page of run) {
    const gray = loadGray(grayPath(page));
    if (!gray) continue;
    const turned = rotate180(gray);
    rotated.set(page, turned);
    diagrams += detectDiagrams(turned).length;
  }

  // The neighbours either side of the run bound the gap it has to fill.
  let before = 0;
  for (let page = run[0]! - 1; page >= BOOK.pages[0] && before === 0; page--) {
    if (flipped.includes(page)) continue;
    const numbers = numbersOn(page).filter((n) => n > 0);
    if (numbers.length >= 4) before = Math.max(...numbers);
  }
  let after = 0;
  for (let page = run.at(-1)! + 1; page <= BOOK.pages[1] && after === 0; page++) {
    if (flipped.includes(page)) continue;
    const numbers = numbersOn(page).filter((n) => n > 0);
    if (numbers.length >= 4) after = Math.min(...numbers);
  }
  const gap = after - before - 1;
  if (before === 0 || after === 0 || gap !== diagrams) {
    console.log(
      `  pages ${run.join(',')}: ${diagrams} diagrams but the numbering leaves ${gap} (${before}…${after}) — left alone`,
    );
    continue;
  }

  let next = before + 1;
  for (const page of run) {
    const gray = rotated.get(page)!;
    writeGray(grayPath(page), gray);
    for (const rect of readingOrder(detectDiagrams(gray), gray.w)) {
      labels.push({
        page,
        // Page fractions, which is what --extra-labels expects.
        rect: { x: rect.x / gray.w, y: rect.y / gray.h, w: rect.w / gray.w, h: rect.h / gray.h },
        read: next++,
      });
    }
  }
  console.log(`  pages ${run.join(',')}: turned over, numbered ${before + 1}–${after - 1}`);
}

const out = resolve(REPO_ROOT, 'data', 'ml', `${BOOK.slug}-extra-labels.json`);
writeFileSync(out, `${JSON.stringify(labels, null, 1)}\n`);
console.log(`\n${labels.length} recovered labels -> ${out}`);
console.log('re-run the measure with --extra-labels ' + out);
