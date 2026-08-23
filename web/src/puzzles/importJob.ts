import { create } from 'zustand';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import {
  answerPageIndex,
  assignLabels,
  deriveNumbering,
  isMoveish,
  pageMateGoal,
  tokenPrefix,
  letterSides,
  pageNumbers,
  type BookText,
  type LabelledDiagram,
  type PageLayout,
  type TextPage,
} from '@shared/bookImport';
import { solveBook, type SolveResult, type VerifiedPuzzle } from '@shared/bookSolve';
import { engineTier, type EnginePuzzle } from '@shared/bookEngine';
import { ENGINE_POOL_SIZE, releaseBookEngine, searchPosition } from '@/engine/bookSearch';
import { repairBoard } from '@shared/bookRepair';
import { learnGlyphHints, readGlyph, type GlyphSample } from '@shared/bookGlyphs';
import { answerPages, type ReadBoard } from '@shared/bookConfigSearch';
import type { Template } from './ocr/classify';
import { saveDiagrams, type PageDiagramRecord } from '@/books/data';
import {
  classifyDetailInWorker,
  classifyInWorker,
  leasePool,
  POOL_SIZE,
  yieldToUi,
  type DetailedReading,
} from './ocr/cellnetPool';
import { labelsToFen } from './ocr/classify';
import { grayFromCanvas, cropDiagram } from './ocr/browser';
import {
  loadPdfjs,
  PDF_OPTIONS,
  RENDER_WIDTH,
  readDiagramsOnPage,
  renderPdfPage,
  type Rect,
} from './ocr/pdfPage';
import { extractTextPage } from './ocr/pdfText';
// Type-only: this file already loads pdf.js at runtime, and the repair
// pass re-renders pages, so it needs the real document type.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Role } from 'chessops/types';
import {
  clearCheckpoint,
  fingerprintOf,
  readCheckpoint,
  savePage,
  type ImportCheckpoint,
} from './importCheckpoint';

export interface FoundDiagram {
  page: number;
  /**
   * Where it sat on its page, in page fractions.
   *
   * Kept so a DRAFT can carry the same evidence a verified puzzle does.
   * Correcting a draft by hand means reading the printed page — the crop
   * alone shows a board with no number beside it and no answer anywhere.
   */
  rect?: { x: number; y: number; w: number; h: number };
  dataUrl: string;
  fen: string | null;
  uncertain: number;
  selected: boolean;
  /** The number printed on it, once the labelling stage has run. */
  number?: number;
  /** True once its printed solution has been replayed successfully. */
  solved?: boolean;
  /** The answers page covering this diagram's number, once known. */
  solutionPage?: string;
  /**
   * The whole answers section, for a diagram with no number to look one up
   * with. Most of what stays a draft is exactly that — a diagram whose
   * printed number the scan could not read — and finishing one by hand
   * means reading the answers, so a section it can point at honestly beats
   * a page it cannot name.
   */
  solutionPages?: string[];
}

/** Choices the user made before the import started. */
export interface ImportOptions {
  /**
   * Re-read the boards whose printed solution would not replay, looking
   * for a misread square. Off by default: measured on 1001 Chess
   * Exercises it recovered 26 puzzles out of 242 failures, and it still
   * adds to an import that is already long, so it is worth offering and
   * not worth imposing.
   */
  repair?: boolean;
  /**
   * Ask the engine about the boards whose printed solution would not
   * replay. On by default: without it an import of a book whose answers
   * scanned badly is puzzles-with-solutions plus a pile of drafts, which
   * is the whole reason the offline pipeline grew these tiers.
   */
  engine?: boolean;
  /**
   * The library book this PDF is filed as (books/data.ts), when it is
   * known at the start: every page's diagrams go to it as they are read,
   * so the reader has them with no second pass over the same file. A
   * book filed during the scan arrives through `fileDiagramsIn`.
   */
  libraryBook?: string | null;
}

/** What the solve stage concluded, for the dialog to show. */
export interface SolveSummary {
  solved: number;
  /** Of those, the ones a misread square had to be fixed on first. */
  repaired: number;
  unresolved: number;
  /** Solved, but the server refused the save — left selected as drafts. */
  saveFailed: number;
  /**
   * What the engine settled, of the boards the book's own answers could
   * not. Absent when the engine pass was switched off.
   */
  engine?: { corroborated: number; only: number; unverified: number };
  confident: boolean;
  /** How the book turned out to write its answers — worked out, not set. */
  settings: SolveResult['settings'];
  answerRanges: [number, number][];
}

