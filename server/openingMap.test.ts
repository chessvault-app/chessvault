import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openingMapApi } from './openingMap.ts';

describe('opening map api', () => {
  let dir: string;
  let app: Hono;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'openingmap-api-'));
    app = new Hono().route('/api', openingMapApi(dir));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const put = (body: unknown): Promise<Response> | Response =>
    app.request('/api/openingmap', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const doc = {
    version: 1,
    maps: [
      {
        id: 'w1',
        color: 'white',
        root: {
          id: 'r00001',
          children: [
            {
              id: 'a3f9k2',
              san: 'e4',
              children: [
                {
                  id: 'b81mz0',
                  san: 'c5',
                  name: 'Anti-Sicilians',
                  depth: 12,
                  note: 'Switch to the Alapin once the study is done.',
                  tags: [
                    { kind: 'study', id: 'Openings/Alapin' },
                    { kind: 'study', id: 'Openings/Anti-Sicilians', chapter: 'Rossolimo' },
                    { kind: 'note', id: 'ideas/alapin-plans' },
                  ],
                  children: [],
                },
              ],
            },
          ],
        },
      },
      { id: 'b1', color: 'black', root: { id: 'r00002', children: [] } },
    ],
  };

  it('serves an empty document before anything is saved', async () => {
    const body = await (await app.request('/api/openingmap')).json();
    expect(body).toEqual({ version: 1, maps: [] });
  });

  it('round-trips a document, pretty-printed on disk', async () => {
    expect((await put(doc)).status).toBe(200);
    const body = await (await app.request('/api/openingmap')).json();
    expect(body).toEqual(doc);
    const raw = readFileSync(join(dir, 'map.json'), 'utf-8');
    expect(raw).toContain('\n  "maps"');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('rejects bad shapes with a 400', async () => {
    expect((await put({ maps: [] })).status).toBe(400); // no version
    expect((await put({ version: 2, maps: [] })).status).toBe(400);
    expect((await put({ version: 1, maps: {} })).status).toBe(400);
    // a root node must not carry a move
    expect(
      (await put({ version: 1, maps: [{ id: 'w', color: 'white', root: { id: 'r', san: 'e4', children: [] } }] }))
        .status,
    ).toBe(400);
    // every other node must
    expect(
      (
        await put({
          version: 1,
          maps: [{ id: 'w', color: 'white', root: { id: 'r', children: [{ id: 'x', children: [] }] } }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await put({ version: 1, maps: [{ id: 'w', color: 'grey', root: { id: 'r', children: [] } }] })).status,
    ).toBe(400);
    // tags must have a known kind and an id
    expect(
      (
        await put({
          version: 1,
          maps: [
            {
              id: 'w',
              color: 'white',
              root: { id: 'r', children: [{ id: 'x', san: 'e4', tags: [{ kind: 'web', id: 'y' }], children: [] }] },
            },
          ],
        })
      ).status,
    ).toBe(400);
  });

  it('rejects a document with too many nodes', async () => {
    const wide = {
      version: 1,
      maps: [
        {
          id: 'w',
          color: 'white',
          root: {
            id: 'r',
            children: Array.from({ length: 5001 }, (_, i) => ({ id: `n${i}`, san: 'e4', children: [] })),
          },
        },
      ],
    };
    expect((await put(wide)).status).toBe(400);
  });

  it('a bad save never replaces the stored document', async () => {
    await put({ version: 1, maps: 'nope' });
    const body = await (await app.request('/api/openingmap')).json();
    expect(body).toEqual(doc);
  });

  it('a damaged file is a 500, never an empty document', async () => {
    writeFileSync(join(dir, 'map.json'), '{"version": 1, "maps": [');
    const res = await app.request('/api/openingmap');
    expect(res.status).toBe(500);
  });

  it('serves an empty document without a directory', async () => {
    const fresh = new Hono().route('/api', openingMapApi(join(dir, 'never-made')));
    const body = await (await fresh.request('/api/openingmap')).json();
    expect(body).toEqual({ version: 1, maps: [] });
  });
});
