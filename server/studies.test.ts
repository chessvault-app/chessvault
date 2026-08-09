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

  it('creates a study from imported PGN content (Lichess export shape)', async () => {
    const lichessExport = [
      '[Event "My Study: Chapter 1"]\n[Result "*"]\n\n1. e4 e5 { [%cal Ge2e4] } *',
      '[Event "My Study: Chapter 2"]\n[FEN "8/8/8/8/8/4K3/8/4k3 w - - 0 1"]\n[SetUp "1"]\n\n*',
    ].join('\n\n');
    const res = await app.request('/api/studies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Imported', pgn: lichessExport }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const stored = readFileSync(join(dir, 'Imported.pgn'), 'utf-8');
    expect(pgnToChapters(stored)).toHaveLength(2);
    // Later cases assert on the study count — leave the vault as found.
    await app.request('/api/studies/Imported', { method: 'DELETE' });
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

  it('accepts apostrophes and dashes, still rejects unsafe names', async () => {
    // Chess names need these; a study you cannot open is worse than one
    // with a plain name.
    const make = (name: string) =>
      app.request('/api/studies', {
        method: 'POST',
        body: JSON.stringify({ name }),
        headers: { 'content-type': 'application/json' },
      });
    expect((await make("London System - Black's Answer")).status).toBe(200);
    expect((await make('Reti — Move by Move')).status).toBe(200);
    expect((await app.request(`/api/studies/${encodeURIComponent("London System - Black's Answer")}`)).status).toBe(200);
    // Windows-illegal and traversal-shaped names stay out.
    for (const bad of ['a:b', 'a?b', 'a*b', 'a<b', 'a|b', '..', '.hidden', 'trailing.']) {
      expect((await make(bad)).status, bad).toBe(400);
    }
    // Surrounding whitespace is trimmed before validation, not rejected.
    expect((await make('  spaced  ')).status).toBe(200);
  });

  it('deletes a study', async () => {
    expect((await app.request('/api/studies/Ruy%20Lopez', { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(join(dir, 'Ruy Lopez.pgn'))).toBe(false);
  });

  it('creates studies inside folders and lists them with slash ids', async () => {
    const res = await app.request('/api/studies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Openings/Caro-Kann' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(dir, 'Openings', 'Caro-Kann.pgn'))).toBe(true);

    const { studies } = await (await app.request('/api/studies')).json();
    expect(studies.map((s: { id: string }) => s.id)).toContain('Openings/Caro-Kann');

    const got = await app.request('/api/studies/Openings%2FCaro-Kann');
    expect(got.status).toBe(200);
    expect((await got.json()).id).toBe('Openings/Caro-Kann');

    // Traversal through folder segments must still be impossible.
    const evil = await app.request('/api/studies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Openings/../../evil' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(evil.status).toBe(400);

    expect(
      (await app.request('/api/studies/Openings%2FCaro-Kann', { method: 'DELETE' })).status,
    ).toBe(200);
  });

  it('renames, moves between folders, renames folders, deletes empty folders', async () => {
    const post = (url: string, body: unknown) =>
      app.request(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });

    await post('/api/studies', { name: 'Scratch' });

    // Rename in place.
    expect((await post('/api/studies/move', { from: 'Scratch', to: 'King s Indian' })).status).toBe(200);
    expect(existsSync(join(dir, 'King s Indian.pgn'))).toBe(true);

    // Move into a folder (created implicitly).
    expect(
      (await post('/api/studies/move', { from: 'King s Indian', to: 'Repertoire/King s Indian' })).status,
    ).toBe(200);
    expect(existsSync(join(dir, 'Repertoire', 'King s Indian.pgn'))).toBe(true);

    // Rename the folder — the study inside moves with it.
    expect(
      (await post('/api/studies/folders/move', { from: 'Repertoire', to: 'Black Repertoire' })).status,
    ).toBe(200);
    expect(existsSync(join(dir, 'Black Repertoire', 'King s Indian.pgn'))).toBe(true);

    // A non-empty folder refuses deletion; emptied, it deletes.
    expect(
      (await app.request('/api/studies/folders/Black%20Repertoire', { method: 'DELETE' })).status,
    ).toBe(409);
    // Move the study out (to the root) rather than deleting it.
    expect(
      (await post('/api/studies/move', { from: 'Black Repertoire/King s Indian', to: 'King s Indian' })).status,
    ).toBe(200);
    expect(
      (await app.request('/api/studies/folders/Black%20Repertoire', { method: 'DELETE' })).status,
    ).toBe(200);
    expect(existsSync(join(dir, 'Black Repertoire'))).toBe(false);

    // Collisions and traversal refused.
    await post('/api/studies', { name: 'Other' });
    expect((await post('/api/studies/move', { from: 'Other', to: 'King s Indian' })).status).toBe(409);
    expect((await post('/api/studies/move', { from: 'Other', to: '../evil' })).status).toBe(400);

    await app.request('/api/studies/King%20s%20Indian', { method: 'DELETE' });
    await app.request('/api/studies/Other', { method: 'DELETE' });
  });
});