interface ImportJobState {
  /** Book the scan belongs to; null = idle. */
  slug: string | null;
  /**
   * `paused` is a scan stopped on purpose. The loop checks this between
   * pages and simply returns; the checkpoint written after the last
   * finished page is what carries on from, so pausing and being
   * interrupted are the same thing to everything downstream.
   */
  status: 'idle' | 'scanning' | 'paused' | 'reading' | 'done' | 'failed';
  page: number;
  pages: number;
  found: FoundDiagram[];
  /** Null until the text half has run; null after it finds nothing. */
  solve: SolveSummary | null;
  /** How far the engine pass has got, while it is running. */
  engineAt: { done: number; total: number } | null;
  error: string | null;
  start: (slug: string, file: File, templates: Template[], options?: ImportOptions) => void;
  /** Continue a scan a reload, a crash, or a pause interrupted. */
  resume: (slug: string, templates: Template[], options?: ImportOptions) => void;
  /**
   * The library book this scan's PDF was just filed as: the pages read
   * so far go to it now, and every page after as it is read. The read
   * is one and the same — the importer's per-page pass IS the reader's
   * diagram job (ocr/pdfPage.ts) — so it is done once, here.
   */
  fileDiagramsIn: (libraryBook: string) => void;
  /** Where this scan's diagrams are being filed, or null. */
  libraryBook: string | null;
  /** Stop after the page being read, keeping the checkpoint. */
  pause: () => void;
  /** Give up on a book's scan entirely — the book itself is going away. */
  abandon: (slug: string) => void;
  toggle: (index: number) => void;
  clear: () => void;
}

/**
 * Open the document and drop it again: the "is this a PDF we can read at
 * all" probe. The rebuild path clears a book's puzzles before importing
 * the replacement, and used to do so on nothing but the file picker's
 * word — an unreadable file emptied the book and imported nothing.
 */
export async function canReadPdf(file: File): Promise<boolean> {
  return (await pdfPageCount(file)) > 0;
}

/** How many pages the file has, or 0 when it does not open as a PDF. */
export async function pdfPageCount(file: File): Promise<number> {
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: await file.arrayBuffer(), ...PDF_OPTIONS });
    const pages = (await task.promise).numPages;
    await task.destroy();
    return pages;
  } catch {
    return 0;
  }
}

/**
 * A whole-book scan as a BACKGROUND JOB: close the dialog, browse other
 * pages, come back — the scan keeps going and the book page shows its
 * progress. Classification runs in a worker, page rendering yields to the
 * event loop between pages, so the app stays responsive throughout.
 */
/**
 * A scan lives in this tab and nowhere else.
 *
 * The pages are rendered by pdf.js here and the boards are classified by
 * a worker here; nothing on the server knows a scan is running. It is no
 * longer true that a reload throws the work away — every page writes a
 * checkpoint, so a reload costs the page in flight and a click to carry
 * on — but "costs a click and lands you on a book that looks abandoned"
 * is still worth a question, and leaving mid-scan is nearly always a
 * misclick rather than a decision.
 *
 * The listener is attached to the JOB rather than to the window that
 * started it, because the window can be closed while the scan runs on
 * (which the window itself offers). A scan stopped on purpose asks
 * nothing: `paused` is not running, so this detaches.
 */
let unloadGuarded = false;
const warnOnUnload = (e: BeforeUnloadEvent): void => e.preventDefault();

export const useImportJob = create<ImportJobState>((set, get) => ({
  slug: null,
  status: 'idle',
  page: 0,
  pages: 0,
  found: [],
  solve: null,
  engineAt: null,
  error: null,

  // 'reading' is as live as 'scanning': the text half runs for minutes
  // with repair on, and a second start() during it used to run two scans
  // fighting over this one store — progress flipping between books, the
  // first job still saving to its captured slug, and whichever finished
  // last clobbering the other's terminal state.
  libraryBook: null,
  fileDiagramsIn: (libraryBook) => {
    set({ libraryBook });
    // Every page read so far, including the ones that printed no diagram:
    // a page the library has no record of is a page still to read. `page`
    // is included: it may be done and past its own filing (it stays the
    // current page through the checkpoint write), and if it is still under
    // the reader the loop files the full list after this, and last wins.
    const { found, page } = get();
    const byPage = new Map<number, FoundDiagram[]>();
    for (let n = 1; n <= page; n++) byPage.set(n, []);
    for (const d of found) byPage.get(d.page)?.push(d);
    for (const [n, list] of byPage) saveDiagrams(libraryBook, n, diagramRecords(list));
  },

  start: (slug, file, templates, options) => {
    const { status } = get();
    if (status === 'scanning' || status === 'reading') return;
    set({
      slug,
      libraryBook: options?.libraryBook ?? null,
      status: 'scanning',
      page: 0,
      pages: 0,
      found: [],
      solve: null,
      engineAt: null,
      error: null,
    });
    void scan(file, templates, options ?? {}, set, get, null);
  },

  resume: (slug, templates, options) => {
    const { status } = get();
    if (status === 'scanning' || status === 'reading') return;
    void (async () => {
      const saved = await readCheckpoint(slug);
      if (!saved) return;
      set({
        slug,
        libraryBook: options?.libraryBook ?? null,
        status: 'scanning',
        page: saved.page,
        pages: saved.pages,
        found: saved.results,
        solve: null,
        engineAt: null,
        error: null,
      });
      void scan(saved.file, templates, options ?? {}, set, get, saved);
    })();
  },

  pause: () => {
    if (get().status === 'scanning') set({ status: 'paused' });
  },

  /**
   * Give up on a book's scan: it is being deleted, so there is nowhere
   * left to put what it reads.
   *
   * Clearing is what stops it. The page loop returns as soon as the status
   * is not `scanning`, and the checkpoint write reads the slug back out of
   * the store, so a cleared job writes no more pages. A scan already in
   * its text half cannot be interrupted mid-read — it finishes into a book
   * that is gone, which costs time and nothing else, and its own terminal
   * states check the slug before reporting anything.
   *
   * By slug, so a stale delete cannot cancel the scan of a DIFFERENT book
   * that has started since.
   */
  abandon: (slug) => {
    if (get().slug !== slug) return;
    get().clear();
  },

  toggle: (index) =>
    set((s) => ({
      found: s.found.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f)),
    })),

  clear: () =>
    set({
      slug: null,
      status: 'idle',
      page: 0,
      pages: 0,
      found: [],
      solve: null,
      engineAt: null,
      error: null,
    }),
}));

