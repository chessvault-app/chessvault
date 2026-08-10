import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { puzzleBooksApi } from './puzzlebooks.ts';

describe('puzzle books api', () => {
  let dir: string;
  let app: Hono;

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

  it('creates a book and lists it', async () => {
    const created = await post('/api/puzzlebooks', { title: '1001 Sacrifices' });
    expect(created.status).toBe(200);
    const { slug } = await created.json();
    expect(slug).toBe('1001 Sacrifices');

    expect((await post('/api/puzzlebooks', { title: '1001 Sacrifices' })).status).toBe(409);
    expect((await post('/api/puzzlebooks', {})).status).toBe(400);

    const list = await (await app.request('/api/puzzlebooks')).json();
    expect(list.books).toHaveLength(1);
    expect(list.books[0]).toMatchObject({ title: '1001 Sacrifices', puzzles: 0, solved: 0 });
  });

  it('adds puzzles, tracks attempts, deletes puzzles', async () => {
    const slug = encodeURIComponent('1001 Sacrifices');
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
    expect(list.books[0]).toMatchObject({ puzzles: 1, solved: 1, failed: 0 });

    const del = await app.request(`/api/puzzlebooks/${slug}/puzzles/${puzzle.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const after = await (await app.request(`/api/puzzlebooks/${slug}`)).json();
    expect(after.puzzles).toHaveLength(0);
    expect(after.progress[puzzle.id]).toBeUndefined();
  });

  it('takes a puzzle an importer read out of the book, with its evidence', async () => {
    const slug = encodeURIComponent('1001 Sacrifices');
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
    const slug = encodeURIComponent('1001 Sacrifices');
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
    const slug = encodeURIComponent('1001 Sacrifices');
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
    await post('/api/puzzlebooks', { title: 'OCR Book' });
    const slug = encodeURIComponent('OCR Book');

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
    await post('/api/puzzlebooks', { title: 'Split Book' });
    const slug = encodeURIComponent('Split Book');
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

  it('stores evidence pages under a name the page owns', async () => {
    await post('/api/puzzlebooks', { title: 'Evidence Book' });
    const slug = encodeURIComponent('Evidence Book');
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
    await post('/api/puzzlebooks', { title: 'Draft Book' });
    const slug = encodeURIComponent('Draft Book');
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
    const title = '5334 Problems, Combinations & Games';
    expect((await post('/api/puzzlebooks', { title })).status).toBe(200);
    const slug = encodeURIComponent(title);
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

  it('still refuses names that could escape the books folder', async () => {
    for (const bad of ['../evil', 'a/b', '.hidden', 'ends.', ' padded']) {
      expect((await app.request(`/api/puzzlebooks/${encodeURIComponent(bad)}`)).status).toBe(404);
    }
  });

  it('deletes a book', async () => {
    const slug = encodeURIComponent('1001 Sacrifices');
    expect((await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/puzzlebooks/${slug}`)).status).toBe(404);
    const list = await (await app.request('/api/puzzlebooks')).json();
    expect(list.books).toHaveLength(0);
  });
});
