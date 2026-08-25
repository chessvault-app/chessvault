import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { renameRetrying, writeAtomic } from './atomic.ts';
import { isLibraryBookId, libraryBookHasPdf } from './books.ts';
import { VAULT } from './paths.ts';
import { validId } from '../shared/vaultNames.ts';
import { cycleAttempt, reviewDueAt, type CycleWindow } from '../shared/review.ts';

/**
 * Book puzzles — positions transcribed from paper books (lanph3re's v1: manual
 * board entry; OCR later). Vault data, one directory per book:
 *
 *   vault/puzzlebooks/<id>/book.json      { title, createdAt }
 *   vault/puzzlebooks/<id>/puzzles.json   [{ id, fen, uci[], san[], added }]
 *   vault/puzzlebooks/<id>/progress.json  { [id]: { tries, wins, last, at } }
 *
 * The folder is an ID — `b` and sixteen hex characters, minted once and
 * never touched again. The book's NAME lives in book.json and nowhere
 * else. This was the title for a while, which reads better in a file
 * manager and cost more than it was worth: a title is a thing people
 * change, so the folder had to move when they did, and everything holding
 * the old name — bookmarks, the URL, a half-finished scan checkpointed in
 * the browser — had to be carried across with it. An id that never moves
 * is one that nothing can be left pointing at. Browsing a book is what
 * the app is for.
 *
 * It also ends a whole class of bug for free. A folder built from a name
 * has to survive three filesystems that disagree about what a name is —
 * the characters and device names Windows forbids, the 255 BYTES Linux
 * counts where Windows counts characters, the case Windows and macOS fold
 * together, the Unicode normal form HFS+ rewrites underneath you — and
 * every one of those was a way for two different books to land in one
 * folder, or for one book to look like two. Hex is none of them.
 *
 * Unlike the lichess trainer, solutions here demand BOTH sides' moves.
 */

const BOOKS_DIR = resolve(VAULT, 'puzzlebooks');
// A book's folder name is its title, so the set has to hold the
// punctuation book titles actually use — "5334 Problems, Combinations and
// Games" was on the shelf but could not be opened, and its cover would not
// load, because of one comma. Same set as a study id (server/studies.ts):
// every character Windows forbids (\ / : * ? " < > |) stays out, the name
// must START alphanumeric, and callers reject a trailing dot, so ".." and
// hidden folders stay unreachable.
/**
 * A book's folder name.
 *
 * This was an allowlist — `[A-Za-z0-9 (),'’&+_.–—-]` — which is the same
 * mistake shared/vaultNames.ts records having made and undone for
 * studies: it rejected every Korean title outright. In Korean the shelf's
 * own New book button offers "제목 없는 책", every character of which was
 * stripped, leaving an empty slug and "that title cannot become a folder
 * name" as the answer to pressing Create. A Korean user could not make a
 * book at all.
 *
 * So the vault's own rule instead: whatever a path cannot hold is
 * refused, and everything else — Korean, accents, punctuation — is a
 * name like any other. Single segment, since a book is a folder rather
 * than a tree.
 */
const validSlug = (slug: string): boolean => !slug.includes('/') && validId(slug);

/**
 * A book's folder: `b` and eight random bytes as hex.
 *
 * Random rather than a hash of the title, because two books may be called
 * the same thing — the shelf's own New button offers one name to every
 * book it makes — and a hash would file them both in one folder, which is
 * the collision this id exists to make impossible. Eight bytes is 2^64:
 * a vault would need billions of books before two ever met.
 */
const newBookId = (): string => `b${randomBytes(8).toString('hex')}`;

/** Minted here, so a folder that was never minted here is recognisable. */
const isBookId = (name: string): boolean => /^b[0-9a-f]{16}$/.test(name);

interface BookPuzzle {
  id: string;
  fen: string;
  uci: string[];
  san: string[];
  /** Ply indices where any legal move is accepted (defender don't-cares). */
  wildcards?: number[];
  added: string;
  /** Solution origin tier; 'corrected' = entered or fixed by a human. */
  provenance?: string;
  /** The number the book prints beside this puzzle. */
  number?: number;
  /** Where in the book it came from, for the source pane. */
  evidence?: BookEvidence;
}

interface BookEvidence {
  /** Rendered page image in diagrams/, e.g. "page033.jpg". */
  page?: string;
  /** The diagram's place on that page, in page fractions. */
  rect?: { x: number; y: number; w: number; h: number };
  /** The answers page covering this puzzle's number. */
  solutionPage?: string;
  /** The whole answers section, for an entry with no number to look one
      up with — see the importer's attachAnswers. */
  solutionPages?: string[];
}

/**
 * A book's puzzles as the book prints them.
 *
 * puzzles.json is in the order things were WRITTEN, and the importer
 * writes in passes — everything it could read off the solutions page
 * first, then what the engine had to settle. So a file straight out of
 * an import runs 955, 956, ... 1001, then back to 2, 4, 10: grouped by
 * fidelity tier, not by number. Every walk over the list inherited that
 * — the trainer's next/previous, its grid sheet, and "next unsolved" —
 * so solving forward stayed inside one tier and then jumped to the top
 * of the next one.
 *
 * Sorting on the way out rather than on the way in fixes the books
 * already imported too, and costs one sort of ~1,000 ids per read.
 * Puzzles with no printed number (added by hand) keep their relative
 * order at the end, where the book page's own grid already puts them.
 */
const inPrintedOrder = <T extends { number?: number }>(puzzles: T[]): T[] =>
  [...puzzles].sort(
    (a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER),
  );

/** The tiers a solution can arrive with, in descending confidence. */
const PROVENANCE = [
  'book-parsed',
  'corrected',
  'engine-corroborated',
  'engine-only',
  'engine-unverified',
] as const;