/** Downscale the first-page canvas to a shelf-sized JPEG and save it as the
    book cover. Fire-and-forget: a failed cover must not fail the import. */
async function uploadCover(slug: string, page: HTMLCanvasElement): Promise<void> {
  try {
    const w = 480;
    const h = Math.round((page.height / page.width) * w);
    const thumb = document.createElement('canvas');
    thumb.width = w;
    thumb.height = h;
    thumb.getContext('2d')!.drawImage(page, 0, 0, w, h);
    await api(`/api/puzzlebooks/${encodeURIComponent(slug)}/cover`, {
      method: 'PUT',
      json: { image: thumb.toDataURL('image/jpeg', 0.82) },
    });
  } catch {
    /* cover is a nicety; ignore failures */
  }
}

/** The running scan's hold on the worker pool, kept across a pause. */
let scanLease: (() => void) | null = null;

async function scan(
  file: File,
  templates: Template[],
  options: ImportOptions,
  set: (partial: Partial<ImportJobState>) => void,
  get: () => ImportJobState,
  /** A scan to continue, or null to start the book from page one. */
  saved: ImportCheckpoint | null,
): Promise<void> {
  // The pool is held for the whole scan — and across a pause, which keeps
  // the lease: resuming is a second call here, not a second lease.
  scanLease ??= leasePool();
  try {
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), ...PDF_OPTIONS }).promise;
    set({ pages: pdf.numPages });
    // Everything phase one accumulates. Restored from the checkpoint when
    // resuming, which is the whole of what "resume" means here: the loop
    // picks up at the next page with the arrays it had.
    const results: FoundDiagram[] = saved ? [...saved.results] : [];
    const texts: TextPage[] = saved ? [...saved.texts] : [];
    const geometry: PageGeometry[] = saved ? [...saved.geometry] : [];
    // NOT checkpointed: full-page JPEGs are the heaviest thing here and are
    // only wanted at the very end, for pages that turned out to hold a
    // solved puzzle. A resumed scan re-renders those few pages instead of
    // carrying every page's image through the interruption.
    const pageImages = new Map<number, string>();
    const fingerprint = fingerprintOf(file);
    const startAt = saved ? saved.page + 1 : 1;
    for (let pageNo = startAt; pageNo <= pdf.numPages; pageNo++) {
      // Paused or cleared: stop between pages, leaving the checkpoint
      // written after the last finished one to carry on from.
      if (get().status !== 'scanning') return;
      set({ page: pageNo });
      // Where this page's diagrams begin in `results` — the checkpoint
      // below stores exactly that slice.
      const pageStart = results.length;
      const { page, canvas } = await renderPdfPage(pdf, pageNo);

      // The book's own words, in the same pass. The answers chapter has no
      // diagrams on it at all, so every page is read whether or not the
      // vision half finds anything.
      texts.push(await extractTextPage(page, pageNo));

      // The first page becomes the book's shelf cover — generated here from
      // the PDF, so a book gets a thumbnail with no offline render step.
      if (pageNo === 1) {
        const slug = get().slug;
        if (slug) void uploadCover(slug, canvas);
      }

      // The vision half of a page — the same read the book reader does
      // for one page at a time (ocr/pdfPage.ts), with the worker pool as
      // its classifier.
      const diagrams = await readDiagramsOnPage(canvas, classifyInWorker, templates, yieldToUi);
      const rects = diagrams.map((d) => d.rect);
      const placements: (string | null)[] = [];
      for (const { rect, dataUrl, fen, uncertain } of diagrams) {
        placements.push(fen ? (fen.split(' ')[0] ?? null) : null);
        results.push({
          page: pageNo,
          rect: {
            x: rect.x / canvas.width,
            y: rect.y / canvas.height,
            w: rect.w / canvas.width,
            h: rect.h / canvas.height,
          },
          dataUrl,
          fen,
          uncertain,
          selected: true,
        });
      }
      geometry.push({ page: pageNo, rects, placements, w: canvas.width, h: canvas.height });
      // Evidence: the whole page a puzzle was printed on, kept only for the
      // pages that printed one, and only until the upload.
      if (rects.length > 0) pageImages.set(pageNo, pageJpeg(canvas));
      set({ found: [...results] });
      // The reader's copy of this page, when the PDF is in the library —
      // the same rule the diagram job applies (books/diagramJob.ts).
      const libraryBook = get().libraryBook;
      if (libraryBook) saveDiagrams(libraryBook, pageNo, diagramRecords(results.slice(pageStart)));
      // The page is done, so record it. Awaited rather than fired and
      // forgotten: a put that is still in flight when the tab dies is a
      // checkpoint that does not exist, and one page of writing is cheap
      // beside rendering and classifying the next. Only THIS page's
      // payload goes to disk — writing the whole accumulated scan here
      // made the last pages of a big book each serialise tens of
      // megabytes, O(n²) across the scan.
      const slugNow = get().slug;
      if (slugNow) {
        await savePage(
          {
            slug: slugNow,
            file,
            fingerprint,
            page: pageNo,
            pages: pdf.numPages,
            diagrams: results.length,
            updatedAt: Date.now(),
          },
          {
            slug: slugNow,
            page: pageNo,
            results: results.slice(pageStart),
            text: texts.at(-1)!,
            geometry: geometry.at(-1)!,
          },
        );
      }
      // Yield so navigation and rendering stay smooth between pages.
      await yieldToUi();
    }
    if (results.length === 0) {
      // A verdict, not an interruption: this book has been read to the end
      // and had nothing in it. Leaving the checkpoint would park it on the
      // shelf as "unfinished" for ever, and resuming would start past the
      // last page and reach the same conclusion.
      const finishedSlug = get().slug;
      if (finishedSlug) await clearCheckpoint(finishedSlug);
      set({ error: 'No diagrams found in that PDF.', status: 'failed' });
      return;
    }

    // A resumed scan holds page images only for the pages IT rendered, so
    // fill the gaps before the text half asks for evidence. Only pages
    // that produced a diagram can ever be wanted, which is a small
    // fraction of a book.
    if (saved) {
      for (const g of geometry) {
        if (g.rects.length === 0 || pageImages.has(g.page)) continue;
        const { canvas } = await renderPdfPage(pdf, g.page);
        pageImages.set(g.page, pageJpeg(canvas));
      }
    }

    // The text half. Everything it needs about the book it works out from
    // the book — there is nothing here for anyone to configure.
    set({ status: 'reading' });
    await yieldToUi();
    const slug = get().slug;
    const summary = slug
      ? await readSolutions(slug, pdf, texts, geometry, results, pageImages, options)
      : null;
    if (slug) await clearCheckpoint(slug);
    // Abandoned while this ran (the book was deleted): there is nothing to
    // report the result of, and nothing that should look like a job again.
    if (get().slug === null) return;
    set({ solve: summary, status: 'done', found: [...results] });
  } catch (e) {
    // The checkpoint is deliberately NOT cleared here: a scan that fell
    // over is exactly the one worth resuming.
    if (get().slug === null) return;
    set({ status: 'failed', error: `Could not read the PDF: ${(e as Error).message}` });
  } finally {
    // A paused scan keeps its workers: it is about to carry on, and
    // rebuilding them costs the model again. Anything else is over.
    if (get().status !== 'paused') {
      scanLease?.();
      scanLease = null;
    }
  }
}

