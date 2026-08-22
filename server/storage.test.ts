import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageApi, type StorageArea } from './storage.ts';

describe('storage api', () => {
  let vault: string;
  let data: string;
  let app: Hono;

  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), 'storage-vault-'));
    data = mkdtempSync(join(tmpdir(), 'storage-data-'));
    mkdirSync(join(vault, 'games', 'collection', 'deep'), { recursive: true });
    writeFileSync(join(vault, 'games', 'collection', 'a.pgn'), 'x'.repeat(100));
    writeFileSync(join(vault, 'games', 'collection', 'deep', 'b.pgn'), 'x'.repeat(50));
    mkdirSync(join(vault, 'games', 'lichess', 'someone'), { recursive: true });
    writeFileSync(join(vault, 'games', 'lichess', 'someone', '2024-01.pgn'), 'x'.repeat(1000));
    mkdirSync(join(vault, 'books', 'b0123456789abcdef'), { recursive: true });
    writeFileSync(join(vault, 'books', 'b0123456789abcdef', 'book.pdf'), 'x'.repeat(4096));
    writeFileSync(join(vault, 'books', 'b0123456789abcdef', 'book.json'), '{}');
    mkdirSync(join(data, 'refgames'));
    writeFileSync(join(data, 'refgames', 'elite.sqlite'), 'x'.repeat(300));
    app = new Hono().route('/api', storageApi(vault, data));
  });
  afterAll(() => {
    rmSync(vault, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  });

  it('sums each area, keeps the browsing cache apart from the collection, and reports missing areas as empty', async () => {
    const res = await app.request('/api/storage');
    expect(res.status).toBe(200);
    const { areas } = (await res.json()) as { areas: StorageArea[] };
    const by = Object.fromEntries(areas.map((a) => [a.key, a]));
    expect(by.games).toEqual({ key: 'games', bytes: 150, files: 2 });
    expect(by.gamesCache).toEqual({ key: 'gamesCache', bytes: 1000, files: 1 });
    expect(by.books).toEqual({ key: 'books', bytes: 4098, files: 2 });
    expect(by.refgames).toEqual({ key: 'refgames', bytes: 300, files: 1 });
    expect(by.studies).toEqual({ key: 'studies', bytes: 0, files: 0 });
    // Every area is always present, so the card has a fixed shape.
    expect(areas.map((a) => a.key)).toEqual([
      'games',
      'studies',
      'notes',
      'books',
      'puzzlebooks',
      'puzzles',
      'repertoire',
      'sources',
      'gamesCache',
      'history',
      'refgames',
      'explorerCache',
      'tablebaseCache',
    ]);
  });
});
