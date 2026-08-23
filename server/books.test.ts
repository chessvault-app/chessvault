import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { booksApi } from './books.ts';
import { puzzleBooksApi } from './puzzlebooks.ts';

/** A small but real-looking PDF: the magic, then filler, then a trailer. */
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.alloc(4000, 0x41),
  Buffer.from('\n%%EOF\n'),
]);

describe('books api', () => {
  let dir: string;
  let shelfDir: string;
  let app: Hono;
  let id = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'books-'));
    shelfDir = mkdtempSync(join(tmpdir(), 'books-shelf-'));
    app = new Hono().route('/api', booksApi(dir, shelfDir));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shelfDir, { recursive: true, force: true });
  });

  const upload = (query: string, body: Buffer | string, headers: Record<string, string> = {}) =>
    app.request(`/api/books?${query}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : new Uint8Array(body),
      headers,
    });
  const json = (path: string, method: string, body: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('uploads a PDF and lists it', async () => {
    const res = await upload('title=My%20System&name=my-system.pdf&pages=12', PDF);
    expect(res.status).toBe(200);
    const made = await res.json();
    expect(made.id).toMatch(/^b[0-9a-f]{16}$/);
    expect(made.bytes).toBe(PDF.length);
    expect(made.pages).toBe(12);
    id = made.id;
    expect(readFileSync(join(dir, id, 'book.pdf')).equals(PDF)).toBe(true);

    const list = await (await app.request('/api/books')).json();
    expect(list.books).toHaveLength(1);
    expect(list.books[0]).toMatchObject({
      id,
      title: 'My System',
      name: 'my-system.pdf',
      bytes: PDF.length,
      pages: 12,
      lastPage: null,
      cover: false,
    });
  });

  it('refuses a body that is not a PDF, leaving nothing behind', async () => {
    const before = (await (await app.request('/api/books')).json()).books.length;
    const res = await upload('title=Nope', 'this is a text file pretending');
    expect(res.status).toBe(400);
    const after = (await (await app.request('/api/books')).json()).books.length;
    expect(after).toBe(before);
  });

  it('refuses an upload without a title, and one declaring more than the cap', async () => {
    expect((await upload('title=', PDF)).status).toBe(400);
    const res = await upload('title=Huge', PDF, { 'content-length': String(400 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it('serves the file whole, with the headers pdf.js needs to ask for ranges', async () => {
    const res = await app.request(`/api/books/${id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe(String(PDF.length));
    expect(res.headers.get('etag')).toBeTruthy();
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('honours byte ranges', async () => {
    const part = await app.request(`/api/books/${id}/pdf`, { headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 10-19/${PDF.length}`);
    expect(part.headers.get('content-length')).toBe('10');
    expect(Buffer.from(await part.arrayBuffer()).equals(PDF.subarray(10, 20))).toBe(true);

    const tail = await app.request(`/api/books/${id}/pdf`, { headers: { range: 'bytes=-5' } });
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer()).toString()).toBe('%EOF\n');

    const open = await app.request(`/api/books/${id}/pdf`, {
      headers: { range: `bytes=${PDF.length - 3}-` },
    });
    expect(open.status).toBe(206);
    expect(open.headers.get('content-range')).toBe(
      `bytes ${PDF.length - 3}-${PDF.length - 1}/${PDF.length}`,
    );
    // Drained: a response body left unread keeps the file's read stream
    // open, and on Windows an open file cannot be renamed over — which is
    // exactly what the replace test below does next.
    expect((await open.arrayBuffer()).byteLength).toBe(3);

    const beyond = await app.request(`/api/books/${id}/pdf`, {
      headers: { range: `bytes=${PDF.length}-` },
    });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${PDF.length}`);
  });

  it('remembers where the reader is, within the book', async () => {
    expect((await json(`/api/books/${id}/reading`, 'PUT', { page: 7 })).status).toBe(200);
    expect((await json(`/api/books/${id}/reading`, 'PUT', { page: 13 })).status).toBe(400);
    expect((await json(`/api/books/${id}/reading`, 'PUT', { page: 0 })).status).toBe(400);
    const list = await (await app.request('/api/books')).json();
    expect(list.books[0].lastPage).toBe(7);
  });

  it('keeps the diagrams read off a page, and only well-formed ones', async () => {
    const res = await json(`/api/books/${id}/diagrams/3`, 'PUT', {
      diagrams: [
        { rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }, fen: '8/8/8/8/8/8/8/K6k' },
        { rect: { x: 0.5, y: 0.2, w: 0.3, h: 0.3 }, fen: null },
        { rect: { x: 2, y: 0.2, w: 0.3, h: 0.3 }, fen: null },
        { rect: { x: 0.1, y: 0.6, w: 0.3, h: 0.3 }, fen: 'not a fen' },
      ],
    });
    expect(res.status).toBe(200);
    const saved = await (await app.request(`/api/books/${id}/diagrams`)).json();
    expect(saved.pages['3']).toHaveLength(2);
    expect(saved.pages['3'][0].fen).toBe('8/8/8/8/8/8/8/K6k');
    expect(saved.pages['3'][1].fen).toBeNull();
    // An empty page is a real answer and is kept.
    await json(`/api/books/${id}/diagrams/4`, 'PUT', { diagrams: [] });
    const again = await (await app.request(`/api/books/${id}/diagrams`)).json();
    expect(again.pages['4']).toEqual([]);
  });

  it('stores and serves a cover', async () => {
    const png = `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`;
    expect((await json(`/api/books/${id}/cover`, 'PUT', { image: png })).status).toBe(200);
    const res = await app.request(`/api/books/${id}/cover.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const list = await (await app.request('/api/books')).json();
    expect(list.books[0].cover).toBe(true);
  });

  it('bookmarks a book, and forgets the mark with the book', async () => {
    expect((await (await app.request('/api/books/bookmarks')).json()).ids).toEqual([]);
    const on = await json('/api/books/bookmarks/toggle', 'POST', { id });
    expect(on.status).toBe(200);
    expect((await on.json()).bookmarked).toBe(true);
    expect((await (await app.request('/api/books/bookmarks')).json()).ids).toEqual([id]);
    expect((await json('/api/books/bookmarks/toggle', 'POST', { id: 'bnotabook' })).status).toBe(404);
    const off = await json('/api/books/bookmarks/toggle', 'POST', { id });
    expect((await off.json()).bookmarked).toBe(false);
    expect((await (await app.request('/api/books/bookmarks')).json()).ids).toEqual([]);
    // Marked again, so the delete at the end of the suite can drop it.
    await json('/api/books/bookmarks/toggle', 'POST', { id });
  });

  it('renames', async () => {
    const res = await json(`/api/books/${id}`, 'PATCH', { title: '  My System, 2nd ed.  ' });
    expect(res.status).toBe(200);
    const list = await (await app.request('/api/books')).json();
    expect(list.books[0].title).toBe('My System, 2nd ed.');
    expect((await json(`/api/books/${id}`, 'PATCH', { title: '' })).status).toBe(400);
  });

  it('files books in collections: create, list, move books, rename, delete only when empty', async () => {
    // An empty collection exists once created, and is listed.
    expect((await json('/api/books/folders', 'POST', { name: ' Endgames ' })).status).toBe(200);
    expect((await json('/api/books/folders', 'POST', { name: '../x' })).status).toBe(400);
    let list = await (await app.request('/api/books')).json();
    expect(list.folders).toEqual(['Endgames']);
    expect(list.books[0].collection).toBeNull();

    // A book filed in it, and one uploaded straight into another.
    expect((await json(`/api/books/${id}`, 'PATCH', { collection: 'Endgames' })).status).toBe(200);
    const other = await (await upload('title=Openings%20book&collection=Openings', PDF)).json();
    list = await (await app.request('/api/books')).json();
    expect(list.folders).toEqual(['Endgames', 'Openings']);
    expect(list.books.find((b: { id: string }) => b.id === id).collection).toBe('Endgames');
    expect(list.books.find((b: { id: string }) => b.id === other.id).collection).toBe('Openings');
    expect((await json(`/api/books/${id}`, 'PATCH', { collection: '../x' })).status).toBe(400);
    expect((await json(`/api/books/${id}`, 'PATCH', {})).status).toBe(400);

    // Renaming a collection carries its books along.
    const moved = await json('/api/books/folders/move', 'POST', { from: 'Endgames', to: 'Endings' });
    expect(moved.status).toBe(200);
    expect((await json('/api/books/folders/move', 'POST', { from: 'Endings', to: 'Openings' })).status).toBe(409);
    expect((await json('/api/books/folders/move', 'POST', { from: 'Nope', to: 'X' })).status).toBe(404);
    list = await (await app.request('/api/books')).json();
    expect(list.folders).toEqual(['Endings', 'Openings']);
    expect(list.books.find((b: { id: string }) => b.id === id).collection).toBe('Endings');

    // Deleting refuses a collection with a book in it; back on the shelf, it goes.
    expect((await app.request('/api/books/folders/Endings', { method: 'DELETE' })).status).toBe(409);
    expect((await json(`/api/books/${id}`, 'PATCH', { collection: null })).status).toBe(200);
    expect((await app.request('/api/books/folders/Endings', { method: 'DELETE' })).status).toBe(200);
    // A collection a book was filed in stays when the book goes, until deleted.
    await app.request(`/api/books/${other.id}`, { method: 'DELETE' });
    list = await (await app.request('/api/books')).json();
    expect(list.folders).toEqual(['Openings']);
    expect((await app.request('/api/books/folders/Openings', { method: 'DELETE' })).status).toBe(200);
    list = await (await app.request('/api/books')).json();
    expect(list.folders).toEqual([]);
    expect(list.books.find((b: { id: string }) => b.id === id).collection).toBeNull();
  });

  it('replaces the file, dropping the diagram cache and a page past the new end', async () => {
    const shorter = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 0x42)]);
    const res = await app.request(`/api/books/${id}/pdf?pages=5`, {
      method: 'PUT',
      body: new Uint8Array(shorter),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).bytes).toBe(shorter.length);
    expect(readFileSync(join(dir, id, 'book.pdf')).equals(shorter)).toBe(true);
    const list = await (await app.request('/api/books')).json();
    expect(list.books[0]).toMatchObject({ pages: 5, lastPage: null, bytes: shorter.length });
    const saved = await (await app.request(`/api/books/${id}/diagrams`)).json();
    expect(saved.pages).toEqual({});
    // A replace that fails leaves the old file in place.
    const bad = await app.request(`/api/books/${id}/pdf`, { method: 'PUT', body: 'nope' });
    expect(bad.status).toBe(400);
    expect(readFileSync(join(dir, id, 'book.pdf')).equals(shorter)).toBe(true);
    expect(existsSync(join(dir, id, 'book.pdf.part'))).toBe(false);
  });

  it('links to a puzzle book only while the PDF exists, and the list names the puzzle book', async () => {
    const shelf = shelfDir;
    try {
      const puzzles = new Hono().route('/api', puzzleBooksApi(shelf, dir));
      const made = await puzzles.request('/api/puzzlebooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Linked' }),
      });
      const { slug } = await made.json();
      const patch = (body: unknown) =>
        puzzles.request(`/api/puzzlebooks/${slug}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect((await patch({ pdfBook: 'nonsense' })).status).toBe(400);
      const linked = await patch({ pdfBook: id });
      expect(linked.status).toBe(200);
      expect((await linked.json()).pdfBook).toBe(id);
      // A link-only PATCH keeps the title.
      const detail = await (await puzzles.request(`/api/puzzlebooks/${slug}`)).json();
      expect(detail.title).toBe('Linked');
      expect(detail.pdfBook).toBe(id);
      const list = await (await puzzles.request('/api/puzzlebooks')).json();
      expect(list.books[0].pdfBook).toBe(id);
      // And the other way round: the library's row names the puzzle book.
      const library = await (await app.request('/api/books')).json();
      expect(library.books[0].puzzleBook).toEqual({ slug, title: 'Linked' });

      // The library book goes: the pointer dangles and is reported as none.
      expect((await app.request(`/api/books/${id}`, { method: 'DELETE' })).status).toBe(200);
      const after = await (await puzzles.request(`/api/puzzlebooks/${slug}`)).json();
      expect(after.pdfBook).toBeNull();
      expect((await patch({ pdfBook: null })).status).toBe(200);
    } finally {
      // The shelf dir is the suite's; nothing to remove here.
    }
  });

  it('is gone once deleted', async () => {
    expect(existsSync(join(dir, id))).toBe(false);
    expect((await (await app.request('/api/books/bookmarks')).json()).ids).toEqual([]);
    expect((await app.request(`/api/books/${id}/pdf`)).status).toBe(404);
    expect((await app.request('/api/books/bnotanidatall/pdf')).status).toBe(404);
    const list = await (await app.request('/api/books')).json();
    expect(list.books).toHaveLength(0);
  });
});
