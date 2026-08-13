import type { FoundDiagram, PageGeometry } from './importJob';
import type { TextPage } from '@shared/bookImport';

/**
 * Where a half-finished book scan is kept.
 *
 * A scan is the longest thing this app does — a nine-hundred page book is
 * rendered, cropped and classified page by page — and it lived only in a
 * tab's memory. A reload, a crash, or iOS deciding to reclaim a
 * backgrounded PWA threw all of it away, and the only way forward was to
 * start the book again from page one.
 *
 * The first half of the pipeline is per-page and accumulates nothing
 * across pages, which is what makes this possible at all: a checkpoint is
 * three arrays and a page number, and resuming is continuing the loop.
 * The second half — numbering, notation, replaying the printed solutions
 * — needs the whole book at once, and is quick, so it is never
 * checkpointed; it simply runs at the end as before.
 *
 * IndexedDB rather than localStorage: the crops alone are tens of
 * megabytes, and the source PDF is stored beside them so a resume needs
 * nothing from the user. Blobs go in as they are, with no base64 tax.
 */
const DB = 'chess-vault-import';
const STORE = 'scans';
const VERSION = 1;

export interface ImportCheckpoint {
  slug: string;
  /** The book's own PDF, so resuming asks for nothing. */
  file: File;
  /**
   * Identifies the FILE, not the book. Picking a different PDF for the
   * same book must start over rather than resume into a scan of another
   * document — the page numbers would line up and mean nothing.
   */
  fingerprint: string;
  /** Pages completed. The scan resumes at this + 1. */
  page: number;
  pages: number;
  results: FoundDiagram[];
  texts: TextPage[];
  geometry: PageGeometry[];
  updatedAt: number;
}

/** What the shelf needs to offer a resume, without loading the PDF. */
export type CheckpointSummary = Pick<
  ImportCheckpoint,
  'slug' | 'page' | 'pages' | 'updatedAt'
> & { diagrams: number };

export const fingerprintOf = (file: File): string =>
  `${file.name}:${file.size}:${file.lastModified}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'slug' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB unavailable'));
  });
}

/** Every failure here is survivable: a checkpoint that cannot be written
    costs a resume, not the scan. Nothing in this module throws. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      req.onsuccess = () => resolve((req.result ?? null) as T | null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function saveCheckpoint(checkpoint: ImportCheckpoint): Promise<void> {
  await withStore('readwrite', (store) => store.put(checkpoint));
}

export async function readCheckpoint(slug: string): Promise<ImportCheckpoint | null> {
  return withStore<ImportCheckpoint>('readonly', (store) => store.get(slug));
}

export async function clearCheckpoint(slug: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(slug));
}

/**
 * Summaries for every book with an unfinished scan.
 *
 * Reads whole records — IndexedDB has no projection — and keeps only the
 * few fields the shelf shows, so the PDFs and crops are not held in
 * memory behind a list of books.
 */
export async function listCheckpoints(): Promise<CheckpointSummary[]> {
  const all = await withStore<ImportCheckpoint[]>('readonly', (store) => store.getAll());
  return (all ?? []).map((c) => ({
    slug: c.slug,
    page: c.page,
    pages: c.pages,
    updatedAt: c.updatedAt,
    diagrams: c.results.length,
  }));
}
