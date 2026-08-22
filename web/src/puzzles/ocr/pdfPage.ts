import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { CellReading, Template } from './classify';
import { classifyBoard, labelsToFen } from './classify';
import { cropDiagram, grayFromCanvas } from './browser';
import { detectDiagrams } from './detect';
import type { Gray } from './image';

/**
 * The one way this app opens a PDF and reads the diagrams off a page.
 *
 * The importer (importJob.ts) scans a whole book this way; the book
 * reader (books/) does the same to one page at a time, so a tap on a
 * printed diagram can set the board up. They share this file so the two
 * cannot drift: a diagram the importer would find is the diagram the
 * reader finds, at the same size, read the same way.
 */

/** The width every page is rendered at for detection. The detector and
    CellNet were tuned at this size; the evidence fractions derive from it. */
export const RENDER_WIDTH = 1400;

/**
 * pdf.js, with its worker pointed at the copy Vite bundles. Loaded lazily
 * — it is the heaviest thing in the app and most sessions never open a
 * PDF — and configured once: GlobalWorkerOptions is global.
 */
export async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/**
 * The options every getDocument call here carries. Scanned books embed
 * JBIG2/JPX images; npm's pdfjs-dist ships only the JS fallback decoders,
 * so the doomed wasm fetch is skipped up front.
 */
export const PDF_OPTIONS = {
  useWasm: false,
  get wasmUrl(): string {
    return `${window.location.origin}/pdfjs-wasm/`;
  },
};

/**
 * One page of the PDF at the size the whole importer assumes.
 *
 * The page comes back with its canvas because the scan reads the page's
 * words from the same proxy, and fetching it again is a second parse.
 */
export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNo: number,
): Promise<{ page: PDFPageProxy; canvas: HTMLCanvasElement }> {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({
    canvas,
    canvasContext: canvas.getContext('2d')!,
    viewport,
    // Renders a page in chunks scheduled on requestAnimationFrame, which a
    // window nobody is looking at never gets — measured, zero callbacks in
    // two seconds — so a background import stops on page one and says
    // nothing. `print` is the one intent pdf.js does NOT schedule on frames
    // (`useRequestAnimationFrame: !intentPrint`); the same page that never
    // finished hidden then rendered in 36 ms.
    //
    // It is a rendering intent, not a printer: what it changes is annotation
    // appearance and optional-content visibility, neither of which a scanned
    // page has. Checked rather than assumed — display and print were
    // byte-identical over the whole canvas on both a vector page and an
    // image page, which are the two paths a book can take.
    intent: 'print',
  }).promise;
  return { page, canvas };
}

/**
 * A shelf-sized JPEG of a rendered page: what a book's cover is made of,
 * on the puzzle shelf and in the library alike. 480 wide is the widest a
 * shelf card draws one.
 */
export function thumbnailDataUrl(page: HTMLCanvasElement, width = 480): string {
  const h = Math.round((page.height / page.width) * width);
  const thumb = document.createElement('canvas');
  thumb.width = width;
  thumb.height = h;
  thumb.getContext('2d')!.drawImage(page, 0, 0, width, h);
  return thumb.toDataURL('image/jpeg', 0.82);
}

/**
 * Open a picked file once and learn what the upload path wants to know:
 * how many pages it has and what its first page looks like. Pages is 0
 * when the file does not open as a PDF at all; the cover is null when the
 * file opened but its first page would not render.
 */
export async function inspectPdf(file: File): Promise<{ pages: number; cover: string | null }> {
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: await file.arrayBuffer(), ...PDF_OPTIONS });
    const pdf = await task.promise;
    const pages = pdf.numPages;
    let cover: string | null = null;
    if (pages > 0) {
      try {
        cover = thumbnailDataUrl((await renderPdfPage(pdf, 1)).canvas);
      } catch {
        cover = null;
      }
    }
    await task.destroy();
    return { pages, cover };
  } catch {
    return { pages: 0, cover: null };
  }
}

/** One diagram's place on its page, in render pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One diagram as read off a rendered page. */
export interface PageDiagram {
  /** Where on the page, in render pixels of the canvas it was read from. */
  rect: Rect;
  /** The crop, as a data URL. */
  dataUrl: string;
  /** The full FEN CellNet read (white to move, no castling), or null. */
  fen: string | null;
  /** How many cells were read with low confidence. */
  uncertain: number;
}

/**
 * Find every diagram on a rendered page and read each one.
 *
 * Cut the page up first and hand each board to the classifier as it is
 * cut, so the workers are reading board one while board two is still
 * being warped. `pause` runs between cuts to keep the app usable: a crop
 * is ~60 ms of main thread and a page holds eight of them. `templates`,
 * when a book has any, are the fallback for a board the classifier could
 * not read.
 */
export async function readDiagramsOnPage(
  canvas: HTMLCanvasElement,
  classify: (board: Gray) => Promise<CellReading[] | null>,
  templates: Template[],
  pause: () => Promise<void>,
): Promise<PageDiagram[]> {
  const rects = detectDiagrams(grayFromCanvas(canvas));
  const cutting: {
    dataUrl: string;
    features: Uint8Array[];
    cells: Promise<CellReading[] | null>;
  }[] = [];
  for (const rect of rects) {
    const { dataUrl, board, features } = cropDiagram(canvas, rect);
    cutting.push({ dataUrl, features, cells: classify(board) });
    await pause();
  }
  const out: PageDiagram[] = [];
  for (const [at, rect] of rects.entries()) {
    const { dataUrl, features, cells: reading } = cutting[at]!;
    let cells = await reading;
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
    out.push({ rect, dataUrl, fen, uncertain });
  }
  return out;
}
