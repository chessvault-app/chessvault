import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INITIAL_FEN } from 'chessops/fen';
import { buildBook } from '../scripts/lib/book-builder.ts';
import { booksApi } from './books.ts';

const PGN = `
[White "Ann"]
[Black "Ben"]
[WhiteElo "2500"]
[BlackElo "2400"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0

[White "Cy"]
[Black "Dee"]
[WhiteElo "2600"]
[BlackElo "2600"]
[Result "1/2-1/2"]

1. e4 e5 2. Nf3 1/2-1/2
`;

describe('books api', () => {
  let dir: string;
  let app: Hono;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'books-api-'));
    writeFileSync(join(dir, 'test-source.pgn'), PGN);
    await buildBook({
      name: 'testbook',
      sources: [join(dir, 'test-source.pgn')],
      out: join(dir, 'testbook.sqlite'),
    });
    mkdirSync(join(dir, 'games', 'chesscom', 'someone'), { recursive: true });
    writeFileSync(join(dir, 'games', 'chesscom', 'someone', '2026-08.pgn'), PGN);
    app = new Hono().route('/api', booksApi({ books: dir, sources: dir }));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists books with their build metadata', async () => {
    const res = await app.request('/api/books');
    expect(res.status).toBe(200);
    const { books } = await res.json();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ name: 'testbook', games: 2, maxPly: 24 });
    expect(books[0].bytes).toBeGreaterThan(0);
  });

  it('returns moves with SAN and w/d/b for a queried FEN', async () => {
    const res = await app.request(`/api/books/testbook?fen=${encodeURIComponent(INITIAL_FEN)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moves).toEqual([
      { uci: 'e2e4', san: 'e4', w: 1, d: 1, b: 0, total: 2 },
    ]);
    expect(body.topGames[0]).toMatchObject({ white: 'Cy', black: 'Dee', whiteElo: 2600 });
  });

  it('answers the same regardless of a stale en-passant square in the FEN', async () => {
    // Position after 1.e4 with the X-FEN-redundant "e3" — must hash like the
    // indexed position, which was normalised.
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const res = await app.request(`/api/books/testbook?fen=${encodeURIComponent(fen)}`);
    const body = await res.json();
    expect(body.moves.map((m: { san: string }) => m.san)).toEqual(['e5']);
  });

  it('rejects bad input', async () => {
    expect((await app.request('/api/books/testbook')).status).toBe(400);
    expect((await app.request('/api/books/testbook?fen=junk')).status).toBe(400);
    expect((await app.request('/api/books/bad%24name?fen=x')).status).toBe(400);
    expect(
      (await app.request(`/api/books/missing?fen=${encodeURIComponent(INITIAL_FEN)}`)).status,
    ).toBe(404);
    // ".." arrives encoded — a literal "../" is normalised away by fetch
    // before routing and never reaches the handler.
    expect((await app.request('/api/books/..%2Fevil?fen=x')).status).toBe(400);
  });

  it('refuses build requests with path-like sources', async () => {
    const res = await app.request('/api/books/build', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', sources: ['../../etc/passwd.pgn'] }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('lists pgn sources', async () => {
    const res = await app.request('/api/sources');
    const { sources } = await res.json();
    expect(sources.map((s: { name: string }) => s.name)).toEqual(['test-source.pgn']);
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

  it('does not offer the vault own games as book sources', async () => {
    // They are indexed live and queried with filters instead — see
    // server/myGames.ts. Offering them here produced books that could
    // never be rebuilt, because /books reports sources through basename()
    // and that threw the games/ prefix away.
    const res = await app.request('/api/sources');
    const body = await res.json();
    expect(body.games).toBeUndefined();
    expect(body.sources.map((s: { name: string }) => s.name)).not.toContain('2026-08.pgn');
  });

  it('refuses a source that is not a plain file in the sources directory', async () => {
    for (const source of [
      'games/chesscom/someone/2026-08.pgn',
      'games/../../escape.pgn',
      '../escape.pgn',
      'games/',
      'games/x.txt',
      'sub/nested.pgn',
    ]) {
      const res = await app.request('/api/books/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'nope', sources: [source] }),
      });
      expect(res.status, source).toBe(400);
    }
  });

  it('reports sources a rebuild can resolve', async () => {
    // The Rebuild button posts back exactly what /books reported, so the
    // two have to speak the same ids. They did not: a book built from a
    // vault game came back basenamed and rebuilt with 400.
    const { books } = (await (await app.request('/api/books')).json()) as {
      books: { name: string; sources: string[] }[];
    };
    const testbook = books.find((b) => b.name === 'testbook')!;
    expect(testbook.sources).toEqual(['test-source.pgn']);
    // Built under another name so the running job does not hold "testbook"
    // open against the delete test below. What is being proved is that the
    // reported ids resolve, which does not depend on the target's name.
    const res = await app.request('/api/books/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'rebuildcheck', sources: testbook.sources }),
    });
    expect(res.status).toBe(200);
  });

  it('deletes a book', async () => {
    expect((await app.request('/api/books/testbook', { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(join(dir, 'testbook.sqlite'))).toBe(false);
    expect((await app.request('/api/books/testbook', { method: 'DELETE' })).status).toBe(404);
  });
});
