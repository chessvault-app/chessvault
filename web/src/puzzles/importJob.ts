import { create } from 'zustand';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import {
  assignLabels,
  deriveNumbering,
  isMoveish,
  tokenPrefix,
  letterSides,
  pageNumbers,
  type BookText,
  type LabelledDiagram,
  type PageLayout,
  type TextPage,
} from '@shared/bookImport';
import { solveBook, type SolveResult, type VerifiedPuzzle } from '@shared/bookSolve';
import { repairBoard } from '@shared/bookRepair';
import { learnGlyphHints, readGlyph, type GlyphSample } from '@shared/bookGlyphs';
import type { CellCandidates } from '@shared/bookRepair';
import type { ReadBoard } from '@shared/bookConfigSearch';
import type { CellReading, Template } from './ocr/classify';
import { classifyBoard, labelsToFen } from './ocr/classify';
import { grayFromCanvas, cropDiagram } from './ocr/browser';
import { detectDiagrams } from './ocr/detect';
import { extractTextPage } from './ocr/pdfText';
import type { Gray } from './ocr/image';
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
}

/** Choices the user made before the import started. */
export interface ImportOptions {
  /**
   * Re-read the boards whose printed solution would not replay, looking
   * for a misread square. Off by default: measured on 1001 Chess
   * Exercises it recovered 26 puzzles out of 242 failures and took twenty
   * minutes, so it is worth offering and not worth imposing.
   */
  repair?: boolean;
}

/** What the solve stage concluded, for the dialog to show. */
export interface SolveSummary {
  solved: number;
  /** Of those, the ones a misread square had to be fixed on first. */
  repaired: number;
  unresolved: number;
  /** Solved, but the server refused the save — left selected as drafts. */
  saveFailed: number;
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
  error: string | null;
  start: (slug: string, file: File, templates: Template[], options?: ImportOptions) => void;
  /** Continue a scan a reload, a crash, or a pause interrupted. */
  resume: (slug: string, templates: Template[], options?: ImportOptions) => void;
  /** Stop after the page being read, keeping the checkpoint. */
  pause: () => void;
  toggle: (index: number) => void;
  clear: () => void;
}

/** One classification worker, shared across scans; lazy so the chunk only
    loads when a scan actually starts. */
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: CellReading[] | null) => void>();
const detailPending = new Map<
  number,
  (r: { cells: CellCandidates[]; labels: string[] } | null) => void
>();

function ensureWorker(): Worker {
  worker ??= (() => {
    const w = new Worker(new URL('./ocr/cellnet.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (e: MessageEvent) => {
      const { id, readings, cells, labels } = e.data as {
        id: number;
        readings?: CellReading[] | null;
        cells?: { probs: number[]; top: number; votes: [number, number][] }[] | null;
        labels?: string[];
      };
      const waitingForDetail = detailPending.get(id);
      if (waitingForDetail) {
        detailPending.delete(id);
        waitingForDetail(
          cells && labels
            ? { cells: cells.map((c) => ({ ...c, votes: new Map(c.votes) })), labels }
            : null,
        );
        return;
      }
      pending.get(id)?.(readings ?? null);
      pending.delete(id);
    };
    // A crashed worker must not strand its callers: every waiting promise
    // resolves to "unread" (which degrades to a draft), and the worker is
    // dropped so the next board boots a fresh one.
    w.onerror = () => {
      for (const resolve of pending.values()) resolve(null);
      for (const resolve of detailPending.values()) resolve(null);
      pending.clear();
      detailPending.clear();
      w.terminate();
      if (worker === w) worker = null;
    };
    return w;
  })();
  return worker;
}

function classifyInWorker(board: Gray): Promise<CellReading[] | null> {
  const w = ensureWorker();
  const id = ++nextId;
  const buffer = board.data.buffer.slice(
    board.data.byteOffset,
    board.data.byteOffset + board.data.byteLength,
  );
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, w: board.w, h: board.h, data: buffer }, [buffer]);
  });
}

/** The same worker, asked for every cell's distribution — repair only. */
function classifyDetailInWorker(
  board: Gray,
): Promise<{ cells: CellCandidates[]; labels: string[] } | null> {
  // ensureWorker, not worker!: a resumed import whose checkpoint was
  // written after the final page never runs the page loop, so the repair
  // pass used to be the first caller — and dereferenced null.
  const w = ensureWorker();
  const id = ++nextId;
  const buffer = board.data.buffer.slice(
    board.data.byteOffset,
    board.data.byteOffset + board.data.byteLength,
  );
  return new Promise((resolve) => {
    detailPending.set(id, resolve);
    w.postMessage({ id, w: board.w, h: board.h, data: buffer, detail: true }, [buffer]);
  });
}

