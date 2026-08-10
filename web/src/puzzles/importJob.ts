import { create } from 'zustand';
import {
  assignLabels,
  deriveNumbering,
  letterSides,
  pageNumbers,
  type BookText,
  type PageLayout,
  type TextPage,
} from '@shared/bookImport';
import { solveBook, type SolveResult } from '@shared/bookSolve';
import type { ReadBoard } from '@shared/bookConfigSearch';
import type { CellReading, Template } from './ocr/classify';
import { classifyBoard, labelsToFen } from './ocr/classify';
import { grayFromCanvas, cropDiagram } from './ocr/browser';
import { detectDiagrams } from './ocr/detect';
import { extractTextPage } from './ocr/pdfText';
import type { Gray } from './ocr/image';

export interface FoundDiagram {
  page: number;
  dataUrl: string;
  fen: string | null;
  uncertain: number;
  selected: boolean;
  /** The number printed on it, once the labelling stage has run. */
  number?: number;
  /** True once its printed solution has been replayed successfully. */
  solved?: boolean;
}

/** What the solve stage concluded, for the dialog to show. */
export interface SolveSummary {
  solved: number;
  unresolved: number;
  confident: boolean;
  /** How the book turned out to write its answers — worked out, not set. */
  settings: SolveResult['settings'];
  answerRanges: [number, number][];
}

interface ImportJobState {
  /** Book the scan belongs to; null = idle. */
  slug: string | null;
  status: 'idle' | 'scanning' | 'reading' | 'done' | 'failed';
  page: number;
  pages: number;
  found: FoundDiagram[];
  /** Null until the text half has run; null after it finds nothing. */
  solve: SolveSummary | null;
  error: string | null;
  start: (slug: string, file: File, templates: Template[]) => void;
  toggle: (index: number) => void;
  clear: () => void;
}

/** One classification worker, shared across scans; lazy so the chunk only
    loads when a scan actually starts. */
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: CellReading[] | null) => void>();

function classifyInWorker(board: Gray): Promise<CellReading[] | null> {
  worker ??= (() => {
    const w = new Worker(new URL('./ocr/cellnet.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (e: MessageEvent) => {
      const { id, readings } = e.data as { id: number; readings: CellReading[] | null };
      pending.get(id)?.(readings);
      pending.delete(id);
    };
    return w;
  })();
  const id = ++nextId;
  const buffer = board.data.buffer.slice(
    board.data.byteOffset,
    board.data.byteOffset + board.data.byteLength,
  );
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ id, w: board.w, h: board.h, data: buffer }, [buffer]);
  });
}

const RENDER_WIDTH = 1400;

/**
 * A whole-book scan as a BACKGROUND JOB: close the dialog, browse other
 * pages, come back — the scan keeps going and the book page shows its
 * progress. Classification runs in a worker, page rendering yields to the
 * event loop between pages, so the app stays responsive throughout.
 */
export const useImportJob = create<ImportJobState>((set, get) => ({
  slug: null,
  status: 'idle',
  page: 0,
  pages: 0,
  found: [],
  solve: null,
  error: null,

  start: (slug, file, templates) => {
    if (get().status === 'scanning') return;
    set({ slug, status: 'scanning', page: 0, pages: 0, found: [], solve: null, error: null });
    void scan(file, templates, set, get);
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
    await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/cover`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: thumb.toDataURL('image/jpeg', 0.82) }),
    });
  } catch {
    /* cover is a nicety; ignore failures */
  }
}

async function scan(
  file: File,
  templates: Template[],
  set: (partial: Partial<ImportJobState>) => void,
  get: () => ImportJobState,
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
    const results: FoundDiagram[] = [];
    const texts: TextPage[] = [];
    const geometry: PageGeometry[] = [];
    const pageImages = new Map<number, string>();
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      if (get().status !== 'scanning') return; // cancelled
      set({ page: pageNo });
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
        results.push({ page: pageNo, dataUrl, fen, uncertain, selected: true });
      }
      geometry.push({ page: pageNo, rects, placements, w: canvas.width, h: canvas.height });
      // Evidence: the whole page a puzzle was printed on, kept only for the
      // pages that printed one, and only until the upload.
      if (rects.length > 0) pageImages.set(pageNo, pageJpeg(canvas));
      set({ found: [...results] });
      // Yield so navigation and rendering stay smooth between pages.
      await new Promise((r) => setTimeout(r, 0));
    }
    if (results.length === 0) {
      set({ error: 'No diagrams found in that PDF.', status: 'failed' });
      return;
    }

    // The text half. Everything it needs about the book it works out from
    // the book — there is nothing here for anyone to configure.
    set({ status: 'reading' });
    await new Promise((r) => setTimeout(r, 0));
    const slug = get().slug;
    const summary = slug ? await readSolutions(slug, texts, geometry, results, pageImages) : null;
    set({ solve: summary, status: 'done', found: [...results] });
  } catch (e) {
    set({ status: 'failed', error: `Could not read the PDF: ${(e as Error).message}` });
  }
}

/** One diagram's place on its page, in render pixels. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What one rendered page contributed to the vision half. */
interface PageGeometry {
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
  texts: TextPage[],
  geometry: PageGeometry[],
  found: FoundDiagram[],
  pageImages: Map<number, string>,
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

  const result = solveBook(texts, boards, { ...numbering, solutionsAfterPage: 0 });

  // Evidence first: a puzzle must never reference a page image that is not
  // there, so the pages go up before anything that points at them.
  const wanted = new Set(result.puzzles.map((p) => labelled.get(p.number)?.page).filter(Boolean));
  const pages = [...wanted].map((page) => ({ page: page as number, image: pageImages.get(page as number) }));
  for (let i = 0; i < pages.length; i += 12) {
    const chunk = pages.slice(i, i + 12).filter((p) => p.image);
    if (chunk.length === 0) continue;
    await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pages: chunk }),
    });
  }

  const sizes = new Map(geometry.map((g) => [g.page, { w: g.w, h: g.h }]));
  for (const puzzle of result.puzzles) {
    const where = labelled.get(puzzle.number);
    const size = where ? sizes.get(where.page) : undefined;
    if (!where || !size) continue;
    const rect = where.rect;
    // The rect is stored as fractions of the page, so it survives whatever
    // size the evidence image happens to be.
    await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });
    const index = foundAt.get(`${where.page}:${rect.x}:${rect.y}`);
    if (index !== undefined) {
      found[index]!.solved = true;
      // A solved puzzle is already saved; it must not be saved again as a
      // draft when the user accepts what is left.
      found[index]!.selected = false;
    }
  }

  return {
    solved: result.puzzles.length,
    unresolved: result.unresolved.length,
    confident: result.confident,
    settings: result.settings,
    answerRanges: result.answerRanges,
  };
}
