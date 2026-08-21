import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { puzzleBooksApi } from './puzzlebooks.ts';

describe('puzzle books api', () => {
  let dir: string;
  let app: Hono;
  /** The first book's id, kept because the tests below share one shelf. */
  let sacrifices = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'puzzlebooks-'));
    app = new Hono().route('/api', puzzleBooksApi(dir));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const post = (path: string, body: unknown): Promise<Response> | Response =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const BOOK_ID = /^b[0-9a-f]{16}$/;

  it('creates a book and lists it', async () => {
    const created = await post('/api/puzzlebooks', { title: '1001 Sacrifices' });
    expect(created.status).toBe(200);
    const { slug } = await created.json();
    sacrifices = slug;
    // An id, not the title: nothing about the folder is derived from the
    // name, so nothing about the name can collide.
    expect(slug).toMatch(BOOK_ID);

    // Which is what lets two books be called the same thing. The shelf's
    // New button offers one placeholder to every book it makes, and this
    // used to be answered with "a book with that name exists".
    const twin = await post('/api/puzzlebooks', { title: '1001 Sacrifices' });
    expect(twin.status).toBe(200);
    const { slug: twinSlug } = await twin.json();
    expect(twinSlug).toMatch(BOOK_ID);
    expect(twinSlug).not.toBe(slug);
    // A title is still required — it is the only name the book has.
    expect((await post('/api/puzzlebooks', {})).status).toBe(400);

    const list = await (await app.request('/api/puzzlebooks')).json();
    expect(list.books).toHaveLength(2);
    expect(list.books.map((b: { title: string }) => b.title)).toEqual([
      '1001 Sacrifices',
      '1001 Sacrifices',
    ]);
    expect(list.books.find((b: { slug: string }) => b.slug === slug)).toMatchObject({
      title: '1001 Sacrifices',
      puzzles: 0,
      solved: 0,
    });
  });

  /**
   * The bug all of this began with: New book answered "a book with that
   * name exists" on every press, forever, and showed no such book.
   *
   * A book created as the shelf's placeholder and then renamed used to
   * keep its placeholder folder, so the name stayed taken by a book
   * nothing listed under it. The shelf picks a title no book is using,
   * which was never the same question as which folder is free, and it
   * could not see the collision coming. Neither question exists now.
   */
  it('makes a new book under the placeholder name however often it is asked', async () => {
    const own = mkdtempSync(join(tmpdir(), 'puzzlebooks-'));
    const shelf = new Hono().route('/api', puzzleBooksApi(own));
    const make = (title: string): Promise<Response> | Response =>
      shelf.request('/api/puzzlebooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    try {
      const first = await (await make('제목 없는 책')).json();
      await shelf.request(`/api/puzzlebooks/${first.slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '1001 Chess Exercises for Beginners' }),
      });

      // Renamed or not, the placeholder was never a folder and is free.
      for (let n = 0; n < 3; n += 1) expect((await make('제목 없는 책')).status).toBe(200);
      const list = await (await shelf.request('/api/puzzlebooks')).json();
      expect(list.books).toHaveLength(4);
      expect(new Set(list.books.map((b: { slug: string }) => b.slug)).size).toBe(4);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  /**
   * Every folder in a vault written before books had ids is named after a
   * title. They are moved once, at startup — and the name is kept: it goes
   * into book.json first when that file has none of its own, so no folder
   * is ever renamed to an id with nothing left saying what it was.
   */
  it('moves a folder named after a title to an id at startup', async () => {
    const own = mkdtempSync(join(tmpdir(), 'puzzlebooks-'));
    // One with a title of its own, already diverged from its folder.
    mkdirSync(join(own, '제목 없는 책', 'diagrams'), { recursive: true });
    writeFileSync(
      join(own, '제목 없는 책', 'book.json'),
      JSON.stringify({ title: '1001 Chess Exercises for Beginners' }),
    );
    writeFileSync(join(own, '제목 없는 책', 'diagrams', 'cover.jpg'), 'jpeg');
    // And one whose folder name is the only name it has.
    mkdirSync(join(own, 'Chess Evolution'), { recursive: true });
    writeFileSync(join(own, 'Chess Evolution', 'puzzles.json'), '[]');
    writeFileSync(join(own, '.bookmarks.json'), JSON.stringify({ slugs: ['제목 없는 책'] }));
    try {
      const shelf = new Hono().route('/api', puzzleBooksApi(own));
      const list = await (await shelf.request('/api/puzzlebooks')).json();
      expect(list.books).toHaveLength(2);
      for (const book of list.books) expect(book.slug).toMatch(BOOK_ID);

      const renamed = list.books.find(
        (b: { title: string }) => b.title === '1001 Chess Exercises for Beginners',
      );
      expect(renamed).toMatchObject({ cover: true });
      // The folder name became the title of the book that had none.
      expect(list.books.map((b: { title: string }) => b.title)).toContain('Chess Evolution');
      // The bookmark went with it.
      const marks = await (await shelf.request('/api/puzzlebooks/bookmarks')).json();
      expect(marks.slugs).toEqual([renamed.slug]);

      // And a second start moves nothing: an id is already an id.
      const before = readdirSync(own).sort();
      new Hono().route('/api', puzzleBooksApi(own));
      expect(readdirSync(own).sort()).toEqual(before);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  /**
   * A title is stored in ONE normal form. "제목" is one code point per
   * syllable composed and two decomposed, a Korean IME on macOS types the
   * second, and two books wearing what looks like one name is a shelf
   * nobody can read. The folder is unaffected either way, which is rather
   * the point.
   */
  it('stores a title in one normal form', async () => {
    const own = mkdtempSync(join(tmpdir(), 'puzzlebooks-'));
    const composed = '제목 없는 책';
    expect(composed.normalize('NFD')).not.toBe(composed);
    try {
      const shelf = new Hono().route('/api', puzzleBooksApi(own));
      const made = await shelf.request('/api/puzzlebooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: composed.normalize('NFD') }),
      });
      const { slug } = await made.json();
      expect(slug).toMatch(BOOK_ID);
      const list = await (await shelf.request('/api/puzzlebooks')).json();
      expect(list.books[0].title).toBe(composed);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  it('renames a book without moving anything', async () => {
    const created = await post('/api/puzzlebooks', { title: 'Untitled book 7' });
    const { slug } = await created.json();
    await app.request('/api/puzzlebooks/bookmarks/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });

    const renamed = await app.request(`/api/puzzlebooks/${slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Chess Evolution' }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ slug, title: 'Chess Evolution' });

    // The id is what the URL, the folder and the bookmark all hold, and a
    // new name is not news to any of them.
    expect(existsSync(join(dir, slug))).toBe(true);
    expect((await app.request(`/api/puzzlebooks/${slug}`)).status).toBe(200);
    const list = await (await app.request('/api/puzzlebooks')).json();
    expect(list.books.find((b: { slug: string }) => b.slug === slug)).toMatchObject({
      title: 'Chess Evolution',
    });
    const marks = await (await app.request('/api/puzzlebooks/bookmarks')).json();
    expect(marks.slugs).toContain(slug);
    await app.request('/api/puzzlebooks/bookmarks/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    const moved = slug;

    const empty = await app.request(`/api/puzzlebooks/${encodeURIComponent(moved)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  ' }),
    });
    expect(empty.status).toBe(400);
    expect(
      (
        await app.request('/api/puzzlebooks/no-such-book', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    ).toBe(404);

    await app.request(`/api/puzzlebooks/${encodeURIComponent(moved)}`, { method: 'DELETE' });
  });

  it('adds puzzles, tracks attempts, deletes puzzles', async () => {
    const slug = sacrifices;
    const added = await post(`/api/puzzlebooks/${slug}/puzzles`, {
      fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
      uci: ['a1a2', 'h1h2'],
      san: ['Ka2', 'Kh2'],
    });
    expect(added.status).toBe(200);
    const { puzzle } = await added.json();

    expect((await post(`/api/puzzlebooks/${slug}/puzzles`, { fen: 'x', uci: [] })).status).toBe(400);

    // A loss then a win: last result wins, tries accumulate.
    await post(`/api/puzzlebooks/${slug}/attempt`, { id: puzzle.id, win: false });
    const win = await (await post(`/api/puzzlebooks/${slug}/attempt`, { id: puzzle.id, win: true })).json();
    expect(win.progress).toMatchObject({ tries: 2, wins: 1, last: 'win' });

    const detail = await (await app.request(`/api/puzzlebooks/${slug}`)).json();
    expect(detail.puzzles).toHaveLength(1);
    expect(detail.progress[puzzle.id].last).toBe('win');

    const list = await (await app.request('/api/puzzlebooks')).json();
    // Found by id: the twin beside it shares its title exactly, so which
    // of the two the shelf sorts first is not a thing to assert on.
    expect(list.books.find((b: { slug: string }) => b.slug === slug)).toMatchObject({
      puzzles: 1,
      solved: 1,
      failed: 0,
    });

    const del = await app.request(`/api/puzzlebooks/${slug}/puzzles/${puzzle.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const after = await (await app.request(`/api/puzzlebooks/${slug}`)).json();
    expect(after.puzzles).toHaveLength(0);
    expect(after.progress[puzzle.id]).toBeUndefined();
  });

  it('takes a puzzle an importer read out of the book, with its evidence', async () => {
    const slug = sacrifices;
    const sent = {
      fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
      uci: ['a1a8'],
      san: ['Ra8#'],
      number: 42,
      provenance: 'book-parsed',
      evidence: {
        page: 'page033.jpg',
        rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 },
        solutionPage: 'page225.jpg',
      },
    };
    const { puzzle } = await (await post(`/api/puzzlebooks/${slug}/puzzles`, sent)).json();
    // The importer's own id, so a re-import lands on the same puzzle and
    // its progress survives.
    expect(puzzle.id).toBe('n42');
    expect(puzzle).toMatchObject({ number: 42, provenance: 'book-parsed', evidence: sent.evidence });

    // Sending it again updates in place rather than duplicating.
    const again = await (
      await post(`/api/puzzlebooks/${slug}/puzzles`, { ...sent, san: ['Ra8#'], uci: ['a1a8'] })
    ).json();
    expect(again.puzzle.id).toBe('n42');
    const detail = await (await app.request(`/api/puzzlebooks/${slug}`)).json();
    expect(detail.puzzles.filter((p: { id: string }) => p.id === 'n42')).toHaveLength(1);

    await app.request(`/api/puzzlebooks/${slug}/puzzles/n42`, { method: 'DELETE' });
  });

  it('refuses a tier or an evidence file it does not recognise', async () => {
    const slug = sacrifices;
    const { puzzle } = await (
      await post(`/api/puzzlebooks/${slug}/puzzles`, {
        fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
        uci: ['a1a8'],
        san: ['Ra8#'],
        provenance: 'trust-me',
        evidence: { page: '../../etc/passwd', rect: { x: 5, y: 0, w: 1, h: 1 } },
      })
    ).json();
    // An unknown tier falls back to the human one; a path that is not a
    // plain image name, and a rect outside the page, are dropped.
    expect(puzzle.provenance).toBe('corrected');
    expect(puzzle.evidence).toBeUndefined();

    await app.request(`/api/puzzlebooks/${slug}/puzzles/${puzzle.id}`, { method: 'DELETE' });
  });

  it('resets progress without touching puzzles', async () => {
    const slug = sacrifices;
    const added = await post(`/api/puzzlebooks/${slug}/puzzles`, {
      fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
      uci: ['a1a2', 'h1h2'],
      san: ['Ka2', 'Kh2'],
    });
    const { puzzle } = await added.json();
    await post(`/api/puzzlebooks/${slug}/attempt`, { id: puzzle.id, win: true });

    const reset = await app.request(`/api/puzzlebooks/${slug}/progress`, { method: 'DELETE' });
    expect(reset.status).toBe(200);
    const after = await (await app.request(`/api/puzzlebooks/${slug}`)).json();
    expect(after.puzzles).toHaveLength(1);
    expect(after.progress).toEqual({});

    expect(
      (await app.request('/api/puzzlebooks/nope/progress', { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('stores and returns OCR templates per book', async () => {
    const { slug } = await (
      await post('/api/puzzlebooks', { title: 'OCR Book' })
    ).json();

    const empty = await app.request(`/api/puzzlebooks/${slug}/ocr`);
    expect(((await empty.json()) as { templates: unknown[] }).templates).toEqual([]);

    const templates = [{ label: 'K', feature: 'QUJD' }];
    const put = await app.request(`/api/puzzlebooks/${slug}/ocr`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templates }),
    });
    expect(put.status).toBe(200);

    const back = await app.request(`/api/puzzlebooks/${slug}/ocr`);
    expect(((await back.json()) as { templates: unknown[] }).templates).toEqual(templates);

    const bad = await app.request(`/api/puzzlebooks/${slug}/ocr`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templates: [{ label: 42 }] }),
    });
    expect(bad.status).toBe(400);

    // Leave the fixture as the other tests expect it.
    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('keeps evidence out of the book list and serves it per puzzle', async () => {
    const { slug } = await (
      await post('/api/puzzlebooks', { title: 'Split Book' })
    ).json();
    await post(`/api/puzzlebooks/${slug}/puzzles`, {
      number: 4,
      fen: '7k/8/8/8/8/8/8/R6K w - - 0 1',
      uci: ['a1a8'],
      san: ['Ra8#'],
      provenance: 'book-parsed',
      evidence: { page: 'page012.jpg', rect: { x: 0.123456789, y: 0.2, w: 0.3, h: 0.4 } },
    });

    const detail = (await (await app.request(`/api/puzzlebooks/${slug}`)).json()) as {
      puzzles: Record<string, unknown>[];
    };
    expect(detail.puzzles).toHaveLength(1);
    // The grid draws numbered tiles wearing a tier badge. That is all it
    // gets: no position, no line, no evidence, no timestamp.
    expect(Object.keys(detail.puzzles[0]!).sort()).toEqual(['id', 'number', 'provenance']);

    const solutions = (await (
      await app.request(`/api/puzzlebooks/${slug}/solutions`)
    ).json()) as { solutions: Record<string, { fen: string; uci: string[]; san: string[] }> };
    expect(solutions.solutions.n4!.fen).toBe('7k/8/8/8/8/8/8/R6K w - - 0 1');
    expect(solutions.solutions.n4!.uci).toEqual(['a1a8']);
    expect(solutions.solutions.n4!.san).toEqual(['Ra8#']);

    const one = await app.request(`/api/puzzlebooks/${slug}/puzzles/n4/evidence`);
    expect(one.status).toBe(200);
    const body = (await one.json()) as { evidence?: { page?: string; rect?: { x: number } } };
    expect(body.evidence?.page).toBe('page012.jpg');
    // Four decimals is a tenth of a pixel on the page image it indexes.
    expect(body.evidence?.rect?.x).toBe(0.1235);

    expect((await app.request(`/api/puzzlebooks/${slug}/puzzles/nope/evidence`)).status).toBe(404);

    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('lists a book in printed order, whatever order it was imported in', async () => {
    const { slug } = await (
      await post('/api/puzzlebooks', { title: 'Order Book' })
    ).json();
    const mate = { fen: '7k/8/8/8/8/8/8/R6K w - - 0 1', uci: ['a1a8'], san: ['Ra8#'] };
    // An import writes what it read off the solutions page first and what
    // the engine settled second — so the file runs 955, 1001, then 2, 4.
    for (const [number, provenance] of [
      [955, 'book-parsed'],
      [1001, 'book-parsed'],
      [2, 'engine-only'],
      [4, 'engine-only'],
    ] as const) {
      await post(`/api/puzzlebooks/${slug}/puzzles`, { ...mate, number, provenance });
    }

    const detail = (await (await app.request(`/api/puzzlebooks/${slug}`)).json()) as {
      puzzles: { number: number }[];
    };
    // The trainer's next/previous walk this list, so tier grouping here is
    // a solver who never leaves the tier they started in.
    expect(detail.puzzles.map((p) => p.number)).toEqual([2, 4, 955, 1001]);

    // And the hub's "next unsolved" starts at the book's first puzzle, not
    // the first one the importer happened to write.
    const next = (await (await app.request(`/api/puzzlebooks/${slug}/next`)).json()) as {
      puzzle: { number: number };
    };
    expect(next.puzzle.number).toBe(2);

    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('clears a book’s contents but keeps the book and the history', async () => {
    const { slug } = await (
      await post('/api/puzzlebooks', { title: 'Clear Book' })
    ).json();
    const image = `data:image/png;base64,${Buffer.from('fakepng').toString('base64')}`;
    await post(`/api/puzzlebooks/${slug}/puzzles`, {
      number: 1,
      fen: '7k/8/8/8/8/8/8/R6K w - - 0 1',
      uci: ['a1a8'],
      san: ['Ra8#'],
    });
    await post(`/api/puzzlebooks/${slug}/drafts`, { drafts: [{ image }] });
    await post(`/api/puzzlebooks/${slug}/attempt`, { id: 'n1', win: true });

    const cleared = await app.request(`/api/puzzlebooks/${slug}/puzzles`, { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ cleared: { puzzles: 1, drafts: 1 } });

    const after = (await (await app.request(`/api/puzzlebooks/${slug}`)).json()) as {
      title: string;
      puzzles: unknown[];
      drafts: unknown[];
      progress: Record<string, unknown>;
    };
    // The book is still there and still empty-handed about its contents…
    expect(after.title).toBe('Clear Book');
    expect(after.puzzles).toHaveLength(0);
    expect(after.drafts).toHaveLength(0);
    // …but the attempt survives, because a rebuilt puzzle keeps its id.
    expect(after.progress.n1).toBeTruthy();

    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('stores evidence pages under a name the page owns', async () => {
    const { slug } = await (
      await post('/api/puzzlebooks', { title: 'Evidence Book' })
    ).json();
    const image = `data:image/jpeg;base64,${Buffer.from('fakejpeg').toString('base64')}`;

    const first = await post(`/api/puzzlebooks/${slug}/evidence`, {
      pages: [{ page: 7, image }, { page: 108, image }],
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { written: string[] }).written).toEqual([
      'page007.jpg',
      'page108.jpg',
    ]);

    const served = await app.request(`/api/puzzlebooks/${slug}/diagrams/page007.jpg`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');

    // A re-import overwrites the page it already had; a puzzle's evidence
    // reference must not go stale, and copies must not pile up.
    const again = await post(`/api/puzzlebooks/${slug}/evidence`, {
      pages: [{ page: 7, image: `data:image/jpeg;base64,${Buffer.from('newer').toString('base64')}` }],
    });
    expect(((await again.json()) as { written: string[] }).written).toEqual(['page007.jpg']);
    const reserved = await app.request(`/api/puzzlebooks/${slug}/diagrams/page007.jpg`);
    expect(Buffer.from(await reserved.arrayBuffer()).toString()).toBe('newer');

    for (const bad of [
      { pages: [] },
      { pages: [{ page: 0, image }] },
      { pages: [{ page: 3, image: 'not-a-data-url' }] },
    ]) {
      expect((await post(`/api/puzzlebooks/${slug}/evidence`, bad)).status).toBe(400);
    }

    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('stores, updates, serves and deletes drafts', async () => {
    const { slug } = await (
      await post('/api/puzzlebooks', { title: 'Draft Book' })
    ).json();
    // 1x1 white JPEG-ish payload is enough for the API contract.
    const image = `data:image/png;base64,${Buffer.from('fakepng').toString('base64')}`;

    const created = await post(`/api/puzzlebooks/${slug}/drafts`, {
      drafts: [{ image }, { image, fen: '8/8/8/8/8/8/8/8 w - - 0 1' }],
    });
    expect(created.status).toBe(200);

    const detail = (await (await app.request(`/api/puzzlebooks/${slug}`)).json()) as {
      drafts: { id: string; image: string; fen: string | null }[];
    };
    expect(detail.drafts).toHaveLength(2);
    expect(detail.drafts[0]!.fen).toBeNull();
    expect(detail.drafts[1]!.fen).toContain('8/8');

    const served = await app.request(
      `/api/puzzlebooks/${slug}/diagrams/${detail.drafts[0]!.image}`,
    );
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');

    const updated = await app.request(`/api/puzzlebooks/${slug}/drafts`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates: [{ id: detail.drafts[0]!.id, fen: 'k7/8/8/8/8/8/8/K7 w - - 0 1' }] }),
    });
    expect(updated.status).toBe(200);

    const del = await app.request(
      `/api/puzzlebooks/${slug}/drafts/${detail.drafts[1]!.id}`,
      { method: 'DELETE' },
    );
    expect(del.status).toBe(200);
    const after = (await (await app.request(`/api/puzzlebooks/${slug}`)).json()) as {
      drafts: { fen: string | null }[];
    };
    expect(after.drafts).toHaveLength(1);
    expect(after.drafts[0]!.fen).toContain('k7');

    const bad = await post(`/api/puzzlebooks/${slug}/drafts`, {
      drafts: [{ image: 'not-a-data-url' }],
    });
    expect(bad.status).toBe(400);

    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('opens a book whose title has the punctuation chess titles use', async () => {
    // "5334 Problems, Combinations and Games" was on the shelf and could
    // not be opened, because of one comma in what was then its folder
    // name. A title is not a path any more, so the comma is just a comma.
    const title = '5334 Problems, Combinations & Games';
    const made = await post('/api/puzzlebooks', { title });
    expect(made.status).toBe(200);
    const { slug } = await made.json();
    expect((await app.request(`/api/puzzlebooks/${slug}`)).status).toBe(200);
    expect(
      (await post(`/api/puzzlebooks/${slug}/puzzles`, {
        fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
        uci: ['a1a8'],
        san: ['Ra8#'],
      })).status,
    ).toBe(200);
    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('makes a book whose title is not written in Latin', async () => {
    // The shelf's own New book button offers a translated title, and an
    // ASCII-only rule once left it with an empty folder name and "that
    // title cannot become a folder name" as the answer to pressing
    // Create: a Korean reader could not make a book at all. Nothing about
    // a title reaches the filesystem now, but the title still has to come
    // back exactly as it went in.
    const title = '제목 없는 책';
    const made = await post('/api/puzzlebooks', { title });
    expect(made.status).toBe(200);
    const { slug } = await made.json();
    expect((await app.request(`/api/puzzlebooks/${slug}`)).status).toBe(200);
    const list = await (await app.request('/api/puzzlebooks')).json();
    expect(list.books.some((b: { title: string }) => b.title === title)).toBe(true);
    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('takes any title at all, since a title is not a path any more', async () => {
    // "///" could not be a folder name and was refused when it had to be
    // one. It is a name now, and a strange name is the reader's business.
    const res = await post('/api/puzzlebooks', { title: '///' });
    expect(res.status).toBe(200);
    const { slug } = await res.json();
    expect(slug).toMatch(BOOK_ID);
    await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' });
  });

  it('still refuses names that could escape the books folder', async () => {
    for (const bad of ['../evil', 'a/b', '.hidden', 'ends.', ' padded']) {
      expect((await app.request(`/api/puzzlebooks/${encodeURIComponent(bad)}`)).status).toBe(404);
    }
  });

  it('deletes a book', async () => {
    const before = await (await app.request('/api/puzzlebooks')).json();
    for (const book of before.books) {
      expect((await app.request(`/api/puzzlebooks/${book.slug}`, { method: 'DELETE' })).status).toBe(
        200,
      );
      expect((await app.request(`/api/puzzlebooks/${book.slug}`)).status).toBe(404);
    }
    const list = await (await app.request('/api/puzzlebooks')).json();
    expect(list.books).toHaveLength(0);
  });
});