const RENDER_WIDTH = 1400;

/**
 * Open the document and drop it again: the "is this a PDF we can read at
 * all" probe. The rebuild path clears a book's puzzles before importing
 * the replacement, and used to do so on nothing but the file picker's
 * word — an unreadable file emptied the book and imported nothing.
 */
export async function canReadPdf(file: File): Promise<boolean> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({
      data: await file.arrayBuffer(),
      useWasm: false,
      wasmUrl: `${window.location.origin}/pdfjs-wasm/`,
    });
    const pages = (await task.promise).numPages;
    await task.destroy();
    return pages > 0;
  } catch {
    return false;
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
  error: null,

  // 'reading' is as live as 'scanning': the text half runs for minutes
  // with repair on, and a second start() during it used to run two scans
  // fighting over this one store — progress flipping between books, the
  // first job still saving to its captured slug, and whichever finished
  // last clobbering the other's terminal state.
  start: (slug, file, templates, options) => {
    const { status } = get();
    if (status === 'scanning' || status === 'reading') return;
    set({ slug, status: 'scanning', page: 0, pages: 0, found: [], solve: null, error: null });
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
        status: 'scanning',
        page: saved.page,
        pages: saved.pages,
        found: saved.results,
        solve: null,
        error: null,
      });
      void scan(saved.file, templates, options ?? {}, set, get, saved);
    })();
  },

  pause: () => {
    if (get().status === 'scanning') set({ status: 'paused' });
  },

  toggle: (index) =>
    set((s) => ({
      found: s.found.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f)),
    })),

  clear: () =>
    set({ slug: null, status: 'idle', page: 0, pages: 0, found: [], solve: null, error: null }),
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

async function scan(
  file: File,
  templates: Template[],
  options: ImportOptions,
  set: (partial: Partial<ImportJobState>) => void,
  get: () => ImportJobState,
  /** A scan to continue, or null to start the book from page one. */
  saved: ImportCheckpoint | null,
): Promise<void> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const pdf = await pdfjs.getDocument({
      data: await file.arrayBuffer(),
      // Scanned books embed JBIG2/JPX images; npm's pdfjs-dist ships only
      // the JS fallback decoders — skip the doomed wasm fetch.
      useWasm: false,
      wasmUrl: `${window.location.origin}/pdfjs-wasm/`,
    }).promise;
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
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;

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

      const rects = detectDiagrams(grayFromCanvas(canvas));
      const placements: (string | null)[] = [];
      for (const rect of rects) {
        const { dataUrl, board, features } = cropDiagram(canvas, rect);
        let cells = await classifyInWorker(board);
        if (!cells && templates.length > 0) cells = classifyBoard(features, templates);
        let fen: string | null = null;
        let uncertain = 0;
        if (cells) {
          fen = labelsToFen(
            cells.map((c) => c.label),
            false,
          );
          uncertain = cells.filter((c) => c.confidence < 0.35).length;
        }
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
      await new Promise((r) => setTimeout(r, 0));
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
        const page = await pdf.getPage(g.page);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        pageImages.set(g.page, pageJpeg(canvas));
      }
    }

    // The text half. Everything it needs about the book it works out from
    // the book — there is nothing here for anyone to configure.
    set({ status: 'reading' });
    await new Promise((r) => setTimeout(r, 0));
    const slug = get().slug;
    const summary = slug
      ? await readSolutions(slug, pdf, texts, geometry, results, pageImages, options)
      : null;
    if (slug) await clearCheckpoint(slug);
    set({ solve: summary, status: 'done', found: [...results] });
  } catch (e) {
    // The checkpoint is deliberately NOT cleared here: a scan that fell
    // over is exactly the one worth resuming.
    set({ status: 'failed', error: `Could not read the PDF: ${(e as Error).message}` });
  }
}

