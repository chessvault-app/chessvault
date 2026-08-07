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

  it('deletes a book', async () => {
    const slug = encodeURIComponent('1001 Sacrifices');
    expect((await app.request(`/api/puzzlebooks/${slug}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/puzzlebooks/${slug}`)).status).toBe(404);
    const list = await (await app.request('/api/puzzlebooks')).json();
    expect(list.books).toHaveLength(0);
  });
});
