import { Hono, type Context } from 'hono';
import { randomBytes } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { renameRetrying, writeAtomic } from './atomic.ts';
import { VAULT } from './paths.ts';

/**
 * The book library — the PDFs a user uploads to READ in the app, beside a
 * board. Any chess book: strategy, game collections, openings, puzzles.
 * Vault data, one directory per book:
 *
 *   vault/books/<id>/book.pdf       the file itself, served with Range
 *   vault/books/<id>/book.json      { title, name, pages, addedAt }
 *   vault/books/<id>/reading.json   { page, at }   where the reader left off
 *   vault/books/<id>/cover.jpg      page 1, rendered by the client
 *   vault/books/<id>/diagrams.json  { [page]: [{ rect, fen }] }
 *
 * Separate from vault/puzzlebooks/, which is a different thing: a puzzle
 * book is the puzzles read OUT of a book, trained with progress; a library
 * book is the book. A puzzle book imported from a PDF gets its PDF filed
 * here too and keeps a pointer to it (`pdfBook` in its book.json), so the
 * one upload serves both.
 *
 * The folder is an id — `b` and sixteen hex characters — for the reasons
 * puzzlebooks.ts records: a title is something people change, and an id
 * is something nothing can be left pointing at.
 *
 * diagrams.json is a cache the reader fills as it goes: the diagrams it
 * found on a page and the position it read off each, so the hotspot that
 * sets a board up from a printed diagram costs one detection per page per
 * vault rather than per device. It is dropped when the PDF is replaced.
 */

const BOOKS_DIR = resolve(VAULT, 'books');

/**
 * The most a PDF may be. The same figure as the importer's own intake
 * cap (web/src/puzzles/PdfImport.tsx): a scanned book is tens of
 * megabytes, a big one a couple of hundred, and anything beyond that is
 * not something a browser could open page by page anyway.
 */
export const PDF_CAP = 300 * 1024 * 1024;

const newBookId = (): string => `b${randomBytes(8).toString('hex')}`;
export const isLibraryBookId = (name: string): boolean => /^b[0-9a-f]{16}$/.test(name);

/**
 * Whether this library book still has its file — the one question the
 * puzzle shelf asks, so a puzzle book whose PDF was removed from the
 * library simply stops offering to be read.
 */
export function libraryBookHasPdf(id: string, dir: string = BOOKS_DIR): boolean {
  return isLibraryBookId(id) && existsSync(resolve(dir, id, 'book.pdf'));
}

interface BookMeta {
  title: string;
  /** The uploaded file's own name, kept for the shelf's tooltip. */
  name?: string;
  /** Page count as the client read it; null when it could not. */
  pages: number | null;
  addedAt: string;
}

interface Reading {
  page: number;
  at: string;
}

interface Diagram {
  rect: { x: number; y: number; w: number; h: number };
  fen: string | null;
}

/** How many diagrams one page may claim. A problems page prints eight. */
const MAX_DIAGRAMS_PER_PAGE = 32;

/** The piece-placement field of a FEN: ranks of pieces and digits. */
const FEN_PLACEMENT = /^([pnbrqkPNBRQK1-8]{1,8}\/){7}[pnbrqkPNBRQK1-8]{1,8}$/;

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

const roundRect = (rect: Diagram['rect']): Diagram['rect'] => {
  const to4 = (n: number): number => Math.round(n * 10000) / 10000;
  return { x: to4(rect.x), y: to4(rect.y), w: to4(rect.w), h: to4(rect.h) };
};

function cleanDiagram(raw: unknown): Diagram | null {
  if (!raw || typeof raw !== 'object') return null;
  const { rect, fen } = raw as Partial<Diagram>;
  if (
    !rect ||
    !(['x', 'y', 'w', 'h'] as const).every(
      (k) => typeof rect[k] === 'number' && rect[k] >= 0 && rect[k] <= 1,
    )
  ) {
    return null;
  }
  if (fen !== null && fen !== undefined) {
    // A whole FEN or just its placement; either way the placement must
    // be one, and the rest is carried as given (the reader adds side to
    // move when it knows it).
    if (typeof fen !== 'string' || fen.length > 100) return null;
    if (!FEN_PLACEMENT.test(fen.split(' ')[0] ?? '')) return null;
  }
  return { rect: roundRect(rect), fen: fen ?? null };
}