/**
 * A page's diagrams as the library keeps them: rects in page fractions
 * (they already are) and a FEN only when the read was sure enough — the
 * rule books/diagramJob.ts applies, so a book read either way is the same.
 */
function diagramRecords(found: FoundDiagram[]): PageDiagramRecord[] {
  return found.flatMap((d) =>
    d.rect ? [{ rect: d.rect, fen: d.fen && d.uncertain <= 4 ? d.fen : null }] : [],
  );
}

/** What one rendered page contributed to the vision half. */
export interface PageGeometry {
  page: number;
  rects: Rect[];
  /** Each rect's placement as CellNet read it, or null if it could not. */
  placements: (string | null)[];
  /** The size it was rendered at, so a rect can be stored as fractions. */
  w: number;
  h: number;
}

/**
 * What an evidence page is called on the server.
 *
 * The server writes `page033.jpg` (see the evidence route), a puzzle's
 * evidence points at that name, and a draft's evidence points at it too.
 * Three places agreeing by hand is three places to get it wrong, so they
 * all ask here instead.
 */
export function evidencePage(page: number): string {
  return `page${String(page).padStart(3, '0')}.jpg`;
}

/** The source page, sized like the offline pipeline's evidence images. */
function pageJpeg(canvas: HTMLCanvasElement): string {
  const w = 1100;
  const h = Math.round((canvas.height / canvas.width) * w);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(canvas, 0, 0, w, h);
  return out.toDataURL('image/jpeg', 0.72);
}

/**
 * The text half of the import, end to end.
 *
 * Pair each diagram with the number printed on it, replay the solution the
 * book prints for that number, and save the ones that hold up as real
 * puzzles — numbered, with their moves, and with the page they came off.
 * What is left stays a draft for the user to finish by hand.
 *
 * Nothing about the book is stated anywhere: the number style and ceiling
 * come from its own numbering, the label window from its own layout, and
 * the notation from whichever reading replays the most printed solutions.
 */
