import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chaptersToPgn, pgnToChapters } from '../shared/pgn.ts';
import { studiesApi } from './studies.ts';

describe('studies api', () => {
  let dir: string;
  let app: Hono;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'studies-api-'));
    app = new Hono().route('/api', studiesApi(dir));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    const { studies } = await (await app.request('/api/studies')).json();
    expect(studies).toEqual([]);
  });

  it('creates a study with one starter chapter', async () => {
    const res = await app.request('/api/studies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ruy Lopez' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'Ruy Lopez' });
    expect(existsSync(join(dir, 'Ruy Lopez.pgn'))).toBe(true);

    // The starter file must parse through the shared codec.
    const { pgn } = await (await app.request('/api/studies/Ruy%20Lopez')).json();
    const chapters = pgnToChapters(pgn);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.name).toBe('Chapter 1');
  });

  it('refuses duplicates and bad names', async () => {
    const post = (name: string) =>
      app.request('/api/studies', {
        method: 'POST',
        body: JSON.stringify({ name }),
        headers: { 'content-type': 'application/json' },
      });
    expect((await post('Ruy Lopez')).status).toBe(409);
    expect((await post('../evil')).status).toBe(400);
    expect((await post('.hidden')).status).toBe(400);
    expect((await post('')).status).toBe(400);
  });

  it('round-trips a save through the shared codec', async () => {
    const { pgn } = await (await app.request('/api/studies/Ruy%20Lopez')).json();
    const chapters = pgnToChapters(pgn);
    chapters[0]!.tree = pgnToChapters('[Event "x"]\n\n1. e4 e5 2. Nf3 {The point.} *')[0]!.tree;
    const body = chaptersToPgn(chapters);

    const res = await app.request('/api/studies/Ruy%20Lopez', {
      method: 'PUT',
      body: JSON.stringify({ pgn: body }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(dir, 'Ruy Lopez.pgn'), 'utf-8')).toBe(body);

    const { studies } = await (await app.request('/api/studies')).json();
    expect(studies).toHaveLength(1);
    expect(studies[0]).toMatchObject({ id: 'Ruy Lopez', chapters: 1 });
  });

  it('404s on missing studies and rejects traversal ids', async () => {
    expect((await app.request('/api/studies/nope')).status).toBe(404);
    expect((await app.request('/api/studies/..%2Fetc')).status).toBe(400);
    expect(
      (await app.request('/api/studies/nope', {
        method: 'PUT',
        body: JSON.stringify({ pgn: '*' }),
        headers: { 'content-type': 'application/json' },
      })).status,
    ).toBe(404);
  });

  it('deletes a study', async () => {
    expect((await app.request('/api/studies/Ruy%20Lopez', { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(join(dir, 'Ruy Lopez.pgn'))).toBe(false);
  });
});
