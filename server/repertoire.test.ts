import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repertoireApi } from './repertoire.ts';

describe('repertoire drill api', () => {
  let dir: string;
  let app: Hono;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'repertoire-api-'));
    app = new Hono().route('/api', repertoireApi(dir));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const attempt = (body: unknown): Promise<Response> | Response =>
    app.request('/api/repertoire/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const KEY = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -';

  it('rejects a shapeless attempt', async () => {
    expect((await attempt({ study: 'x' })).status).toBe(400);
    expect((await attempt({ study: 'x', chapter: 'c', key: KEY, result: 'meh' })).status).toBe(400);
  });

  it('requires a study on summary', async () => {
    expect((await app.request('/api/repertoire/summary')).status).toBe(400);
  });

  it('a miss enters the review pool; a later hit clears it', async () => {
    await attempt({
      study: 'Najdorf',
      chapter: 'Main line',
      key: KEY,
      result: 'miss',
      path: ['e4', 'e5'],
      expected: ['Nf3'],
      played: 'Nc3',
    });
    let body = await (
      await app.request('/api/repertoire/summary?study=Najdorf&chapter=Main%20line')
    ).json();
    expect(body.attempted).toBe(1);
    expect(body.review).toEqual([
      { chapter: 'Main line', key: KEY, path: ['e4', 'e5'], expected: ['Nf3'], played: 'Nc3' },
    ]);

    await attempt({ study: 'Najdorf', chapter: 'Main line', key: KEY, result: 'hit' });
    body = await (await app.request('/api/repertoire/summary?study=Najdorf')).json();
    expect(body.attempted).toBe(1);
    expect(body.review).toEqual([]);
  });

  it('gaps are reported beside the review pool, never inside it', async () => {
    await attempt({
      study: 'Najdorf',
      chapter: 'Main line',
      key: 'other position w KQkq -',
      result: 'gap',
      path: ['e4', 'c5', 'Nf3', 'd6', 'd4'],
      played: 'cxd4',
    });
    const body = await (await app.request('/api/repertoire/summary?study=Najdorf')).json();
    expect(body.review).toEqual([]);
    expect(body.gaps).toHaveLength(1);
    expect(body.gaps[0].played).toBe('cxd4');
  });

  it('scopes summaries by study and chapter', async () => {
    await attempt({ study: 'Caro-Kann', chapter: 'Advance', key: KEY, result: 'miss' });
    const najdorf = await (await app.request('/api/repertoire/summary?study=Najdorf')).json();
    expect(najdorf.attempted).toBe(2);
    const advance = await (
      await app.request('/api/repertoire/summary?study=Caro-Kann&chapter=Advance')
    ).json();
    expect(advance.attempted).toBe(1);
    const wrongChapter = await (
      await app.request('/api/repertoire/summary?study=Caro-Kann&chapter=Exchange')
    ).json();
    expect(wrongChapter.attempted).toBe(0);
  });

  it('tolerates a torn history line', async () => {
    appendFileSync(join(dir, 'history.jsonl'), '{"study":"Najd');
    const body = await (await app.request('/api/repertoire/summary?study=Najdorf')).json();
    expect(body.attempted).toBe(2);
  });

  it('reset forgets everything', async () => {
    await app.request('/api/repertoire/reset', { method: 'POST' });
    const body = await (await app.request('/api/repertoire/summary?study=Najdorf')).json();
    expect(body.attempted).toBe(0);
  });

  it('summarises an empty vault without a directory', async () => {
    const fresh = new Hono().route('/api', repertoireApi(join(dir, 'never-made')));
    const body = await (await fresh.request('/api/repertoire/summary?study=x')).json();
    expect(body).toEqual({ attempted: 0, review: [], gaps: [] });
  });
});