async function readSolutions(
  slug: string,
  pdf: PDFDocumentProxy,
  texts: TextPage[],
  geometry: PageGeometry[],
  found: FoundDiagram[],
  pageImages: Map<number, string>,
  options: ImportOptions,
): Promise<SolveSummary | null> {
  const numbering = deriveNumbering(texts);
  const byPage = new Map(texts.map((t) => [t.page, t]));
  const layouts: PageLayout[] = geometry.map((g) => {
    const text = byPage.get(g.page);
    const scale = text && text.width > 0 ? RENDER_WIDTH / text.width : 1;
    const numbers = text ? pageNumbers(text.words, numbering as BookText) : [];
    return {
      page: g.page,
      rects: g.rects,
      // Word boxes are in PDF points; the diagrams are in render pixels.
      numbers: numbers.map((n) => ({ ...n, x0: n.x0 * scale, x1: n.x1 * scale, y1: n.y1 * scale })),
    };
  });

  /**
   * Send up the page images anything now points at.
   *
   * EVERY page that produced a diagram, not only the solved ones. What is
   * left over becomes a draft, and a draft is finished by hand from the
   * printed page — so the page it came off is precisely what it needs.
   * Sending only the solved pages left drafts with a crop and nothing to
   * read, which is the one thing they cannot be corrected without.
   *
   * And the answers pages. An answers chapter prints no diagrams, so the
   * scan kept none of its pixels and nothing here ever asked for them —
   * which is why every Solutions tab, on drafts and puzzles alike, pointed
   * at a file that had never been uploaded. They are rendered now, once,
   * and only the ones something actually points at.
   */
  const uploadEvidence = async (answers: Set<number>): Promise<void> => {
    const wanted = new Set<number>(
      geometry.filter((g) => g.rects.length > 0).map((g) => g.page),
    );
    for (const page of answers) wanted.add(page);
    for (const page of [...wanted].sort((a, b) => a - b)) {
      if (!pageImages.has(page)) {
        pageImages.set(page, pageJpeg((await renderPdfPage(pdf, page)).canvas));
      }
    }
    const pages = [...wanted].map((page) => ({ page, image: pageImages.get(page) }));
    for (let i = 0; i < pages.length; i += 12) {
      const chunk = pages.slice(i, i + 12).filter((p) => p.image);
      if (chunk.length === 0) continue;
      // Evidence is the floor everything else stands on. If it did not
      // land, stop here: the throw keeps the checkpoint, so this resumes
      // rather than silently minting puzzles that point at pages that are
      // not there.
      await api(`/api/puzzlebooks/${encodeURIComponent(slug)}/evidence`, {
        method: 'POST',
        json: { pages: chunk },
      }).catch((e: unknown) => {
        throw new Error(`the server refused the evidence pages (${apiErrorMessage(e)})`);
      });
    }
  };

  /**
   * Point every diagram at the answers it should be read against, then send
   * up the pages that makes real. Returns the per-number lookup, which the
   * verified puzzles use as they save.
   *
   * A diagram whose number was read gets the single answers page that
   * number is printed on. One without gets the WHOLE answers section —
   * and that is most of what stays a draft, because failing to read the
   * printed number is what kept it out of the solve in the first place.
   * Finishing a draft by hand means reading the answers; a section it can
   * point at is worth more than the nothing it used to carry.
   *
   * Evidence before anything that points at it, on every path: this runs
   * from the bail-outs below too, which used to return before a single
   * page image had been uploaded and left a book of drafts pointing at
   * files that were never written.
   */
  const attachAnswers = async (
    ranges: [number, number][],
  ): Promise<(number: number) => number | undefined> => {
    const answerPageFor = answerPageIndex(texts, ranges, numbering.maxNumber);
    const section: number[] = [];
    for (const [from, to] of ranges) for (let page = from; page <= to; page++) section.push(page);
    const sectionFiles = section.map(evidencePage);
    const answers = new Set<number>();
    let sectionUsed = false;
    for (const diagram of found) {
      const page = diagram.number === undefined ? undefined : answerPageFor(diagram.number);
      if (page !== undefined) {
        answers.add(page);
        diagram.solutionPage = evidencePage(page);
      } else if (sectionFiles.length > 0) {
        diagram.solutionPages = sectionFiles;
        sectionUsed = true;
      }
    }
    if (sectionUsed) for (const page of section) answers.add(page);
    await uploadEvidence(answers);
    return answerPageFor;
  };

  const labelled = assignLabels(layouts);
  if (labelled.size === 0) {
    // Nothing was labelled, so nothing can be solved — but the diagrams
    // were still read, and every one of them is about to become a draft.
    await attachAnswers(answerPages(texts, numbering as BookText));
    return null;
  }

  // Which entry in `found` each labelled diagram is, so the UI can show
  // what became a puzzle and what stayed a draft.
  const foundAt = new Map<string, number>();
  let at = 0;
  for (const g of geometry) for (const rect of g.rects) foundAt.set(`${g.page}:${rect.x}:${rect.y}`, at++);

  const boards = new Map<number, ReadBoard>();
  for (const [number, where] of labelled) {
    const g = geometry.find((x) => x.page === where.page);
    const index = g?.rects.indexOf(where.rect) ?? -1;
    const placement = index >= 0 ? g!.placements[index] : null;
    if (!placement) continue;
    const text = byPage.get(where.page);
    const sides = text
      ? letterSides(text.words, pageNumbers(text.words, numbering as BookText))
      : new Map<number, 'w' | 'b'>();
    const sideStated = sides.get(number);
    boards.set(number, { placement, page: where.page, ...(sideStated ? { sideStated } : {}) });
    const foundIndex = foundAt.get(`${where.page}:${where.rect.x}:${where.rect.y}`);
    if (foundIndex !== undefined) found[foundIndex]!.number = number;
  }
  if (boards.size === 0) {
    await attachAnswers(answerPages(texts, numbering as BookText));
    return null;
  }

  let result = solveBook(texts, boards, { ...numbering, solutionsAfterPage: 0 });

  // The book prints its piece symbols; the scan mangled them into garbage.
  // The first solve settles the common ones from lines that replayed, and
  // the printed glyphs settle the rest — so the answers get read a second
  // time, knowing what the symbols look like. Cheap: nineteen pages and a
  // few thousand tiny crops on the book this was measured against, for 25
  // more solutions.
  const glyphs = await readAnswerGlyphs(pdf, texts, result.answerRanges, result.learnedHints);
  if (glyphs.size > 0) {
    result = solveBook(texts, boards, { ...numbering, solutionsAfterPage: 0 }, glyphs);
  }

  // Pass two: the boards whose printed solution did not replay. Nearly all
  // of those are a correct reading of a page plus ONE misread square, and
  // the book's own line is what finds it — see shared/bookRepair.ts.
  const repaired = options.repair
    ? await repairUnread(pdf, geometry, labelled, boards, result)
    : [];
  // The repair pass is the last thing that reads a board, and the engine
  // phase after it now runs a pool of its own. Six classification workers,
  // each holding the model, have nothing left to do and no reason to sit
  // through it beside six engines — this is the longest, widest moment of
  // an import, and on a phone it is the one that decides whether it
  // survives. The scan's own release stays where it is: it is what covers
  // the paths that never reach here, and running twice releases nothing.
  scanLease?.();
  scanLease = null;
  const solved = [...result.puzzles, ...repaired];
  solved.sort((a, b) => a.number - b.number);

  const answerPageFor = await attachAnswers(result.answerRanges);

  const sizes = new Map(geometry.map((g) => [g.page, { w: g.w, h: g.h }]));
  let saveFailed = 0;

  /**
   * Save one puzzle with its evidence. True when the book now holds it.
   *
   * Every tier goes through here, so a puzzle the engine settled carries
   * exactly the evidence a book-parsed one does — the page, the place on
   * it, and the page its answer is on.
   */
  const save = async (puzzle: VerifiedPuzzle | EnginePuzzle): Promise<boolean> => {
    const where = labelled.get(puzzle.number);
    const size = where ? sizes.get(where.page) : undefined;
    if (!where || !size) return false;
    const rect = where.rect;
    const answers = answerPageFor(puzzle.number);
    // The rect is stored as fractions of the page, so it survives whatever
    // size the evidence image happens to be.
    try {
      await api(`/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles`, {
        method: 'POST',
        json: {
          number: puzzle.number,
          fen: puzzle.fen,
          uci: puzzle.uci,
          san: puzzle.san,
          ...('wildcards' in puzzle && puzzle.wildcards ? { wildcards: puzzle.wildcards } : {}),
          provenance: puzzle.provenance,
          evidence: {
            page: evidencePage(where.page),
            rect: {
              x: rect.x / size.w,
              y: rect.y / size.h,
              w: rect.w / size.w,
              h: rect.h / size.h,
            },
            // A verified puzzle carries the page its answer is on exactly
            // as a draft does. It went out without one until now, so the
            // one tier that HAS a printed solution to check against was
            // the one tier you could not check it against.
            ...(answers === undefined ? {} : { solutionPage: evidencePage(answers) }),
          },
        },
      });
    } catch (e) {
      // A refused save must not be reported as an import. The diagram
      // stays a SELECTED draft — better offered again than silently gone —
      // and the summary owns up to the count. The network GOING, though,
      // is the whole scan failing: rethrown so the checkpoint survives
      // and the import resumes instead of degrading every puzzle after
      // the outage into a draft.
      if (e instanceof ApiError && e.status !== 0) {
        saveFailed += 1;
        return false;
      }
      throw e;
    }
    const index = foundAt.get(`${where.page}:${rect.x}:${rect.y}`);
    if (index !== undefined) {
      found[index]!.solved = true;
      // A saved puzzle must not be saved again as a draft when the user
      // accepts what is left.
      found[index]!.selected = false;
    }
    return true;
  };

  for (const puzzle of solved) await save(puzzle);

  /**
   * What the book itself could not answer for, the engine is asked about.
   *
   * Only the boards that were READ and NUMBERED: a diagram with no number
   * has no printed answer to have failed, and one that never resolved into
   * a position has nothing to search. The tiers, and the rule for telling
   * them apart, are shared/bookEngine.ts — the same decision the offline
   * pipeline makes, on the same evidence.
   */
  let engine: SolveSummary['engine'];
  if (options.engine !== false && result.unresolved.length > 0) {
    const candidates = result.unresolved.filter((n) => boards.has(n) && labelled.has(n));
    const counts = { corroborated: 0, only: 0, unverified: 0 };
    useImportJob.setState({ engineAt: { done: 0, total: candidates.length } });

    const ask = (number: number): Promise<EnginePuzzle | null> => {
      const board = boards.get(number)!;
      const hints = result.unresolvedHints.get(number);
      const goal = pageMateGoal(byPage.get(labelled.get(number)!.page)?.text ?? '');
      const side = hints?.side ?? board.sideStated;
      return engineTier(
        {
          number,
          placement: board.placement,
          ...(side ? { side } : {}),
          squares: hints?.squares ?? [],
          ...(goal > 0 ? { mateIn: goal } : {}),
        },
        searchPosition,
      );
    };

    /**
     * Searched several at a time, saved one at a time in the book's own
     * order.
     *
     * The searching is the whole cost of this phase and the boards are
     * independent, so they go out to the engine pool together — the same
     * shape the page scan already has. What comes back is held until every
     * lower number has been dealt with, so an import that is cancelled or
     * loses the network partway leaves a PREFIX of the book behind rather
     * than a scatter of whichever searches happened to finish first.
     */
    const answers: (EnginePuzzle | null | undefined)[] = new Array(candidates.length);
    let next = 0;
    let done = 0;
    let saved = 0;
    let saving = false;
    let failure: unknown = null;

    const drain = async (): Promise<void> => {
      // One drain at a time. The one already running re-reads the array
      // after every save, so it picks up whatever landed while it waited.
      if (saving) return;
      saving = true;
      try {
        while (saved < answers.length && answers[saved] !== undefined) {
          const puzzle = answers[saved];
          saved += 1;
          if (!puzzle || !(await save(puzzle))) continue;
          if (puzzle.provenance === 'engine-corroborated') counts.corroborated += 1;
          else if (puzzle.provenance === 'engine-only') counts.only += 1;
          else counts.unverified += 1;
        }
      } finally {
        saving = false;
      }
    };

    const worker = async (): Promise<void> => {
      while (failure === null) {
        // The job was cleared out from under us; stop rather than keep
        // saving into a book nobody is importing any more.
        if (useImportJob.getState().status !== 'reading') return;
        const at = next++;
        if (at >= candidates.length) return;
        answers[at] = await ask(candidates[at]!);
        done += 1;
        useImportJob.setState({ engineAt: { done, total: candidates.length } });
        // The network going is the whole scan failing, not one board
        // degrading: carried out and rethrown once the pool is back.
        await drain().catch((e: unknown) => {
          failure = e;
        });
      }
    };

    await Promise.all(Array.from({ length: ENGINE_POOL_SIZE }, worker));
    if (failure === null) {
      await drain().catch((e: unknown) => {
        failure = e;
      });
    }
    releaseBookEngine();
    useImportJob.setState({ engineAt: null });
    if (failure !== null) throw failure;
    engine = counts;
  }
  const settled = engine ? engine.corroborated + engine.only + engine.unverified : 0;
  return {
    solved: solved.length - saveFailed,
    repaired: repaired.length,
    // What the engine imported is no longer unresolved: it is in the book,
    // badged for what it is.
    unresolved: result.unresolved.length - repaired.length - settled,
    saveFailed,
    ...(engine ? { engine } : {}),
    confident: result.confident,
    settings: result.settings,
    answerRanges: result.answerRanges,
  };
}