const IMAGE_FILE = /^[A-Za-z0-9._-]{1,64}\.(jpg|jpeg|png)$/;

/** An evidence block is only kept if every part of it is well formed. */
/**
 * A crop box needs four decimals, not seventeen.
 *
 * These are fractions of a page image about 1100px wide, so the fourth
 * decimal is a tenth of a pixel — everything past it is float noise that
 * a browser has to download and parse. Across a big book it is not
 * rounding error, it is a quarter of a megabyte.
 */
function roundRect(rect: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const to4 = (n: number): number => Math.round(n * 10000) / 10000;
  return { x: to4(rect.x), y: to4(rect.y), w: to4(rect.w), h: to4(rect.h) };
}

/** How many answers pages one entry may point at. Longer chapters than
    this exist; reading 200 pages to finish one draft does not. */
const MAX_SOLUTION_PAGES = 64;

function cleanEvidence(raw: unknown): BookEvidence | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { page, rect, solutionPage, solutionPages } = raw as BookEvidence;
  const out: BookEvidence = {};
  if (typeof page === 'string' && IMAGE_FILE.test(page)) out.page = page;
  if (typeof solutionPage === 'string' && IMAGE_FILE.test(solutionPage)) {
    out.solutionPage = solutionPage;
  }
  // A whole answers section. Capped: this is a list of file names a client
  // supplies, and the only thing bounding it otherwise is how long a book's
  // answers chapter is.
  if (Array.isArray(solutionPages)) {
    const files = solutionPages.filter(
      (f): f is string => typeof f === 'string' && IMAGE_FILE.test(f),
    );
    if (files.length > 0) out.solutionPages = files.slice(0, MAX_SOLUTION_PAGES);
  }
  if (
    rect &&
    (['x', 'y', 'w', 'h'] as const).every((k) => typeof rect[k] === 'number' && rect[k] >= 0 && rect[k] <= 1)
  ) {
    out.rect = roundRect(rect);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

interface PuzzleProgress {
  tries: number;
  wins: number;
  last: 'win' | 'loss';
  at: string;
  /**
   * Every attempt in order, for the review ladder and the cycle window
   * (shared/review.ts) — the counters above cannot say how many CLEAN
   * solves have come since the last fail, which is the ladder's whole
   * input. Optional because vaults written before the schedule existed
   * carry only the counters; attemptsOf backfills those from `last`/`at`.
   */
  history?: { win: boolean; at: string }[];
}

/** How many attempts one puzzle's history keeps. The ladder reads only
    the tail since the last fail; past a hundred this is an archive of
    retries nothing reads, growing a file rewritten on every attempt. */
const HISTORY_MAX = 100;

/**
 * A progress entry's attempts as the scheduler reads them. An entry from
 * before histories existed becomes its own last attempt: a loss enters
 * rotation at the ladder's foot, a win stays retired — exactly what the
 * old solved/failed reading of it said.
 */
const attemptsOf = (entry: PuzzleProgress | undefined): { win: boolean; at: string }[] =>
  entry === undefined ? [] : (entry.history ?? [{ win: entry.last === 'win', at: entry.at }]);

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  // Atomically: puzzles.json is hundreds of hand-transcribed puzzles and
  // progress.json is rewritten on every attempt — the two files least
  // affordable to lose to a crash mid-write.
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The folder holding the book with this title, made if there is not one.
 *
 * For the offline importer under scripts/ml/, which writes into the same
 * vault as the app. It used to build a path out of the title directly,
 * which stopped being possible the moment a folder became an id — and was
 * already wrong, because it was a second answer to "where does this book
 * live" and the two would drift.
 *
 * Found by TITLE, so running a pipeline twice lands in the book it landed
 * in last time rather than making a second one beside it. Compared in one
 * normal form, since the config file and this vault may have been typed
 * on different machines.
 */
export function bookDirFor(title: string, dir: string = BOOKS_DIR): string {
  const name = title.normalize('NFC');
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const book = readJson<{ title?: string }>(resolve(dir, entry.name, 'book.json'), {});
    if (book.title?.normalize('NFC') === name) return resolve(dir, entry.name);
  }
  const made = resolve(dir, newBookId());
  mkdirSync(made, { recursive: true });
  writeJson(resolve(made, 'book.json'), { title: name, createdAt: new Date().toISOString() });
  return made;
}