const pagesParam = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function booksApi(dir: string = BOOKS_DIR): Hono {
  const bookDir = (id: string): string => resolve(dir, id);
  const pdfPath = (id: string): string => resolve(bookDir(id), 'book.pdf');
  const metaPath = (id: string): string => resolve(bookDir(id), 'book.json');
  const readingPath = (id: string): string => resolve(bookDir(id), 'reading.json');
  const coverPath = (id: string): string => resolve(bookDir(id), 'cover.jpg');
  const diagramsPath = (id: string): string => resolve(bookDir(id), 'diagrams.json');

  const validBook = (id: string): boolean => isLibraryBookId(id) && existsSync(metaPath(id));

  /**
   * Stream an uploaded PDF into `book.pdf`, beside the target then renamed,
   * so a dropped connection leaves a .part rather than a truncated PDF
   * that opens as far as it goes.
   *
   * The route is exempt from the API-wide body cap (which would buffer
   * the whole file to measure it), so it enforces its own on the bytes as
   * they stream past, and checks the first five of them are a PDF's —
   * the cheapest way to refuse a mis-picked file before it fills a folder.
   */
  async function receivePdf(c: Context, id: string): Promise<Response | null> {
    if (!c.req.raw.body) return c.json({ error: 'empty upload' }, 400);
    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > PDF_CAP) {
      return c.json({ error: 'that PDF is too big (300 MB cap)' }, 413);
    }
    mkdirSync(bookDir(id), { recursive: true });
    const target = pdfPath(id);
    const part = `${target}.part`;
    try {
      let seen = 0;
      let head = Buffer.alloc(0);
      await pipeline(
        Readable.fromWeb(c.req.raw.body as NodeReadableStream),
        async function* (source) {
          for await (const chunk of source) {
            const buf = chunk as Buffer;
            seen += buf.byteLength;
            if (seen > PDF_CAP) throw new Error('too big');
            if (head.length < 5) {
              head = Buffer.concat([head, buf.subarray(0, 5 - head.length)]);
              if (head.length >= 5 && head.toString('latin1') !== '%PDF-') {
                throw new Error('not a pdf');
              }
            }
            yield buf;
          }
          if (head.length < 5) throw new Error('not a pdf');
        },
        createWriteStream(part),
      );
      renameRetrying(part, target);
    } catch (error) {
      rmSync(part, { force: true });
      const why = (error as Error).message;
      if (why === 'too big') return c.json({ error: 'that PDF is too big (300 MB cap)' }, 413);
      if (why === 'not a pdf') return c.json({ error: 'that file is not a PDF' }, 400);
      return c.json({ error: `upload failed: ${why}` }, 500);
    }
    return null;
  }

  const lastPage = (id: string): number | null => {
    const reading = readJson<Partial<Reading>>(readingPath(id), {});
    return typeof reading.page === 'number' ? reading.page : null;
  };

  const api = new Hono();

  api.get('/books', (c) => {
    if (!existsSync(dir)) return c.json({ books: [] });
    const books = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && validBook(e.name))
      .map((e) => {
        const id = e.name;
        const meta = readJson<Partial<BookMeta>>(metaPath(id), {});
        const hasPdf = existsSync(pdfPath(id));
        return {
          id,
          title: meta.title ?? id,
          name: meta.name ?? null,
          bytes: hasPdf ? statSync(pdfPath(id)).size : 0,
          pages: meta.pages ?? null,
          addedAt: meta.addedAt ?? null,
          lastPage: lastPage(id),
          cover: existsSync(coverPath(id)),
        };
      })
      .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
    return c.json({ books });
  });

  /**
   * Upload a book. The body is the PDF; the title, the file's own name
   * and the page count (the client has already opened the file to check
   * it is one) ride on the query, since a raw body has no room for them.
   */
  api.post('/books', async (c) => {
    const title = (c.req.query('title') ?? '').trim().normalize('NFC');
    if (!title) return c.json({ error: 'a book needs a title' }, 400);
    const id = newBookId();
    const refused = await receivePdf(c, id);
    if (refused) {
      rmSync(bookDir(id), { recursive: true, force: true });
      return refused;
    }
    const meta: BookMeta = {
      title,
      pages: pagesParam(c.req.query('pages')),
      addedAt: new Date().toISOString(),
    };
    const name = c.req.query('name')?.trim();
    if (name) meta.name = name.slice(0, 200);
    writeJson(metaPath(id), meta);
    return c.json({ id, bytes: statSync(pdfPath(id)).size, pages: meta.pages });
  });

  /**
   * Replace the file behind a book — a better scan of the same title.
   * The reader's place is kept unless the new file is shorter than where
   * it was; the diagram cache goes, since it described the old pages.
   */
  api.put('/books/:id/pdf', async (c) => {
    const id = c.req.param('id');
    if (!validBook(id)) return c.json({ error: 'unknown book' }, 404);
    const refused = await receivePdf(c, id);
    if (refused) return refused;
    const meta = readJson<Partial<BookMeta>>(metaPath(id), {});
    const pages = pagesParam(c.req.query('pages'));
    const name = c.req.query('name')?.trim();
    writeJson(metaPath(id), {
      ...meta,
      pages,
      ...(name ? { name: name.slice(0, 200) } : {}),
    });
    rmSync(diagramsPath(id), { force: true });
    const at = lastPage(id);
    if (pages !== null && at !== null && at > pages) rmSync(readingPath(id), { force: true });
    return c.json({ id, bytes: statSync(pdfPath(id)).size, pages });
  });

  /**
   * The file, with Range honoured. pdf.js asks for the bytes of a page
   * when that page is shown, which is what lets a phone open a scanned
   * book at page 300 without first downloading pages 1–299 — and it only
   * does so when the first response carries accept-ranges and an exact
   * content-length. Streamed, never read whole: the same reasoning as the
   * updates route in index.ts, which this copies.
   */
  api.get('/books/:id/pdf', (c) => {
    const id = c.req.param('id');
    if (!validBook(id) || !existsSync(pdfPath(id))) return c.json({ error: 'unknown book' }, 404);
    const path = pdfPath(id);
    const stat = statSync(path);
    const size = stat.size;
    const headers: Record<string, string> = {
      'content-type': 'application/pdf',
      // Revalidated on every open (no-cache is not no-store): the etag
      // answers a reopened book with a 304, and a REPLACED file is seen
      // at once rather than after the hour a max-age would have given the
      // old one — which is exactly the case replace exists for.
      'cache-control': 'private, no-cache',
      etag: `"${size}-${Math.round(stat.mtimeMs)}"`,
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
    };
    const match = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        return c.body(null, 416, { 'content-range': `bytes */${size}` });
      }
      const part = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
      return c.body(part, 206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      });
    }
    const whole = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return c.body(whole, 200, { ...headers, 'content-length': String(size) });
  });

  api.patch('/books/:id', async (c) => {
    const id = c.req.param('id');
    if (!validBook(id)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { title?: string };
    const title = body.title?.trim().normalize('NFC');
    if (!title) return c.json({ error: 'a book needs a title' }, 400);
    const meta = readJson<Partial<BookMeta>>(metaPath(id), {});
    writeJson(metaPath(id), { ...meta, title });
    return c.json({ id, title });
  });

  api.delete('/books/:id', (c) => {
    const id = c.req.param('id');
    if (!validBook(id)) return c.json({ error: 'unknown book' }, 404);
    rmSync(bookDir(id), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  api.put('/books/:id/reading', async (c) => {
    const id = c.req.param('id');
    if (!validBook(id)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { page?: unknown };
    const page = body.page;
    const meta = readJson<Partial<BookMeta>>(metaPath(id), {});
    if (
      typeof page !== 'number' ||
      !Number.isInteger(page) ||
      page < 1 ||
      (typeof meta.pages === 'number' && page > meta.pages)
    ) {
      return c.json({ error: 'no such page' }, 400);
    }
    writeJson(readingPath(id), { page, at: new Date().toISOString() } satisfies Reading);
    return c.json({ page });
  });

  api.put('/books/:id/cover', async (c) => {
    const id = c.req.param('id');
    if (!validBook(id)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { image?: string };
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image ?? '');
    if (!match) return c.json({ error: 'expected a jpeg/png data URL' }, 400);
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.length > 2_000_000) return c.json({ error: 'cover too large' }, 400);
    writeFileSync(coverPath(id), bytes);
    return c.json({ ok: true });
  });

  api.get('/books/:id/cover.jpg', (c) => {
    const id = c.req.param('id');
    if (!validBook(id) || !existsSync(coverPath(id))) return c.json({ error: 'no cover' }, 404);
    // no-cache for the same reason as the PDF's: a replaced book brings a
    // new cover, and the shelf should show it on the next visit.
    return c.body(new Uint8Array(readFileSync(coverPath(id))), 200, {
      'content-type': 'image/jpeg',
      'cache-control': 'private, no-cache',
    });
  });

  api.get('/books/:id/diagrams', (c) => {
    const id = c.req.param('id');
    if (!validBook(id)) return c.json({ error: 'unknown book' }, 404);
    return c.json({ pages: readJson<Record<string, Diagram[]>>(diagramsPath(id), {}) });
  });

  /**
   * What the reader found on one page. An empty list is a real answer —
   * "this page has no diagrams" — and is kept, so the page is not read
   * again next time.
   */
  api.put('/books/:id/diagrams/:page', async (c) => {
    const id = c.req.param('id');
    if (!validBook(id)) return c.json({ error: 'unknown book' }, 404);
    const page = Number(c.req.param('page'));
    if (!Number.isInteger(page) || page < 1) return c.json({ error: 'no such page' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { diagrams?: unknown };
    if (!Array.isArray(body.diagrams)) return c.json({ error: 'expected diagrams' }, 400);
    const diagrams = body.diagrams
      .map(cleanDiagram)
      .filter((d): d is Diagram => d !== null)
      .slice(0, MAX_DIAGRAMS_PER_PAGE);
    const all = readJson<Record<string, Diagram[]>>(diagramsPath(id), {});
    all[String(page)] = diagrams;
    writeJson(diagramsPath(id), all);
    return c.json({ page, diagrams });
  });

  return api;
}