/** How many misread boards are worth re-reading. */
const REPAIR_LIMIT = 400;

/**
 * How many boards may be out with the pool at once.
 *
 * Twice the pool, so a worker that finishes has its next board already
 * waiting rather than waiting on a page render. Higher does not read any
 * faster and costs memory: every queued board is a transferred copy of a
 * 512² crop, and a whole book's worth is ~100 MB sitting in the queue.
 */
const READ_AHEAD = POOL_SIZE * 2;

/**
 * Rescue the boards whose printed solution refused to replay.
 *
 * The cell classifier is right about 99.4% of squares, which still leaves
 * only about two boards in three read perfectly — and almost every failure
 * is a single wrong square. The book's own line catches those, so the ones
 * that failed get read again properly: full class distributions per cell
 * plus the same cell re-read under small shifts, which is what the search
 * needs to know where to look.
 *
 * Five times the work of a normal read, so it runs only on the failures,
 * and only on the pages that actually hold one — which is why the pages are
 * re-rendered here rather than kept in memory through the whole scan.
 *
 * That re-read is nearly all of the cost — 3.5 GMACs a board against the
 * search's 33 ms — so the boards are handed to the pool as they are cut and
 * searched as their readings land, the way the scan already reads a page.
 * Reading one board at a time left five of six workers idle.
 */
