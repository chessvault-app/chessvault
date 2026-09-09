import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * The one open PDF the reader keeps after it has left the book.
 *
 * Opening a document is not free and the cost does not shrink with the
 * page you land on: pdf.js finishes an open by fetching the LAST page,
 * which walks the page tree and touches every page object in the file
 * (see `RANGE_CHUNK` in pdfViewer.tsx for what that costs and why). None
 * of that changes between one visit to a book and the next, so the reader
 * hands the document here on its way out instead of destroying it, and
 * takes it back if the reader returns to the same book.
 *
 * ONE document, not a few. What is held is a pdf.js worker and every
 * chunk that book has fetched: measured on the 380 MB scan, the browser
 * sat at 149 MB on the shelf, 166 MB with the reader open on it, and
 * 168 MB back on the shelf with the document held. So holding costs
 * about 20 MB and leaving the book now frees almost nothing, which is
 * the trade being made. The reader's own rule about memory is that a
 * phone's tab survives or does not on exactly this, so a second book
 * replaces the first rather than joining it. A book is held until
 * another is opened, the page is reloaded, or the file behind it changes.
 *
 * What it buys, on a 5 Mbit link at 80 ms: opening that book cold took
 * 31.8 s and 470 range requests, and going to the shelf and back took
 * 0.02 s and none at all.
 *
 * Ownership moves with the document: `takePdf` removes it, and whoever
 * took it either uses it or hands it back. Nothing here is ever destroyed
 * while a reader is holding it, because a reader holding it means it is
 * not in here.
 */
let held: { key: string; doc: PDFDocumentProxy } | null = null;

/**
 * What makes two opens the same open: the book, and the file behind it.
 * The size is what versions the PDF's URL (see `pdfUrl`), so a replaced
 * file of a different length is a different key and the old document is
 * not offered for it. A replacement that happens to be the same length
 * is not, which is why `dropPdf` exists and `replaceBookPdf` calls it.
 */
export const pdfKey = (id: string, bytes: number): string => `${id}:${bytes}`;

/** Keep this document for the next visit, destroying whatever was held. */
export function holdPdf(key: string, doc: PDFDocumentProxy): void {
  if (held?.doc === doc) return;
  const previous = held;
  held = { key, doc };
  if (previous) void previous.doc.loadingTask.destroy();
}

/** The held document for this key, now the caller's, or null. */
export function takePdf(key: string): PDFDocumentProxy | null {
  if (held?.key !== key) return null;
  const { doc } = held;
  held = null;
  return doc;
}

/**
 * Forget a book's document: its file has changed under it, or it is gone.
 * With no id, forget whatever is held.
 */
export function dropPdf(id?: string): void {
  if (!held) return;
  if (id !== undefined && !held.key.startsWith(`${id}:`)) return;
  const { doc } = held;
  held = null;
  void doc.loadingTask.destroy();
}

/** The book whose document is held, if any. For tests. */
export const heldBookKey = (): string | null => held?.key ?? null;
