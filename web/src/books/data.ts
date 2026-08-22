import { api, apiUpload } from '@/lib/api';
import { inspectPdf } from '@/puzzles/ocr/pdfPage';

/**
 * The book library's model and the one module every library page shares:
 * the shelf, the reader, and the puzzle importer that files a PDF here.
 *
 * Kept deliberately small. A library book is a file with a title and a
 * place the reader left off; everything heavy — the PDF, the pages, the
 * diagrams — is asked for as it is needed.
 */

export interface LibraryBook {
  id: string;
  title: string;
  /** The uploaded file's own name, or null. */
  name: string | null;
  bytes: number;
  pages: number | null;
  addedAt: string | null;
  lastPage: number | null;
  cover: boolean;
}

/** Where a printed diagram sits on its page, in page fractions. */
export interface DiagramRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One diagram the reader has read off a page: where, and what it showed. */
export interface PageDiagramRecord {
  rect: DiagramRect;
  /** The position's placement (and what else was known), or null when
      the reader could not make it out. */
  fen: string | null;
}

/**
 * The most a PDF may be. Matches the server's cap and the importer's:
 * pdf.js holds what it renders in memory, and a phone tab is killed far
 * below this.
 */
export const MAX_PDF_BYTES = 300 * 1024 * 1024;

/**
 * The shelf's list, remembered between pages the way the puzzle shelf's
 * is: going to a book and back must not redraw the shelf from nothing.
 */
export const libraryMemory = {
  books: null as LibraryBook[] | null,
};

export function forgetLibrary(): void {
  libraryMemory.books = null;
}

export async function loadBooks(force = false): Promise<LibraryBook[]> {
  if (!force && libraryMemory.books) return libraryMemory.books;
  const body = await api<{ books: LibraryBook[] }>('/api/books');
  libraryMemory.books = body.books;
  return body.books;
}

export const pdfUrl = (id: string): string => `/api/books/${encodeURIComponent(id)}/pdf`;
export const coverUrl = (id: string): string => `/api/books/${encodeURIComponent(id)}/cover.jpg`;

/**
 * "chess-evolution_1.pdf" is how a scan arrives; "chess evolution 1" is a
 * title. Underscores and dots are separator noise; hyphens can be real
 * (a year range) so they stay.
 */
export function suggestTitle(file: File): string | null {
  const title = file.name
    .replace(/\.pdf$/i, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return title.length > 0 ? title : null;
}

const query = (params: Record<string, string | number | null | undefined>): string =>
  Object.entries(params)
    .filter((e): e is [string, string | number] => e[1] !== null && e[1] !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

/**
 * Put a PDF in the library. The file is opened once here, for its page
 * count and its first page as the cover, then streamed up; the cover
 * follows as a second, best-effort request — a book without a thumbnail
 * is still a book.
 *
 * Throws what api() throws; the caller owns the message.
 */
export async function uploadBook(
  file: File,
  options: { title: string; onProgress?: (sent: number, total: number) => void },
): Promise<string> {
  const { pages, cover } = await inspectPdf(file);
  const made = await apiUpload<{ id: string }>(
    `/api/books?${query({ title: options.title, name: file.name, pages: pages || null })}`,
    file,
    { method: 'POST', contentType: 'application/pdf', onProgress: options.onProgress },
  );
  if (cover) {
    await api(`/api/books/${encodeURIComponent(made.id)}/cover`, {
      method: 'PUT',
      json: { image: cover },
    }).catch(() => undefined);
  }
  forgetLibrary();
  return made.id;
}

/** A better file behind the same title; the cover follows it. */
export async function replaceBookPdf(
  id: string,
  file: File,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const { pages, cover } = await inspectPdf(file);
  await apiUpload(
    `/api/books/${encodeURIComponent(id)}/pdf?${query({ name: file.name, pages: pages || null })}`,
    file,
    { method: 'PUT', contentType: 'application/pdf', onProgress },
  );
  if (cover) {
    await api(`/api/books/${encodeURIComponent(id)}/cover`, {
      method: 'PUT',
      json: { image: cover },
    }).catch(() => undefined);
  }
  forgetLibrary();
}

export async function renameBook(id: string, title: string): Promise<void> {
  await api(`/api/books/${encodeURIComponent(id)}`, { method: 'PATCH', json: { title } });
  forgetLibrary();
}

export async function removeBook(id: string): Promise<void> {
  await api(`/api/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
  forgetLibrary();
}

/** Best-effort: a page that fails to save is a page to find again. */
export function saveReadingPage(id: string, page: number): void {
  void api(`/api/books/${encodeURIComponent(id)}/reading`, { method: 'PUT', json: { page } })
    .then(() => {
      // The shelf shows "Page n of N"; keep its copy honest without a
      // round trip.
      const book = libraryMemory.books?.find((b) => b.id === id);
      if (book) book.lastPage = page;
    })
    .catch(() => undefined);
}

export async function loadDiagrams(id: string): Promise<Record<string, PageDiagramRecord[]>> {
  try {
    const body = await api<{ pages: Record<string, PageDiagramRecord[]> }>(
      `/api/books/${encodeURIComponent(id)}/diagrams`,
    );
    return body.pages;
  } catch {
    return {};
  }
}

export function saveDiagrams(id: string, page: number, diagrams: PageDiagramRecord[]): void {
  void api(`/api/books/${encodeURIComponent(id)}/diagrams/${page}`, {
    method: 'PUT',
    json: { diagrams },
  }).catch(() => undefined);
}
