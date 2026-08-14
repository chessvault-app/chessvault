import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourcesApi } from './sources.ts';

/**
 * The PGN upload routes, ported whole from books.test.ts when the opening
 * books were retired: the uploads outlived the books because they were
 * never about them — they feed the reference databases now.
 */

const PGN = `
[White "Ann"]
[Black "Ben"]
[WhiteElo "2500"]
[BlackElo "2400"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0
`;

describe('sources api', () => {
  let dir: string;
  let app: Hono;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sources-api-'));
    writeFileSync(join(dir, 'test-source.pgn'), PGN);
    mkdirSync(join(dir, 'games', 'chesscom', 'someone'), { recursive: true });
    writeFileSync(join(dir, 'games', 'chesscom', 'someone', '2026-08.pgn'), PGN);
    app = new Hono().route('/api', sourcesApi(dir));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists pgn sources', async () => {
    const res = await app.request('/api/sources');
    const { sources } = await res.json();
    expect(sources.map((s: { name: string }) => s.name)).toEqual(['test-source.pgn']);
  });

  it('does not offer the vault own games as sources', async () => {
    // They are indexed live and queried with filters instead — see
    // server/myGames.ts.
    const res = await app.request('/api/sources');
    const body = await res.json();
    expect(body.sources.map((s: { name: string }) => s.name)).not.toContain('2026-08.pgn');
  });

  it('uploads a pgn collection, and refuses one that is already there', async () => {
    const upload = async (name: string, body: string): Promise<Response> =>
      app.request(`/api/sources?name=${encodeURIComponent(name)}`, { method: 'POST', body });

    expect((await upload('uploaded.pgn', PGN)).status).toBe(200);
    expect(readFileSync(join(dir, 'uploaded.pgn'), 'utf8')).toBe(PGN);

    // Same name twice must not silently replace a 300 MB collection.
    expect((await upload('uploaded.pgn', PGN)).status).toBe(409);
  });

  it('refuses an upload declaring more than the route cap', async () => {
    // The route is exempt from the API-wide 32 MB body cap (a real elite
    // month is far bigger), so it must state its own bound.
    const res = await app.request('/api/sources?name=huge.pgn', {
      method: 'POST',
      headers: { 'content-length': String(3 * 1024 ** 3) },
      body: PGN,
    });
    expect(res.status).toBe(413);
    expect(existsSync(join(dir, 'huge.pgn'))).toBe(false);
    expect(existsSync(join(dir, 'huge.pgn.part'))).toBe(false);
  });

  it('refuses uploads that are not a plain .pgn filename', async () => {
    for (const name of ['../escape.pgn', 'nested/file.pgn', 'notpgn.txt', '']) {
      const res = await app.request(`/api/sources?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        body: PGN,
      });
      expect(res.status, name).toBe(400);
    }
    expect(existsSync(join(dir, '..', 'escape.pgn'))).toBe(false);
  });

  it('deletes an uploaded collection', async () => {
    expect((await app.request('/api/sources/uploaded.pgn', { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(join(dir, 'uploaded.pgn'))).toBe(false);
    expect((await app.request('/api/sources/uploaded.pgn', { method: 'DELETE' })).status).toBe(404);
  });

  it('answers an empty list for a directory that does not exist yet', async () => {
    const fresh = new Hono().route('/api', sourcesApi(join(dir, 'nowhere')));
    const body = await (await fresh.request('/api/sources')).json();
    expect(body).toEqual({ sources: [] });
  });
});