/** One diagram's place on its page, in render pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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

  const labelled = assignLabels(layouts);
  if (labelled.size === 0) return null;

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
  if (boards.size === 0) return null;

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
  const solved = [...result.puzzles, ...repaired];
  solved.sort((a, b) => a.number - b.number);

  // Evidence first: a puzzle must never reference a page image that is not
  // there, so the pages go up before anything that points at them.
  //
  // EVERY page that produced a diagram, not only the solved ones. What is
  // left over becomes a draft, and a draft is finished by hand from the
  // printed page — so the page it came off is precisely what it needs.
  // Sending only the solved pages left drafts with a crop and nothing to
  // read, which is the one thing they cannot be corrected without.
  const wanted = new Set<number>(
    geometry.filter((g) => g.rects.length > 0).map((g) => g.page),
  );
  const pages = [...wanted].map((page) => ({ page, image: pageImages.get(page) }));
  for (let i = 0; i < pages.length; i += 12) {
    const chunk = pages.slice(i, i + 12).filter((p) => p.image);
    if (chunk.length === 0) continue;
    // Evidence is the floor everything else stands on. If it did not land,
    // stop here: the throw keeps the checkpoint, so this resumes rather
    // than silently minting puzzles that point at pages that are not there.
    await api(`/api/puzzlebooks/${encodeURIComponent(slug)}/evidence`, {
      method: 'POST',
      json: { pages: chunk },
    }).catch((e: unknown) => {
      throw new Error(`the server refused the evidence pages (${apiErrorMessage(e)})`);
    });
  }

  /**
   * The answers page a number is printed on.
   *
   * Mirrors what scripts/ml/enrich_solution_pages.py does offline, and for
   * the same stated reason: a person enters a draft's solution while
   * looking at it. Numbers are anchored where the answer pages print them;
   * anything the scan mangled falls back to the page whose run of numbers
   * covers it.
   */
  const anchors = new Map<number, number>();
  for (const [from, to] of result.answerRanges) {
    for (let page = from; page <= to; page++) {
      const text = byPage.get(page);
      if (!text) continue;
      for (const match of text.text.matchAll(/(\d{1,4})/g)) {
        const value = Number(match[1]);
        if (value >= 1 && value <= numbering.maxNumber && !anchors.has(value)) {
          anchors.set(value, page);
        }
      }
    }
  }
  const runs = [...new Set(anchors.values())]
    .map((page) => ({ page, first: Math.min(...[...anchors].filter(([, p]) => p === page).map(([n]) => n)) }))
    .sort((a, b) => a.first - b.first);
  const solutionPageFor = (number: number | undefined): string | undefined => {
    if (number === undefined || runs.length === 0) return undefined;
    const anchored = anchors.get(number);
    if (anchored !== undefined) return `page${String(anchored).padStart(3, '0')}.jpg`;
    let chosen = runs[0]!.page;
    for (const run of runs) {
      if (run.first <= number) chosen = run.page;
      else break;
    }
    return `page${String(chosen).padStart(3, '0')}.jpg`;
  };
  for (const diagram of found) {
    const page = solutionPageFor(diagram.number);
    if (page) diagram.solutionPage = page;
  }

  const sizes = new Map(geometry.map((g) => [g.page, { w: g.w, h: g.h }]));
  let saveFailed = 0;
  for (const puzzle of solved) {
    const where = labelled.get(puzzle.number);
    const size = where ? sizes.get(where.page) : undefined;
    if (!where || !size) continue;
    const rect = where.rect;
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
          provenance: puzzle.provenance,
          evidence: {
            page: `page${String(where.page).padStart(3, '0')}.jpg`,
            rect: {
              x: rect.x / size.w,
              y: rect.y / size.h,
              w: rect.w / size.w,
              h: rect.h / size.h,
            },
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
        continue;
      }
      throw e;
    }
    const index = foundAt.get(`${where.page}:${rect.x}:${rect.y}`);
    if (index !== undefined) {
      found[index]!.solved = true;
      // A solved puzzle is already saved; it must not be saved again as a
      // draft when the user accepts what is left.
      found[index]!.selected = false;
    }
  }

  return {
    solved: solved.length - saveFailed,
    repaired: repaired.length,
    unresolved: result.unresolved.length - repaired.length,
    saveFailed,
    confident: result.confident,
    settings: result.settings,
    answerRanges: result.answerRanges,
  };
}

/** How many misread boards are worth re-reading. */
const REPAIR_LIMIT = 400;

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

  const out: VerifiedPuzzle[] = [];
  for (const [pageNo, numbers] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const geo = geometry.find((g) => g.page === pageNo);
    if (!geo) continue;
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;

    for (const number of numbers) {
      const rect = labelled.get(number)!.rect;
      const { board } = cropDiagram(canvas, rect);
      const detail = await classifyDetailInWorker(board);
      if (!detail) continue;
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
      if (!fixed.repaired) continue;
      // Ask once more for the real answer: the search only needed to know
      // THAT the position replays, this needs the moves it produced.
      const verified = result.replayFor(number, fixed.repaired.placement);
      if (verified) out.push({ number, ...verified });
      // Yield after every board: the search is hundreds of replays, and it
      // runs here rather than in the worker because replaying needs the
      // book's parsed answers.
      await new Promise((r) => setTimeout(r, 0));
    }
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
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
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
    await new Promise((r) => setTimeout(r, 0));
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
