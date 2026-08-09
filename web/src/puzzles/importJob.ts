import { create } from 'zustand';
import type { CellReading, Template } from './ocr/classify';
import { classifyBoard, labelsToFen } from './ocr/classify';
import { grayFromCanvas, cropDiagram } from './ocr/browser';
import { detectDiagrams } from './ocr/detect';
import type { Gray } from './ocr/image';

export interface FoundDiagram {
  page: number;
  dataUrl: string;
  fen: string | null;
  uncertain: number;
  selected: boolean;
}

interface ImportJobState {
  /** Book the scan belongs to; null = idle. */
  slug: string | null;
  status: 'idle' | 'scanning' | 'done' | 'failed';
  page: number;
  pages: number;
  found: FoundDiagram[];
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
  error: null,

  start: (slug, file, templates) => {
    if (get().status === 'scanning') return;
    set({ slug, status: 'scanning', page: 0, pages: 0, found: [], error: null });
    void scan(file, templates, set, get);
  },

  toggle: (index) =>
    set((s) => ({
      found: s.found.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f)),
    })),

  clear: () => set({ slug: null, status: 'idle', page: 0, pages: 0, found: [], error: null }),
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

      // The first page becomes the book's shelf cover — generated here from
      // the PDF, so a book gets a thumbnail with no offline render step.
      if (pageNo === 1) {
        const slug = get().slug;
        if (slug) void uploadCover(slug, canvas);
      }

      for (const rect of detectDiagrams(grayFromCanvas(canvas))) {
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
        results.push({ page: pageNo, dataUrl, fen, uncertain, selected: true });
      }
      set({ found: [...results] });
      // Yield so navigation and rendering stay smooth between pages.
      await new Promise((r) => setTimeout(r, 0));
    }
    set({ status: 'done' });
    if (results.length === 0) set({ error: 'No diagrams found in that PDF.', status: 'failed' });
  } catch (e) {
    set({ status: 'failed', error: `Could not read the PDF: ${(e as Error).message}` });
  }
}
