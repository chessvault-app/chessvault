import { create } from 'zustand';

import { useImportJob } from '@/puzzles/importJob';
import { classifyInWorker, leasePool, yieldToUi } from '@/puzzles/ocr/cellnetPool';
import { loadPdfjs, PDF_OPTIONS, readDiagramsOnPage, renderPdfPage } from '@/puzzles/ocr/pdfPage';

import { loadBooks, loadDiagrams, pdfUrl, saveDiagrams, type PageDiagramRecord } from './data';

/**
 * Reading a book's diagrams is a one-time job per book, done when the
 * book arrives — not page by page while it is being read. Every page is
 * rendered at detection size and read with the importer's own detector
 * and CellNet (ocr/pdfPage.ts), and the result is kept on the server per
 * page; the reader then finds every page already read and never reads
 * under a scroll. Pages the server already has are skipped, so the job
 * can be run again to finish an interrupted pass, and run on a book
 * that arrived before this existed.
 *
 * A BACKGROUND job, like the puzzle importer's: it runs in the page while
 * the shelf is browsed and reports its progress; one at a time, because
 * a second one would share the main thread with the first — a book asked
 * for while another is being read waits its turn.
 *
 * And a MANDATORY one: every book on the shelf is read, and the reader
 * starts (or carries on) the pass for a book it opens that is not read
 * through yet, showing the progress over the page. Nothing is read twice:
 * the puzzle importer's scan of the same PDF files its pages here as it
 * goes (importJob.ts, `libraryBook`), and a book under that scan is left
 * to it.
 */

export interface DiagramJobState {
  bookId: string | null;
  page: number;
  pages: number;
  status: 'idle' | 'running' | 'done' | 'failed';
  error: string | null;
  /** Books waiting their turn, in the order they were asked for. */
  queue: string[];
  /** Read `bookId` — now, or after the book being read and any queued before it. */
  start: (bookId: string) => Promise<void>;
}

export const useDiagramJob = create<DiagramJobState>()((set, get) => ({
  bookId: null,
  page: 0,
  pages: 0,
  status: 'idle',
  error: null,
  queue: [],
  start: async (bookId) => {
    const { status, queue } = get();
    if (status === 'running') {
      if (get().bookId !== bookId && !queue.includes(bookId)) set({ queue: [...queue, bookId] });
      return;
    }
    // The importer reading this very PDF files every page here itself.
    const scan = useImportJob.getState();
    if (scan.status === 'scanning' && scan.libraryBook === bookId) return;
    set({ bookId, page: 0, pages: 0, status: 'running', error: null });
    try {
      const book = (await loadBooks(true)).find((b) => b.id === bookId);
      if (!book) throw new Error('no such book');
      const done = await loadDiagrams(bookId);
      const pdfjs = await loadPdfjs();
      const task = pdfjs.getDocument({
        url: pdfUrl(bookId, book.bytes),
        rangeChunkSize: 256 * 1024,
        ...PDF_OPTIONS,
      });
      const doc = await task.promise;
      // The boards go to the importer's CellNet pool (ocr/cellnetPool.ts):
      // one board is ~950 ms of inference, a puzzle page has eight, and on
      // the main thread a page took five seconds; the pool reads them side
      // by side. The lease keeps the workers alive while the book runs and
      // hands them back after — a phone should not keep six of them.
      const release = leasePool();
      try {
        set({ pages: doc.numPages });
        for (let n = 1; n <= doc.numPages; n++) {
          set({ page: n });
          if (done.has(n)) continue;
          const { canvas } = await renderPdfPage(doc, n);
          const found = await readDiagramsOnPage(canvas, classifyInWorker, [], yieldToUi);
          const records: PageDiagramRecord[] = found.map((d) => ({
            rect: {
              x: d.rect.x / canvas.width,
              y: d.rect.y / canvas.height,
              w: d.rect.w / canvas.width,
              h: d.rect.h / canvas.height,
            },
            fen: d.fen && d.uncertain <= 4 ? d.fen : null,
          }));
          saveDiagrams(bookId, n, records);
          await yieldToUi();
        }
      } finally {
        release();
        await task.destroy();
      }
      set({ status: 'done' });
    } catch (e) {
      set({ status: 'failed', error: (e as Error).message });
    }
    const [next, ...rest] = get().queue;
    if (next) {
      set({ queue: rest });
      void get().start(next);
    }
  },
}));