async function repairUnread(
  pdf: PDFDocumentProxy,
  geometry: PageGeometry[],
  labelled: Map<number, LabelledDiagram>,
  boards: Map<number, ReadBoard>,
  result: SolveResult,
): Promise<VerifiedPuzzle[]> {
  // Only boards that were actually READ can be repaired; a number whose
  // diagram never resolved has nothing to fix.
  const candidates = result.unresolved
    .filter((number) => boards.has(number) && labelled.has(number))
    .slice(0, REPAIR_LIMIT);
  if (candidates.length === 0) return [];

  const byPage = new Map<number, number[]>();
  for (const number of candidates) {
    const page = labelled.get(number)!.page;
    byPage.set(page, [...(byPage.get(page) ?? []), number]);
  }
  const pages = [...byPage].sort((a, b) => a[0] - b[0]);

  const out: VerifiedPuzzle[] = [];
  /** Boards already handed to the pool, oldest first. */
  const reading: { number: number; detail: ReturnType<typeof classifyDetailInWorker> }[] = [];
  let nextPage = 0;

  /** Cut a page's failing boards and hand every one of them to the pool. */
  const submitPage = async (pageNo: number, numbers: number[]): Promise<void> => {
    const geo = geometry.find((g) => g.page === pageNo);
    if (!geo) return;
    const { canvas } = await renderPdfPage(pdf, pageNo);
    for (const number of numbers) {
      const { board } = cropDiagram(canvas, labelled.get(number)!.rect);
      reading.push({ number, detail: classifyDetailInWorker(board) });
    }
  };

  /** Search one board, once its detailed reading has landed. */
  const searchOne = async (number: number, detail: DetailedReading | null): Promise<void> => {
    if (!detail) return;
    const fixed = repairBoard(
      detail.cells,
      detail.labels,
      (labels) => {
        const placement = labelsToFen(
          labels.map((ch) => (ch === '1' ? 'empty' : ch)) as Parameters<typeof labelsToFen>[0],
          false,
        ).split(' ')[0];
        if (!placement) return null;
        const replayed = result.replayFor(number, placement);
        return replayed ? { placement, side: 'w' as const, sans: replayed.san } : null;
      },
      // Two cells, not three. The third level costs more than the first
      // two together and, on the book measured, found the fewest — and
      // this runs while somebody watches an import finish.
      { maxEdits: 2 },
    );
    if (!fixed.repaired) return;
    // Ask once more for the real answer: the search only needed to know
    // THAT the position replays, this needs the moves it produced.
    const verified = result.replayFor(number, fixed.repaired.placement);
    if (verified) out.push({ number, ...verified });
    // Yield after every board: the search is hundreds of replays, and it
    // runs here rather than in the worker because replaying needs the
    // book's parsed answers.
    await yieldToUi();
  };

  while (nextPage < pages.length || reading.length > 0) {
    while (reading.length < READ_AHEAD && nextPage < pages.length) {
      const [pageNo, numbers] = pages[nextPage++]!;
      await submitPage(pageNo, numbers);
    }
    const next = reading.shift();
    if (next) await searchOne(next.number, await next.detail);
  }
  return out;
}

