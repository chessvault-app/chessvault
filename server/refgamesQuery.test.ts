import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeQueries, isAbortedQuery, queryFor } from './refgamesQuery.ts';

/**
 * The query worker: statements run off the event loop, in order, and an
 * abandoned one is stopped rather than finished — the property the
 * explore route's 44 s live join lacked (see queryWorker.ts).
 */
describe('query worker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'refgames-query-'));
  const path = join(dir, 'q.sqlite');
  const seed = new Database(path);
  seed.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2), (3);');
  seed.close();

  // Long enough to be running when the abort lands, and to prove the
  // rejection came from the abort rather than from the statement
  // finishing: a walk of this length takes tens of seconds.
  const SLOW =
    'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 400000000) SELECT COUNT(*) AS n FROM c';

  afterAll(async () => {
    await closeQueries();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers all() and get() off the main thread, in order', async () => {
    const q = queryFor(path);
    const [rows, count] = await Promise.all([
      q.all<{ x: number }>('SELECT x FROM t ORDER BY x', []),
      q.get<{ n: number }>('SELECT COUNT(*) AS n FROM t WHERE x > ?', [1]),
    ]);
    expect(rows).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
    expect(count).toEqual({ n: 2 });
  });

  it('reports a bad statement as an error and keeps serving', async () => {
    const q = queryFor(path);
    await expect(q.all('SELECT nope FROM t', [])).rejects.toThrow(/no such column/);
    expect(await q.get('SELECT 1 AS one', [])).toEqual({ one: 1 });
  });

  it('stops a running statement when its request is abandoned', async () => {
    const q = queryFor(path);
    const running = new AbortController();
    const queued = new AbortController();
    const slow = q.get(SLOW, [], running.signal);
    // Queued behind the slow one and abandoned there: it never runs,
    // and its rejection does not touch the process.
    const behind = q.get('SELECT 2 AS two', [], queued.signal);
    const after = q.get<{ three: number }>('SELECT 3 AS three', []);
    queued.abort();
    await expect(behind).rejects.toSatisfy(isAbortedQuery);

    const started = Date.now();
    running.abort();
    await expect(slow).rejects.toSatisfy(isAbortedQuery);
    // The process was killed, not waited for.
    expect(Date.now() - started).toBeLessThan(2000);
    // And what was queued behind it runs on the replacement process.
    expect(await after).toEqual({ three: 3 });
  });

  it('leaves the event loop free while a statement runs', async () => {
    // The property everything here exists for: a timer due in 200 ms
    // fires in about 200 ms while a statement that takes tens of seconds
    // is running. On the main thread it would fire when the statement
    // returned.
    const q = queryFor(path);
    const running = new AbortController();
    const slow = q.get(SLOW, [], running.signal);
    const started = Date.now();
    await new Promise((tick) => setTimeout(tick, 200));
    expect(Date.now() - started).toBeLessThan(1000);
    running.abort();
    await expect(slow).rejects.toSatisfy(isAbortedQuery);
  });

  it('rejects at once when the request was already abandoned', async () => {
    const q = queryFor(path);
    const gone = new AbortController();
    gone.abort();
    await expect(q.all('SELECT 1', [], gone.signal)).rejects.toSatisfy(isAbortedQuery);
  });
});
