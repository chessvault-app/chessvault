/**
 * Rescue the pages a scanner fed in upside down — the offline path.
 *
 * The thinking lives in web/src/puzzles/ocr/derotate.ts so the app runs it
 * too; this is the file I/O around it, for the pipeline that works from
 * pre-rendered page dumps.
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
import {
  groupRuns,
  isUpsideDown,
  numbersForRun,
  rotate180,
} from '../../web/src/puzzles/ocr/derotate.ts';
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

function writeGray(path: string, gray: Gray): void {
  const out = Buffer.alloc(8 + gray.w * gray.h);
  out.writeUInt32LE(gray.w, 0);
  out.writeUInt32LE(gray.h, 4);
  Buffer.from(gray.data.buffer, gray.data.byteOffset, gray.w * gray.h).copy(out, 8);
  writeFileSync(path, out);
}

// --- find them, turn them over, number them ------------------------------------

/**
 * Pages a previous run already turned.
 *
 * Upside-down-ness is read from the TEXT layer, which never changes, while
 * the fix is written to the PIXELS — so without a record of what has been
 * done, running this twice turns the same pages back over. The labels file
 * is that record.
 */
const outPath = resolve(REPO_ROOT, 'data', 'ml', `${BOOK.slug}-extra-labels.json`);
const done = new Map<number, { page: number; rect: { x: number; y: number; w: number; h: number }; read: number }[]>();
if (existsSync(outPath)) {
  for (const label of JSON.parse(readFileSync(outPath, 'utf-8')) as {
    page: number;
    rect: { x: number; y: number; w: number; h: number };
    read: number;
  }[]) {
    done.set(label.page, [...(done.get(label.page) ?? []), label]);
  }
}

const flipped: number[] = [];
for (const p of dump.pages) {
  if (p.page < BOOK.pages[0] || p.page > BOOK.pages[1]) continue;
  const gray = loadGray(grayPath(p.page));
  if (!gray) continue;
  if (isUpsideDown(p, detectDiagrams(gray).length)) flipped.push(p.page);
}
const alreadyTurned = flipped.filter((page) => done.has(page));
if (alreadyTurned.length > 0) {
  console.log(`already turned, leaving alone: ${alreadyTurned.join(' ')}`);
}
console.log(`upside-down pages: ${flipped.join(' ') || '(none)'}`);
if (flipped.length === 0) process.exit(0);

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
for (const run of groupRuns(flipped.filter((page) => !done.has(page)))) {
  const turned = new Map<number, Gray>();
  for (const page of run) {
    const gray = loadGray(grayPath(page));
    if (gray) turned.set(page, rotate180(gray));
  }
  const recovered = numbersForRun(run, turned, numbersOn, BOOK.pages);
  if (!recovered) {
    console.log(`  pages ${run.join(',')}: the numbering does not force an answer — left alone`);
    continue;
  }
  for (const [page, gray] of turned) writeGray(grayPath(page), gray);
  for (const label of recovered) labels.push({ page: label.page, rect: label.rect, read: label.number });
  console.log(
    `  pages ${run.join(',')}: turned over, numbered ${recovered[0]!.number}–${recovered.at(-1)!.number}`,
  );
}

// Keep what earlier runs recovered; a page is turned once and only once.
const all = [...[...done.values()].flat(), ...labels].sort(
  (a, b) => a.page - b.page || a.read - b.read,
);
writeFileSync(outPath, `${JSON.stringify(all, null, 1)}
`);
console.log(`
${all.length} recovered labels (${labels.length} new) -> ${outPath}`);
