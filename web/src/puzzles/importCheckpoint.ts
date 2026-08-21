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
 * across pages, which is what makes this possible at all. The layout
 * matches that: one small MANIFEST per book (progress, and the PDF so a
 * resume asks for nothing) and one record PER PAGE holding what that page
 * contributed. Checkpointing a page writes that page and the manifest,
 * atomically, and nothing else — the first cut of this rewrote the whole
 * accumulated scan every page, so on a big book the last pages each
 * serialised tens of megabytes of crops to disk, O(n²) across the scan.
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
const PAGES = 'scan-pages';
const VERSION = 2;

/** The whole of a saved scan, as the resume path consumes it. */
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

/** The manifest row: everything except the per-page payloads. */
interface Manifest {
  slug: string;
  file: File;
  fingerprint: string;
  page: number;
  pages: number;
  /** Running diagram count, so the shelf list never reads the pages. */
  diagrams: number;
  updatedAt: number;
  /** Present only on records written by the v1 schema — see migration. */
  results?: FoundDiagram[];
  texts?: TextPage[];
  geometry?: PageGeometry[];
}

/** One page's contribution, keyed [slug, page]. */
export interface CheckpointPage {
  slug: string;
  page: number;
  results: FoundDiagram[];
  text: TextPage;
  geometry: PageGeometry;
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
      if (!req.result.objectStoreNames.contains(PAGES)) {
        req.result.createObjectStore(PAGES, { keyPath: ['slug', 'page'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB unavailable'));
  });
}

/** Every failure here is survivable: a checkpoint that cannot be written
    costs a resume, not the scan. Nothing in this module throws. */
async function withTx<T>(
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => IDBRequest | null,
): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction([STORE, PAGES], mode);
      const req = run(tx);
      let value: T | null = null;
      if (req) {
        req.onsuccess = () => {
          value = (req.result ?? null) as T | null;
        };
        req.onerror = () => {};
      }
      // Resolve on tx completion, not request success: a page write is
      // two puts, and "saved" must mean both are on disk.
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

const pageRange = (slug: string): IDBKeyRange =>
  IDBKeyRange.bound([slug, 0], [slug, Number.MAX_SAFE_INTEGER]);

/**
 * Record one finished page: that page's payload plus the refreshed
 * manifest, in one transaction — a checkpoint is either advanced whole or
 * not at all.
 */
export async function savePage(
  manifest: Omit<Manifest, 'results' | 'texts' | 'geometry'>,
  page: CheckpointPage,
): Promise<void> {
  await withTx('readwrite', (tx) => {
    tx.objectStore(PAGES).put(page);
    tx.objectStore(STORE).put(manifest);
    return null;
  });
}

/**
 * The saved scan, reassembled in page order.
 *
 * A record written by the v1 schema carried every page inside the
 * manifest; it is read as it is and rewritten in the split layout, so
 * the scan it belongs to keeps its progress across the upgrade.
 */
export async function readCheckpoint(slug: string): Promise<ImportCheckpoint | null> {
  const manifest = await withTx<Manifest>('readonly', (tx) => tx.objectStore(STORE).get(slug));
  if (!manifest) return null;

  // v1 record: the arrays live on the manifest itself. Migrate by
  // splitting them into page records, then serve the assembled result.
  if (manifest.results && manifest.texts && manifest.geometry) {
    const legacy = manifest as Required<Manifest>;
    await withTx('readwrite', (tx) => {
      for (const g of legacy.geometry) {
        tx.objectStore(PAGES).put({
          slug,
          page: g.page,
          results: legacy.results.filter((r) => r.page === g.page),
          text: legacy.texts.find((t) => t.page === g.page) ?? { page: g.page, width: 0, text: '', words: [] },
          geometry: g,
        } satisfies CheckpointPage);
      }
      tx.objectStore(STORE).put({
        slug,
        file: legacy.file,
        fingerprint: legacy.fingerprint,
        page: legacy.page,
        pages: legacy.pages,
        diagrams: legacy.results.length,
        updatedAt: legacy.updatedAt,
      } satisfies Manifest);
      return null;
    });
    return {
      slug,
      file: legacy.file,
      fingerprint: legacy.fingerprint,
      page: legacy.page,
      pages: legacy.pages,
      results: legacy.results,
      texts: legacy.texts,
      geometry: legacy.geometry,
      updatedAt: legacy.updatedAt,
    };
  }

  const pages =
    (await withTx<CheckpointPage[]>('readonly', (tx) =>
      tx.objectStore(PAGES).getAll(pageRange(slug)),
    )) ?? [];
  pages.sort((a, b) => a.page - b.page);
  return {
    slug,
    file: manifest.file,
    fingerprint: manifest.fingerprint,
    page: manifest.page,
    pages: manifest.pages,
    results: pages.flatMap((p) => p.results),
    texts: pages.map((p) => p.text),
    geometry: pages.map((p) => p.geometry),
    updatedAt: manifest.updatedAt,
  };
}

/**
 * Re-key a saved scan when its book's folder moves.
 *
 * A rename changes the slug (server/puzzlebooks.ts), and a scan of a
 * nine-hundred page book is the longest thing this app does — losing one
 * to a rename would be a worse bug than the one renaming fixes. Manifest
 * and pages move in ONE transaction, so a scan is never half-keyed.
 */
export async function renameCheckpoint(from: string, to: string): Promise<void> {
  if (from === to) return;
  await withTx('readwrite', (tx) => {
    const store = tx.objectStore(STORE);
    const manifests = store.get(from);
    manifests.onsuccess = () => {
      const manifest = manifests.result as Manifest | undefined;
      if (!manifest) return;
      store.delete(from);
      store.put({ ...manifest, slug: to });
    };
    const pages = tx.objectStore(PAGES);
    const found = pages.getAll(pageRange(from));
    found.onsuccess = () => {
      pages.delete(pageRange(from));
      for (const page of found.result as CheckpointPage[]) pages.put({ ...page, slug: to });
    };
    return null;
  });
}

export async function clearCheckpoint(slug: string): Promise<void> {
  await withTx('readwrite', (tx) => {
    tx.objectStore(PAGES).delete(pageRange(slug));
    tx.objectStore(STORE).delete(slug);
    return null;
  });
}

/**
 * Summaries for every book with an unfinished scan. Manifests only — the
 * crops and PDFs stay on disk behind a list of books.
 */
export async function listCheckpoints(): Promise<CheckpointSummary[]> {
  const all = await withTx<Manifest[]>('readonly', (tx) => tx.objectStore(STORE).getAll());
  return (all ?? []).map((c) => ({
    slug: c.slug,
    page: c.page,
    pages: c.pages,
    updatedAt: c.updatedAt,
    diagrams: c.results?.length ?? c.diagrams,
  }));
}