/**
 * Learn this book's piece symbols from the pages its answers are printed
 * on.
 *
 * Only the answer pages are re-rendered, and only once — the diagrams'
 * pages were rendered during the scan but the answers usually were not,
 * and keeping every page's pixels through a whole book is not worth the
 * memory.
 */
async function readAnswerGlyphs(
  pdf: PDFDocumentProxy,
  texts: TextPage[],
  ranges: [number, number][],
  settled: Map<string, Role>,
): Promise<Map<string, Role>> {
  if (ranges.length === 0) return new Map();
  const wanted = new Set<number>();
  for (const [from, to] of ranges) {
    for (let page = from; page <= to; page++) wanted.add(page);
  }
  const byPage = new Map(texts.map((t) => [t.page, t]));
  const samples: GlyphSample[] = [];
  for (const pageNo of [...wanted].sort((a, b) => a - b)) {
    const text = byPage.get(pageNo);
    if (!text) continue;
    const { canvas } = await renderPdfPage(pdf, pageNo);
    const gray = grayFromCanvas(canvas);
    const scale = text.width > 0 ? gray.w / text.width : 1;
    for (const word of text.words) {
      if (!isMoveish(word.text)) continue;
      const prefix = tokenPrefix(word.text);
      if (!prefix) continue;
      const pixels = readGlyph(gray, {
        x0: word.x0 * scale,
        y0: word.y0 * scale,
        x1: word.x1 * scale,
        y1: word.y1 * scale,
      });
      if (pixels) samples.push({ prefix, pixels });
    }
    await yieldToUi();
  }
  // Trained on what the text already settled; those labels come from lines
  // that replayed, so they are the trustworthy half.
  return learnGlyphHints(samples, settled);
}

useImportJob.subscribe((state) => {
  const running = state.status === 'scanning' || state.status === 'reading';
  if (running === unloadGuarded) return;
  unloadGuarded = running;
  if (running) window.addEventListener('beforeunload', warnOnUnload);
  else window.removeEventListener('beforeunload', warnOnUnload);
});