export function puzzleBooksApi(dir: string = BOOKS_DIR, libraryDir?: string): Hono {
  const bookDir = (slug: string): string => resolve(dir, slug);
  /**
   * The library book holding this puzzle book's PDF, if it still does.
   * The link is a one-way pointer written when the importer files the
   * PDF; removing the library book leaves it dangling, and a dangling
   * pointer is reported as no pointer rather than as an error — the
   * puzzle book is whole without its PDF.
   */
  const linkedPdf = (book: { pdfBook?: string }): string | null =>
    typeof book.pdfBook === 'string' && libraryBookHasPdf(book.pdfBook, libraryDir)
      ? book.pdfBook
      : null;
  const puzzlesPath = (slug: string): string => resolve(bookDir(slug), 'puzzles.json');
  const progressPath = (slug: string): string => resolve(bookDir(slug), 'progress.json');
  /**
   * Woodpecker passes over this book: cycles.json holds only the WINDOWS
   * ({ startedAt, finishedAt? }), never scores — a cycle's attempts,
   * wins and next puzzle are all derived from the progress histories
   * inside the window (shared/review.ts), so there is nothing here to
   * fall out of agreement with the record. At most one cycle is open:
   * the last entry without a finishedAt.
   */
  const cyclesPath = (slug: string): string => resolve(bookDir(slug), 'cycles.json');
  const readCycles = (slug: string): CycleWindow[] => {
    const raw = readJson<{ cycles?: unknown }>(cyclesPath(slug), {});
    if (!Array.isArray(raw.cycles)) return [];
    return raw.cycles.filter((c): c is CycleWindow => {
      const { startedAt, finishedAt } = (c ?? {}) as CycleWindow;
      return (
        typeof startedAt === 'string' &&
        (finishedAt === undefined || typeof finishedAt === 'string')
      );
    });
  };
  const ocrPath = (slug: string): string => resolve(bookDir(slug), 'ocr.json');
  const draftsPath = (slug: string): string => resolve(bookDir(slug), 'drafts.json');
  const diagramsDir = (slug: string): string => resolve(bookDir(slug), 'diagrams');

  const validBook = (slug: string): boolean =>
    validSlug(slug) && existsSync(resolve(bookDir(slug), 'book.json'));

  /**
   * puzzles.json is 500-600 KB per book and was re-read + re-parsed on the
   * shelf listing AND on every attempt POST (which only needs to know an
   * id exists). Both derive from file bytes, so an mtime key is exact —
   * the same pattern as the studies chapter cache. A missing file yields
   * mtime 0, which invalidates as soon as one appears.
   */
  const mtimeOf = (path: string): number => {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return 0;
    }
  };
  const idsCache = new Map<string, { mtimeMs: number; ids: Set<string> }>();
  const puzzleIds = (slug: string): Set<string> => {
    const path = puzzlesPath(slug);
    const mtimeMs = mtimeOf(path);
    const hit = idsCache.get(slug);
    if (hit && hit.mtimeMs === mtimeMs) return hit.ids;
    const ids = new Set(readJson<BookPuzzle[]>(path, []).map((p) => p.id));
    idsCache.set(slug, { mtimeMs, ids });
    return ids;
  };
  /** `lastAt` is when this book was last SOLVED AT, not when its file
      changed: a shelf ordered by recency has to mean "what I was working
      on", and re-importing or renaming a book must not push it to the
      front of that. Null for a book nobody has attempted. */
  interface Tally {
    puzzles: number;
    solved: number;
    failed: number;
    lastAt: string | null;
    /**
     * Every in-rotation puzzle's next-due date, sorted. The DATES are
     * cached, never the count: "how many are due" changes as time passes
     * with no file touched, so the mtime key that makes this cache exact
     * for everything else would hold a stale count for ever.
     */
    dueAts: string[];
    /** The pass still running, if one is: its ordinal and first-attempt
        numbers, so the shelf can say where each book's rotation stands.
        The ordinal counts finished windows before it — untouched ones
        are pruned on every cycle write, so the count matches the page's
        own numbering for any record written since. */
    cycle: { n: number; attempted: number; wins: number } | null;
  }
  const tallyCache = new Map<
    string,
    { puzzlesMs: number; progressMs: number; cyclesMs: number; tally: Tally }
  >();
  const bookTally = (slug: string): Tally => {
    const puzzlesMs = mtimeOf(puzzlesPath(slug));
    const progressMs = mtimeOf(progressPath(slug));
    const cyclesMs = mtimeOf(cyclesPath(slug));
    const hit = tallyCache.get(slug);
    if (hit && hit.puzzlesMs === puzzlesMs && hit.progressMs === progressMs && hit.cyclesMs === cyclesMs)
      return hit.tally;
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
    const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
    const cycles = readCycles(slug);
    const open = cycles.find((cy) => cy.finishedAt === undefined) ?? null;
    let solved = 0;
    let failed = 0;
    let attempted = 0;
    let wins = 0;
    let lastAt: string | null = null;
    const dueAts: string[] = [];
    for (const p of puzzles) {
      const entry = progress[p.id];
      const last = entry?.last;
      if (last === 'win') solved++;
      else if (last === 'loss') failed++;
      // ISO-8601 in UTC throughout, so string order is time order.
      if (entry?.at && (lastAt === null || entry.at > lastAt)) lastAt = entry.at;
      const due = reviewDueAt(attemptsOf(entry));
      if (due !== null) dueAts.push(due);
      if (open) {
        const first = cycleAttempt(attemptsOf(entry), open);
        if (first !== null) {
          attempted++;
          if (first.win) wins++;
        }
      }
    }
    dueAts.sort();
    const cycle = open
      ? { n: cycles.filter((cy) => cy.finishedAt !== undefined).length + 1, attempted, wins }
      : null;
    const tally = { puzzles: puzzles.length, solved, failed, lastAt, dueAts, cycle };
    tallyCache.set(slug, { puzzlesMs, progressMs, cyclesMs, tally });
    return tally;
  };

  /** The count the shelf shows, taken at request time — see Tally.dueAts. */
  const dueCount = (tally: Tally): number => {
    const now = new Date().toISOString();
    let n = 0;
    for (const due of tally.dueAts) {
      if (due > now) break; // sorted, so the first future date ends it
      n++;
    }
    return n;
  };

  /**
   * Which books are bookmarked, as plain JSON beside them.
   *
   * The same shape and the same reasoning as the studies shelf: the vault
   * holds the answer, so a mark survives a browser, a device and a
   * reinstall. The leading dot keeps it out of the way of anyone looking
   * at the folder, and it is not a directory so it is never listed as a
   * book.
   */
  const marksPath = resolve(dir, '.bookmarks.json');
  const readMarks = (): string[] => {
    try {
      const parsed = JSON.parse(readFileSync(marksPath, 'utf-8')) as { slugs?: string[] };
      return Array.isArray(parsed.slugs) ? parsed.slugs : [];
    } catch {
      return [];
    }
  };
  const writeMarks = (slugs: string[]): void => {
    mkdirSync(dir, { recursive: true });
    writeAtomic(marksPath, `${JSON.stringify({ slugs }, null, 2)}\n`);
  };

  /**
   * One pass at startup over folders that were named before books had ids.
   *
   * Every one of them is named after a title — the title the book had at
   * the moment it was created, which for most of them is the placeholder
   * nobody chose. The name is kept: it goes into book.json first if that
   * file has no title of its own, so a folder is never renamed to an id
   * with nothing left saying what it was.
   *
   * A move, not a rewrite. Nothing inside a book is read or written, and
   * a folder that will not move is left exactly as it was and tried again
   * next time.
   */
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || isBookId(entry.name)) continue;
      const path = resolve(bookDir(entry.name), 'book.json');
      const book = readJson<{ title?: string; createdAt?: string }>(path, {});
      // The folder name IS the book's name when book.json does not say
      // otherwise, and it is about to stop being readable.
      if (!book.title) writeJson(path, { ...book, title: entry.name.normalize('NFC') });
      const id = newBookId();
      try {
        renameRetrying(bookDir(entry.name), bookDir(id));
      } catch {
        continue;
      }
      const marks = readMarks();
      if (marks.includes(entry.name)) writeMarks(marks.map((m) => (m === entry.name ? id : m)));
      console.log(`puzzlebooks: ${entry.name} -> ${id}`);
    }
  }

  const api = new Hono();

  api.get('/puzzlebooks/bookmarks', (c) => c.json({ slugs: readMarks() }));

  api.post('/puzzlebooks/bookmarks/toggle', async (c) => {
    const body = await c.req.json<{ slug?: string }>().catch(() => null);
    const slug = body?.slug?.trim();
    if (!slug || !validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const slugs = readMarks();
    const at = slugs.indexOf(slug);
    const bookmarked = at < 0;
    if (bookmarked) slugs.unshift(slug);
    else slugs.splice(at, 1);
    // Atomic, like every other vault write.
    writeMarks(slugs);
    return c.json({ slug, bookmarked });
  });


  api.get('/puzzlebooks', (c) => {
    if (!existsSync(dir)) return c.json({ books: [] });
    const books = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const slug = e.name;
        const book = readJson<{ title?: string; createdAt?: string; pdfBook?: string }>(
          resolve(bookDir(slug), 'book.json'),
          {},
        );
        const tally = bookTally(slug);
        return {
          slug,
          title: book.title ?? slug,
          createdAt: book.createdAt ?? null,
          pdfBook: linkedPdf(book),
          puzzles: tally.puzzles,
          solved: tally.solved,
          failed: tally.failed,
          due: dueCount(tally),
          cycle: tally.cycle,
          lastAt: tally.lastAt,
          // Cover scan (diagrams/cover.jpg), written by the book importer.
          cover: existsSync(resolve(diagramsDir(slug), 'cover.jpg')),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
    return c.json({ books });
  });

  api.post('/puzzlebooks', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: string };
    // NFC here as well as in the slug: a title typed on a Mac and the same
    // title typed on Windows are different strings until they are
    // normalised, and the shelf would show two books with one name.
    const title = body.title?.trim().normalize('NFC');
    if (!title) return c.json({ error: 'a book needs a title' }, 400);
    // Replace only what a path cannot hold; the title's commas, quotes
    // and Korean survive, so the book keeps the name it was given.
    // No answer here can be "that name is taken". The folder is an id
    // nothing else holds, and the title is a name like any other name —
    // which is what the shelf's New book button needed all along: it
    // offers the same placeholder to every book it makes, and used to be
    // refused by a folder it could not see.
    const slug = newBookId();
    mkdirSync(bookDir(slug), { recursive: true });
    writeJson(resolve(bookDir(slug), 'book.json'), { title, createdAt: new Date().toISOString() });
    writeJson(puzzlesPath(slug), []);
    return c.json({ slug });
  });

  /**
   * Rename a book. One write to book.json, and nothing else in the vault
   * or in any client has to hear about it: the folder is an id, the URL
   * is that id, a bookmark is that id, and a half-finished scan in the
   * browser is filed under that id. None of them are names.
   *
   * This is the whole reason the folder stopped being the title. The
   * version that renamed the directory had to carry all four across, in
   * the right order, without remounting the page under an open import
   * window — for a rename the importer fires one line before it starts a
   * nine-hundred page scan.
   */
  api.patch('/puzzlebooks/:slug', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      title?: string;
      pdfBook?: string | null;
    };
    const path = resolve(bookDir(slug), 'book.json');
    const book = readJson<{ title?: string; createdAt?: string; pdfBook?: string }>(path, {});
    // NFC: a title typed on a Mac and the same title typed on Windows are
    // different strings until they are normalised, and the shelf would
    // show two books wearing one name.
    const title = body.title === undefined ? book.title : body.title.trim().normalize('NFC');
    if (!title) return c.json({ error: 'a book needs a title' }, 400);
    // The library book holding this book's PDF (see linkedPdf). Set by the
    // importer after it files the upload; null unlinks.
    let pdfBook = book.pdfBook;
    if (body.pdfBook === null) pdfBook = undefined;
    else if (body.pdfBook !== undefined) {
      if (typeof body.pdfBook !== 'string' || !isLibraryBookId(body.pdfBook)) {
        return c.json({ error: 'not a library book' }, 400);
      }
      pdfBook = body.pdfBook;
    }
    const next: { title?: string; createdAt?: string; pdfBook?: string } = { ...book, title };
    if (pdfBook) next.pdfBook = pdfBook;
    else delete next.pdfBook;
    writeJson(path, next);
    return c.json({ slug, title, pdfBook: linkedPdf(next) });
  });

  api.delete('/puzzlebooks/:slug', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    rmSync(bookDir(slug), { recursive: true, force: true });
    // Or the mark would come back on the next book created under that name.
    const marks = readMarks();
    if (marks.includes(slug)) writeMarks(marks.filter((s) => s !== slug));
    return c.json({ ok: true });
  });

  /**
   * Empty a book without deleting it: every puzzle, every draft, and the
   * page images they cited. The book, its cover and the ATTEMPT HISTORY
   * stay.
   *
   * Progress survives on purpose. Imported puzzles are keyed `n<number>`,
   * so the same puzzle in the rebuilt book is the same id — throwing the
   * history away would punish someone for re-importing a book they have
   * been working through, which is exactly when they would want to.
   */
  api.delete('/puzzlebooks/:slug/puzzles', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []).length;
    const drafts = readJson<Draft[]>(draftsPath(slug), []).length;
    rmSync(puzzlesPath(slug), { force: true });
    rmSync(draftsPath(slug), { force: true });
    // The diagrams folder holds draft crops and evidence pages; the cover
    // is the one thing in there that does not belong to the contents.
    const dir = diagramsDir(slug);
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (file !== 'cover.jpg') rmSync(resolve(dir, file), { force: true });
      }
    }
    return c.json({ cleared: { puzzles, drafts } });
  });

  // Wipe every attempt on this book; the puzzles themselves stay put.
  // Cycles go with the attempts: a pass is nothing but a window over the
  // record being wiped, and windows over nothing would score every later
  // attempt into a cycle nobody remembers starting.
  api.delete('/puzzlebooks/:slug/progress', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    rmSync(progressPath(slug), { force: true });
    rmSync(cyclesPath(slug), { force: true });
    return c.json({ ok: true });
  });

  /** Whether any attempt has landed inside this pass's window. */
  const cycleTouched = (
    progress: Record<string, PuzzleProgress>,
    ids: Set<string>,
    cycle: CycleWindow,
  ): boolean => {
    for (const id of ids) {
      if (cycleAttempt(attemptsOf(progress[id]), cycle) !== null) return true;
    }
    return false;
  };

  /**
   * The record with the passes that never happened taken out.
   *
   * Every press of Start while a pass stood open used to CLOSE that pass,
   * so pressing it six times wrote six finished cycles of 0/0 and the
   * panel became a ledger of nothing (lanph3re's screenshot). A pass with
   * no attempt in it is not a short pass, it is no pass — so an untouched
   * window is dropped rather than archived, and the filter runs on every
   * write so records already carrying empties shed them the next time
   * anything here is pressed. An abandoned pass WITH attempts still
   * closes and stays: partial coverage is a real fact worth reading.
   */
  const withoutUntouched = (slug: string, cycles: CycleWindow[]): CycleWindow[] => {
    const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
    const ids = puzzleIds(slug);
    return cycles.filter(
      (cy) => cy.finishedAt === undefined || cycleTouched(progress, ids, cy),
    );
  };

  // Start a Woodpecker pass. A cycle already open is closed where it
  // stands if anything was attempted in it, and discarded if not.
  api.post('/puzzlebooks/:slug/cycles', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const cycles = readCycles(slug);
    const now = new Date().toISOString();
    const open = cycles.find((cy) => cy.finishedAt === undefined);
    if (open) open.finishedAt = now;
    const kept = withoutUntouched(slug, cycles);
    kept.push({ startedAt: now });
    writeJson(cyclesPath(slug), { cycles: kept });
    return c.json({ cycles: kept });
  });

  // Stop the open pass without starting another. Stopping an untouched
  // pass removes it: nothing was attempted, so there is nothing to keep.
  api.delete('/puzzlebooks/:slug/cycles', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const cycles = readCycles(slug);
    const open = cycles.find((cy) => cy.finishedAt === undefined);
    if (!open) return c.json({ error: 'no cycle running' }, 404);
    open.finishedAt = new Date().toISOString();
    const kept = withoutUntouched(slug, cycles);
    writeJson(cyclesPath(slug), { cycles: kept });
    return c.json({ cycles: kept });
  });

  api.get('/puzzlebooks/:slug', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const book = readJson<{ title?: string; pdfBook?: string }>(
      resolve(bookDir(slug), 'book.json'),
      {},
    );
    return c.json({
      slug,
      title: book.title ?? slug,
      pdfBook: linkedPdf(book),
      // What the grid needs, and nothing else. Opening a book downloads
      // every puzzle in it to draw tiles with numbers on them, so the
      // positions, solutions, evidence and timestamps are all left out —
      // on the biggest book that is 1.7 MB the phone no longer parses.
      // Solutions come from /solutions when a puzzle is opened; evidence
      // one puzzle at a time from the route below.
      puzzles: inPrintedOrder(readJson<BookPuzzle[]>(puzzlesPath(slug), [])).map((p) => ({
        id: p.id,
        ...(p.number === undefined ? {} : { number: p.number }),
        ...(p.provenance === undefined ? {} : { provenance: p.provenance }),
      })),
      progress: readJson<Record<string, PuzzleProgress>>(progressPath(slug), {}),
      // The pass windows; the client derives every cycle number from
      // these and the progress above (see dueBookPuzzles's sibling).
      cycles: readCycles(slug),
      drafts: readJson<
        { id: string; image: string; fen: string | null; added: string }[]
      >(draftsPath(slug), []),
    });
  });

  /**
   * The next puzzle in this book you have not solved, on its own.
   *
   * The hub shows it on a board, and neither existing route can serve
   * that: `/puzzlebooks/:slug` is every id and every progress entry, and
   * `/solutions` is every position in the book — 1.7 MB on the biggest
   * one, which is exactly the download those two were split up to keep
   * off the path that merely OPENS a book. A launcher wants one puzzle.
   *
   * "Next unsolved" is the book's own rule (see BookTrainer): the first
   * in printed order whose latest attempt was not a win, so a book you
   * have never touched answers with its first puzzle. A finished book
   * answers 404 and the hub simply shows no card.
   *
   * The solution is deliberately NOT included. This is a board to look
   * at and a place to go; shipping the moves would hand over the answer
   * to a puzzle nobody has attempted yet.
   */
  api.get('/puzzlebooks/:slug/next', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
    const ordered = inPrintedOrder(readJson<BookPuzzle[]>(puzzlesPath(slug), []));
    // ?mode=review: the first puzzle whose review date has come, in the
    // book's own order — a book is worked through in printed order, and
    // its reviews are too.
    if (c.req.query('mode') === 'review') {
      const now = new Date().toISOString();
      const puzzle = ordered.find((p) => {
        const due = reviewDueAt(attemptsOf(progress[p.id]));
        return due !== null && due <= now;
      });
      if (!puzzle) return c.json({ error: 'nothing due for review in this book' }, 404);
      return c.json({
        puzzle: {
          id: puzzle.id,
          fen: puzzle.fen,
          ...(puzzle.number === undefined ? {} : { number: puzzle.number }),
        },
      });
    }
    const puzzle = ordered.find((p) => progress[p.id]?.last !== 'win');
    if (!puzzle) return c.json({ error: 'nothing left unsolved in this book' }, 404);
    return c.json({
      puzzle: {
        id: puzzle.id,
        fen: puzzle.fen,
        ...(puzzle.number === undefined ? {} : { number: puzzle.number }),
      },
    });
  });

  api.post('/puzzlebooks/:slug/puzzles', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      fen?: string;
      uci?: string[];
      san?: string[];
      wildcards?: number[];
      /** Correcting an existing puzzle: swap it in place, keep its id
       *  (progress stays attached) and its book metadata. */
      replaceId?: string;
      /** An importer adding a puzzle it read out of the book itself. */
      number?: number;
      provenance?: string;
      evidence?: unknown;
    };
    if (
      typeof body.fen !== 'string' ||
      !Array.isArray(body.uci) ||
      !Array.isArray(body.san) ||
      body.uci.length === 0 ||
      body.uci.length !== body.san.length
    ) {
      return c.json({ error: 'expected { fen, uci[], san[] } with a non-empty solution' }, 400);
    }
    const wildcards = (body.wildcards ?? []).filter(
      (n) => Number.isInteger(n) && n >= 0 && n < body.uci!.length,
    );
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
    if (body.replaceId !== undefined) {
      const at = puzzles.findIndex((p) => p.id === body.replaceId);
      if (at === -1) return c.json({ error: 'unknown puzzle' }, 404);
      const previous = puzzles[at]! as BookPuzzle & Record<string, unknown>;
      const corrected = {
        ...previous, // number/evidence/etc survive the correction
        fen: body.fen,
        uci: body.uci,
        san: body.san,
        added: new Date().toISOString(),
        provenance: 'corrected',
      } as BookPuzzle;
      if (wildcards.length > 0) (corrected as { wildcards?: number[] }).wildcards = wildcards;
      else delete (corrected as { wildcards?: number[] }).wildcards;
      puzzles[at] = corrected;
      writeJson(puzzlesPath(slug), puzzles);
      return c.json({ puzzle: corrected });
    }
    // An importer says which puzzle this is, how it knows the solution and
    // where in the book it came from; a human typing one in says none of
    // that, and lands at the top of the ladder because they read it.
    const number = Number.isInteger(body.number) && body.number! > 0 ? body.number : undefined;
    const provenance = PROVENANCE.includes(body.provenance as (typeof PROVENANCE)[number])
      ? body.provenance!
      : 'corrected';
    const evidence = cleanEvidence(body.evidence);
    // Numbered puzzles keep the importer's id, so a re-import updates a
    // puzzle in place and its progress survives — the same reason the
    // pipeline writes `n<number>`.
    const id = number === undefined ? `p${Date.now().toString(36)}` : `n${number}`;
    const at = puzzles.findIndex((p) => p.id === id);
    const puzzle: BookPuzzle = {
      id,
      fen: body.fen,
      uci: body.uci,
      san: body.san,
      ...(wildcards.length > 0 ? { wildcards } : {}),
      added: new Date().toISOString(),
      provenance,
      ...(number === undefined ? {} : { number }),
      ...(evidence ? { evidence } : {}),
    };
    if (at === -1) puzzles.push(puzzle);
    else puzzles[at] = puzzle;
    writeJson(puzzlesPath(slug), puzzles);
    return c.json({ puzzle });
  });

  api.delete('/puzzlebooks/:slug/puzzles/:id', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
    const next = puzzles.filter((p) => p.id !== c.req.param('id'));
    if (next.length === puzzles.length) return c.json({ error: 'unknown puzzle' }, 404);
    writeJson(puzzlesPath(slug), next);
    const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
    delete progress[c.req.param('id')];
    writeJson(progressPath(slug), progress);
    return c.json({ ok: true });
  });

  // Diagram-OCR templates: what THIS book's printed pieces look like,
  // harvested from confirmed positions (see web/src/puzzles/ocr). Opaque
  // to the server beyond shape checks; the pixel math lives client-side.
  api.get('/puzzlebooks/:slug/ocr', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    return c.json(readJson<{ templates: unknown[] }>(ocrPath(slug), { templates: [] }));
  });

  api.put('/puzzlebooks/:slug/ocr', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { templates?: unknown };
    if (!Array.isArray(body.templates) || body.templates.length > 400) {
      return c.json({ error: 'expected { templates: [...] } (max 400)' }, 400);
    }
    const ok = body.templates.every((t) => {
      const template = t as { label?: unknown; feature?: unknown };
      return (
        typeof template.label === 'string' &&
        template.label.length <= 8 &&
        typeof template.feature === 'string' &&
        template.feature.length <= 512
      );
    });
    if (!ok) return c.json({ error: 'malformed template' }, 400);
    writeJson(ocrPath(slug), { templates: body.templates });
    return c.json({ ok: true, count: body.templates.length });
  });

  // Drafts: diagrams detected in an imported PDF, waiting for the user to
  // confirm the position and record the solution. Each keeps its cropped
  // board image so it can be eyeballed and re-read as the font improves.
  interface Draft {
    id: string;
    image: string;
    fen: string | null;
    added: string;
    /** The number printed beside it, when the import worked one out. */
    number?: number;
    /**
     * The same evidence a verified puzzle carries.
     *
     * A draft is the one a person has to finish by hand, which is done by
     * reading the page it was printed on and the page its answer is on —
     * so it needs these MORE than a solved puzzle does, not less. The
     * offline pipeline has always written them; the in-app importer sent
     * a crop and nothing else until now.
     */
    evidence?: BookEvidence;
  }

  // Book cover, written by the in-app importer straight from the PDF's first
  // page — so a book gets a shelf thumbnail with no offline render step.
  api.put('/puzzlebooks/:slug/cover', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { image?: string };
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image ?? '');
    if (!match) return c.json({ error: 'expected a jpeg/png data URL' }, 400);
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.length > 2_000_000) return c.json({ error: 'cover too large' }, 400);
    mkdirSync(diagramsDir(slug), { recursive: true });
    writeFileSync(resolve(diagramsDir(slug), 'cover.jpg'), bytes);
    return c.json({ ok: true });
  });

  api.post('/puzzlebooks/:slug/drafts', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      drafts?: {
        image?: string;
        fen?: string | null;
        number?: number;
        evidence?: unknown;
      }[];
    };
    if (!Array.isArray(body.drafts) || body.drafts.length === 0 || body.drafts.length > 500) {
      return c.json({ error: 'expected { drafts: [...] } (1..500)' }, 400);
    }
    const existing = readJson<Draft[]>(draftsPath(slug), []);
    mkdirSync(diagramsDir(slug), { recursive: true });
    const added: Draft[] = [];
    for (const [index, entry] of body.drafts.entries()) {
      const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(entry.image ?? '');
      if (!match) return c.json({ error: `draft ${index}: expected a jpeg/png data URL` }, 400);
      const bytes = Buffer.from(match[2]!, 'base64');
      if (bytes.length > 400_000) return c.json({ error: `draft ${index}: image too large` }, 400);
      const id = `d${Date.now().toString(36)}${index.toString(36)}`;
      const file = `${id}.${match[1] === 'png' ? 'png' : 'jpg'}`;
      writeFileSync(resolve(diagramsDir(slug), file), bytes);
      const evidence = cleanEvidence(entry.evidence);
      added.push({
        id,
        image: file,
        fen: typeof entry.fen === 'string' ? entry.fen : null,
        added: new Date().toISOString(),
        ...(typeof entry.number === 'number' ? { number: entry.number } : {}),
        ...(evidence ? { evidence } : {}),
      });
    }
    writeJson(draftsPath(slug), [...existing, ...added]);
    return c.json({ added: added.length });
  });

  // Bulk FEN updates after a client-side re-read of the stored diagrams.
  api.put('/puzzlebooks/:slug/drafts', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      updates?: { id?: string; fen?: string | null }[];
    };
    if (!Array.isArray(body.updates)) return c.json({ error: 'expected { updates: [...] }' }, 400);
    const drafts = readJson<Draft[]>(draftsPath(slug), []);
    for (const update of body.updates) {
      const draft = drafts.find((d) => d.id === update.id);
      if (draft) draft.fen = typeof update.fen === 'string' ? update.fen : null;
    }
    writeJson(draftsPath(slug), drafts);
    return c.json({ ok: true });
  });

  api.delete('/puzzlebooks/:slug/drafts/:id', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const drafts = readJson<Draft[]>(draftsPath(slug), []);
    const doomed = drafts.find((d) => d.id === c.req.param('id'));
    if (!doomed) return c.json({ error: 'unknown draft' }, 404);
    try {
      unlinkSync(resolve(diagramsDir(slug), doomed.image));
    } catch {
      // already gone
    }
    writeJson(
      draftsPath(slug),
      drafts.filter((d) => d.id !== doomed.id),
    );
    return c.json({ ok: true });
  });

  /**
   * Source-page images for evidence, the browser's half of what
   * scripts/ml/evidence_jpegs.py writes offline.
   *
   * Named for the page rather than given a fresh id, so a re-import
   * overwrites the page it already had instead of leaving a second copy
   * behind — the same reason numbered puzzles keep `n<number>`.
   */
  api.post('/puzzlebooks/:slug/evidence', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      pages?: { page?: number; image?: string }[];
    };
    if (!Array.isArray(body.pages) || body.pages.length === 0 || body.pages.length > 100) {
      return c.json({ error: 'expected { pages: [...] } (1..100)' }, 400);
    }
    mkdirSync(diagramsDir(slug), { recursive: true });
    const written: string[] = [];
    for (const [index, entry] of body.pages.entries()) {
      const page = entry.page;
      if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > 9999) {
        return c.json({ error: `page ${index}: expected a page number` }, 400);
      }
      const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(entry.image ?? '');
      if (!match) return c.json({ error: `page ${index}: expected a jpeg/png data URL` }, 400);
      const bytes = Buffer.from(match[2]!, 'base64');
      if (bytes.length > 1_200_000) return c.json({ error: `page ${index}: image too large` }, 400);
      const file = `page${String(page).padStart(3, '0')}.${match[1] === 'png' ? 'png' : 'jpg'}`;
      writeFileSync(resolve(diagramsDir(slug), file), bytes);
      written.push(file);
    }
    return c.json({ written });
  });

  /**
   * The positions and solutions, keyed by id.
   *
   * Split from the book itself because solving is the only thing that wants
   * them: the grid draws numbered tiles. Fetched as ONE request rather than
   * per puzzle, because stepping between puzzles has to stay instant — the
   * point is to keep it off the path that opens a book, not to trade a big
   * wait for a hundred small ones.
   */
  api.get('/puzzlebooks/:slug/solutions', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const solutions: Record<
      string,
      { fen: string; uci: string[]; san: string[]; wildcards?: number[] }
    > = {};
    for (const p of readJson<BookPuzzle[]>(puzzlesPath(slug), [])) {
      solutions[p.id] = {
        fen: p.fen,
        uci: p.uci,
        san: p.san,
        ...(p.wildcards ? { wildcards: p.wildcards } : {}),
      };
    }
    return c.json({ solutions });
  });

  /**
   * Where every position sits in the book: page number, the diagram's box
   * on that page, and the position with its side to move. For the book
   * reader, which draws a board button on each printed diagram of the
   * PDF this book was read from — the puzzles are positions it already
   * knows, so those pages need no reading. Puzzles and drafts alike; an
   * entry with no page, or a draft with no position, has nothing to
   * place and is left out. Compact by design: no moves, no images.
   */
  api.get('/puzzlebooks/:slug/placements', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const pageNo = (file: string | undefined): number | null => {
      const m = /^page(\d+)\./.exec(file ?? '');
      return m ? Number(m[1]) : null;
    };
    const placements: {
      id: string;
      page: number;
      rect?: BookEvidence['rect'];
      fen: string;
    }[] = [];
    for (const p of readJson<BookPuzzle[]>(puzzlesPath(slug), [])) {
      const page = pageNo(p.evidence?.page);
      if (page === null || !p.fen) continue;
      placements.push({ id: p.id, page, ...(p.evidence?.rect ? { rect: p.evidence.rect } : {}), fen: p.fen });
    }
    for (const d of readJson<Draft[]>(draftsPath(slug), [])) {
      const page = pageNo(d.evidence?.page);
      if (page === null || !d.fen) continue;
      placements.push({ id: d.id, page, ...(d.evidence?.rect ? { rect: d.evidence.rect } : {}), fen: d.fen });
    }
    return c.json({ placements });
  });

  /**
   * One puzzle's evidence: the page it was printed on, where on that page
   * it sits, and the page its answer is on.
   *
   * Fetched when a puzzle is actually opened rather than shipped with the
   * whole book, because it is the heaviest thing a book carries and the
   * lightest thing to ask for.
   */
  api.get('/puzzlebooks/:slug/puzzles/:id/evidence', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const puzzle = readJson<BookPuzzle[]>(puzzlesPath(slug), []).find(
      (p) => p.id === c.req.param('id'),
    );
    if (!puzzle) return c.json({ error: 'unknown puzzle' }, 404);
    const evidence = puzzle.evidence;
    return c.json({
      evidence: evidence?.rect ? { ...evidence, rect: roundRect(evidence.rect) } : evidence,
    });
  });

  api.get('/puzzlebooks/:slug/diagrams/:file', (c) => {
    const slug = c.req.param('slug');
    const file = c.req.param('file');
    if (!validBook(slug) || !/^[A-Za-z0-9]+\.(jpg|png)$/.test(file)) {
      return c.json({ error: 'unknown diagram' }, 404);
    }
    const path = resolve(diagramsDir(slug), file);
    if (!existsSync(path)) return c.json({ error: 'unknown diagram' }, 404);
    // Diagram/evidence files are content-addressed (draft ids, page numbers),
    // so cache them hard — this was `no-store`, which re-fetched every
    // thumbnail on every view. cover.jpg can change on re-import, so it gets
    // a short TTL instead of immutable.
    const cache =
      file === 'cover.jpg'
        ? 'private, max-age=3600'
        : 'private, max-age=31536000, immutable';
    return c.body(new Uint8Array(readFileSync(path)), 200, {
      'content-type': file.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'cache-control': cache,
    });
  });

  api.post('/puzzlebooks/:slug/attempt', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { id?: string; win?: boolean };
    if (typeof body.id !== 'string' || typeof body.win !== 'boolean') {
      return c.json({ error: 'expected { id, win }' }, 400);
    }
    if (!puzzleIds(slug).has(body.id)) return c.json({ error: 'unknown puzzle' }, 404);
    const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
    const prev = progress[body.id];
    const at = new Date().toISOString();
    progress[body.id] = {
      tries: (prev?.tries ?? 0) + 1,
      wins: (prev?.wins ?? 0) + (body.win ? 1 : 0),
      last: body.win ? 'win' : 'loss',
      at,
      // The full record, for the ladder and the cycle window. An entry
      // from before histories existed contributes its backfilled last
      // attempt first, so nothing it had earned is forgotten.
      history: [...attemptsOf(prev), { win: body.win, at }].slice(-HISTORY_MAX),
    };
    writeJson(progressPath(slug), progress);
    // A pass finishes itself: when this attempt was the last puzzle the
    // open cycle had not reached, the window closes at this moment — the
    // client never has to say "I think the cycle is over", and the
    // updated windows ride back with the attempt so its cache agrees.
    const cycles = readCycles(slug);
    const open = cycles.find((cy) => cy.finishedAt === undefined);
    if (open) {
      let complete = true;
      for (const id of puzzleIds(slug)) {
        if (cycleAttempt(attemptsOf(progress[id]), open) === null) {
          complete = false;
          break;
        }
      }
      if (complete) {
        open.finishedAt = at;
        writeJson(cyclesPath(slug), { cycles });
      }
    }
    return c.json({
      progress: progress[body.id],
      ...(cycles.length > 0 ? { cycles } : {}),
    });
  });

  return api;
}
