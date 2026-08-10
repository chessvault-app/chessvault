/**
 * Work out a book's notation settings from the book itself.
 *
 *   npx tsx scripts/ml/search-config.ts --book scripts/ml/books/<slug>.json
 *
 * Reads the text dump and the boards the measure stage already cached, then
 * scores every candidate by the only thing that matters: how many printed
 * solutions replay legally. Prints the ranking, the answer pages it found,
 * and how the winner compares with whatever the config currently says.
 *
 * The point is that nobody has to read a few pages of a new book and guess.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../../server/paths.ts';
import type { BookText, TextPage } from '../../shared/bookImport.ts';
import { answerPages, searchSettings, type ReadBoard } from '../../shared/bookConfigSearch.ts';

const bookAt = process.argv.indexOf('--book');
if (bookAt < 0) throw new Error('usage: search-config --book scripts/ml/books/<slug>.json');
const BOOK = JSON.parse(readFileSync(process.argv[bookAt + 1]!, 'utf-8')) as BookText & {
  title: string;
  text: string;
  cache: string;
  sideMode?: string;
};

const { pages } = JSON.parse(readFileSync(resolve(REPO_ROOT, BOOK.text), 'utf-8')) as {
  pages: TextPage[];
};
const cached = JSON.parse(readFileSync(resolve(REPO_ROOT, BOOK.cache), 'utf-8')) as [
  number,
  { fen: string; page: number; sideStated?: 'w' | 'b' },
][];
const boards = new Map<number, ReadBoard>(
  cached.map(([number, read]) => [
    number,
    { placement: read.fen, page: read.page, ...(read.sideStated ? { sideStated: read.sideStated } : {}) },
  ]),
);

console.log(`${BOOK.title}: ${boards.size} boards already read, ${pages.length} pages of text\n`);

const ranked = searchSettings(pages, boards, BOOK);
console.log('  validated  entries  anchor      markers   side');
for (const s of ranked.slice(0, 8)) {
  const anchor = s.anchorPattern ? 'derived' : s.anchorStyle;
  console.log(
    `  ${String(s.validated).padStart(9)}  ${String(s.entries).padStart(7)}  ${anchor.padEnd(10)}  ${s.moveMarkers.padEnd(8)}  ${s.sidePrinted ? 'per puzzle' : 'per chapter'}`,
  );
}

const best = ranked[0]!;
if (best.anchorPattern) console.log(`\n  derived anchor: ${best.anchorPattern}`);

// What the book's config says today, for comparison.
const current = ranked.find(
  (s) =>
    !s.anchorPattern &&
    s.anchorStyle === BOOK.anchorStyle &&
    s.moveMarkers === BOOK.moveMarkers &&
    s.sidePrinted === (BOOK.sideMode === 'label' || BOOK.sideMode === 'letter'),
);
if (current) {
  const same = current === best;
  console.log(
    `\n  hand-tuned config validates ${current.validated}; search picked ${best.validated}` +
      (same ? ' — the same settings' : ' — DIFFERENT settings'),
  );
}

const found = answerPages(pages, { ...BOOK, ...best });
console.log(
  `\n  answer pages found: ${found.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}`,
);
console.log(`  config says:        ${JSON.stringify(BOOK.solutionRanges ?? BOOK.solutionsAfterPage)}`);
