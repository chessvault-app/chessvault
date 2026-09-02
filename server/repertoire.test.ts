import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { appendFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
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

  it('bounds the names, since the record is append-only and read whole', async () => {
    const long = 'x'.repeat(401);
    expect((await attempt({ study: long, chapter: 'c', key: KEY, result: 'hit' })).status).toBe(400);
    expect((await attempt({ study: 'x', chapter: long, key: KEY, result: 'hit' })).status).toBe(400);
    expect((await attempt({ study: 'x', chapter: 'c', key: 'k'.repeat(201), result: 'hit' })).status).toBe(400);
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
    // Fumbled a moment ago: drillable at once, but the ladder does not
    // call it DUE until tomorrow.
    expect(body.due).toBe(0);
    expect(body.review).toEqual([
      {
        chapter: 'Main line',
        key: KEY,
        path: ['e4', 'e5'],
        expected: ['Nf3'],
        played: 'Nc3',
        due: body.review[0].due,
      },
    ]);
    expect(body.review[0].due > new Date().toISOString()).toBe(true);

    await attempt({ study: 'Najdorf', chapter: 'Main line', key: KEY, result: 'hit' });
    body = await (await app.request('/api/repertoire/summary?study=Najdorf')).json();
    expect(body.attempted).toBe(1);
    // Recalled — off today's list, but back in three days rather than
    // retired, which is the whole point of the ladder.
    expect(body.review).toEqual([]);
    expect(body.due).toBe(0);
    expect(body.scheduled).toBe(1);
    expect(body.nextDue).not.toBeNull();
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
    expect(body).toEqual({ attempted: 0, due: 0, review: [], scheduled: 0, nextDue: null, gaps: [] });
  });
});

/**
 * The review schedule (shared/review.ts) as the drill wears it. Attempts
 * are written into history.jsonl directly because the route always stamps
 * "now", and a schedule is only observable from a back-dated log.
 */
describe('repertoire review schedule', () => {
  let dir: string;
  let app: Hono;

  const DAY_MS = 86_400_000;
  const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString();
  const A = 'position-a w KQkq -';
  const B = 'position-b w KQkq -';

  const writeHistory = (
    lines: { key: string; result: 'hit' | 'miss' | 'gap'; at: string; chapter?: string }[],
  ): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'history.jsonl'),
      lines
        .map((l) => JSON.stringify({ study: 'Najdorf', chapter: 'Main line', path: ['e4'], ...l }))
        .join('\n') + '\n',
    );
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'repertoire-ladder-'));
    app = new Hono().route('/api', repertoireApi(dir));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const summary = async (): Promise<{
    attempted: number;
    due: number;
    review: { key: string; expected: string[]; due: string }[];
    scheduled: number;
    nextDue: string | null;
    gaps: unknown[];
  }> => (await app.request('/api/repertoire/summary?study=Najdorf')).json();

  it('climbs the ladder: a recall pushes the position out, not off', async () => {
    // Missed 10 days ago, recalled 9 and 6 days ago: two clean recalls
    // put it 7 days out from the last one, so it is due again today.
    writeHistory([
      { key: A, result: 'miss', at: daysAgo(10) },
      { key: A, result: 'hit', at: daysAgo(9) },
      { key: A, result: 'hit', at: daysAgo(8) },
    ]);
    const body = await summary();
    expect(body.due).toBe(1);
    expect(body.review[0]!.key).toBe(A);
  });

  it('graduates a position recalled at every rung', async () => {
    writeHistory([
      { key: A, result: 'miss', at: daysAgo(40) },
      { key: A, result: 'hit', at: daysAgo(39) },
      { key: A, result: 'hit', at: daysAgo(36) },
      { key: A, result: 'hit', at: daysAgo(29) },
      { key: A, result: 'hit', at: daysAgo(8) },
    ]);
    const body = await summary();
    expect(body.attempted).toBe(1);
    expect(body.due).toBe(0);
    expect(body.scheduled).toBe(0);
    expect(body.nextDue).toBeNull();
  });

  it('a fresh recall waits its turn, and says when it lands', async () => {
    writeHistory([
      { key: A, result: 'miss', at: daysAgo(5) },
      { key: A, result: 'hit', at: daysAgo(0) },
      { key: B, result: 'miss', at: daysAgo(3) },
    ]);
    const body = await summary();
    expect(body.due).toBe(1); // B's day came; A comes back in three
    expect(body.review[0]!.key).toBe(B);
    expect(body.scheduled).toBe(1);
    expect(body.nextDue).not.toBeNull();
    expect(body.nextDue! > new Date().toISOString()).toBe(true);
  });

  it('re-drills from the last miss, not from the bare recall that followed', async () => {
    // A hit is recorded without expectations; the path back to the
    // position has to come from the miss underneath it.
    writeHistory([
      { key: A, result: 'miss', at: daysAgo(10) },
      { key: A, result: 'hit', at: daysAgo(9) },
    ]);
    appendFileSync(
      join(dir, 'history.jsonl'),
      JSON.stringify({
        study: 'Najdorf',
        chapter: 'Main line',
        key: A,
        result: 'miss',
        at: daysAgo(4),
        path: ['e4', 'c5'],
        expected: ['Nf3'],
      }) + '\n',
    );
    const body = await summary();
    expect(body.due).toBe(1);
    expect(body.review[0]!.expected).toEqual(['Nf3']);
  });

  it('a gap neither advances the ladder nor joins the pool', async () => {
    writeHistory([
      { key: A, result: 'miss', at: daysAgo(10) },
      { key: A, result: 'gap', at: daysAgo(1) },
    ]);
    const body = await summary();
    // Latest word is a gap, so the position is reported there and only
    // there — but the gap did not count as a recall either.
    expect(body.due).toBe(0);
    expect(body.gaps).toHaveLength(1);
  });

  it('meta counts every study at once, for the home reminder', async () => {
    writeHistory([
      { key: A, result: 'miss', at: daysAgo(3) },
      { key: B, result: 'miss', at: daysAgo(2) },
    ]);
    appendFileSync(
      join(dir, 'history.jsonl'),
      JSON.stringify({
        study: 'Caro-Kann',
        chapter: 'Advance',
        key: A,
        result: 'miss',
        at: daysAgo(2),
      }) + '\n',
    );
    const meta = await (await app.request('/api/repertoire/meta')).json();
    expect(meta.attempted).toBe(3);
    expect(meta.due).toBe(3);
    expect(meta.scheduled).toBe(0);
    // One study's summary sees only its own share.
    expect((await summary()).due).toBe(2);
  });
});
