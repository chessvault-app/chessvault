import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StockfishEngine } from './StockfishEngine.ts';

/**
 * A worker that speaks just enough UCI to get the handshake done, and
 * otherwise says only what the test tells it to. `bestmove` is never
 * volunteered: a real engine emits it on its own, and the point of most
 * of these tests is what happens in the window before it does.
 */
class FakeWorker {
  static last: FakeWorker | null = null;
  sent: string[] = [];
  terminated = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(_url: string) {
    FakeWorker.last = this;
  }

  postMessage(command: string): void {
    this.sent.push(command);
    // The handshake is the only thing answered without being asked.
    if (command === 'uci') this.reply('uciok');
    else if (command === 'isready') this.reply('readyok');
  }

  reply(line: string): void {
    this.onmessage?.({ data: line });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Commands sent since a mark, so a test can assert "nothing more". */
  since(mark: number): string[] {
    return this.sent.slice(mark);
  }
}

const A = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const B = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const C = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const D = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

function makeEngine(): {
  engine: StockfishEngine;
  updates: { fen: string; finished: boolean }[];
  errors: string[];
} {
  const updates: { fen: string; finished: boolean }[] = [];
  const errors: string[] = [];
  const engine = new StockfishEngine(
    'lite-single',
    { threads: 1, hashMb: 16, multiPv: 1 },
    (update) => updates.push({ fen: update.fen, finished: update.finished }),
    (message) => errors.push(message),
  );
  // The worker is reached through FakeWorker.last: the engine builds its
  // own on the first analyse(), so there is nothing to hand back yet.
  return { engine, updates, errors };
}

const goCount = (worker: FakeWorker): number =>
  worker.sent.filter((c) => c.startsWith('go')).length;

describe('StockfishEngine search scheduling', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('document', { baseURI: 'http://localhost/' });
    FakeWorker.last = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('never issues a second `go` while a search is live', async () => {
    const { engine } = makeEngine();
    await engine.analyse(A, 20);
    const worker = FakeWorker.last!;

    expect(worker.sent).toContain(`position fen ${A}`);
    expect(goCount(worker)).toBe(1);

    await engine.analyse(B, 20);

    // A stop, and nothing else: `go` while searching desynchronises UCI.
    expect(worker.sent).toContain('stop');
    expect(goCount(worker)).toBe(1);
    expect(worker.sent).not.toContain(`position fen ${B}`);
  });

  it('coalesces a burst of navigation down to the position landed on', async () => {
    const { engine } = makeEngine();
    await engine.analyse(A, 20);
    const worker = FakeWorker.last!;

    // Arrowing through three more positions while A is still searching.
    await engine.analyse(B, 20);
    await engine.analyse(C, 20);
    await engine.analyse(D, 20);

    // One stop for the whole burst, not one per position.
    expect(worker.sent.filter((c) => c === 'stop')).toHaveLength(1);

    worker.reply('bestmove e2e4');
    await Promise.resolve();

    // B and C were never searched at all; only the last one survives.
    expect(worker.sent).not.toContain(`position fen ${B}`);
    expect(worker.sent).not.toContain(`position fen ${C}`);
    expect(worker.sent).toContain(`position fen ${D}`);
    expect(goCount(worker)).toBe(2);
  });

  it('stamps every update with the fen it belongs to', async () => {
    const { engine, updates } = makeEngine();
    await engine.analyse(A, 20);
    const worker = FakeWorker.last!;

    worker.reply('info depth 8 multipv 1 score cp 21 nodes 1000 nps 1000 time 10 pv e2e4');
    worker.reply('bestmove e2e4');

    // The final flush is immediate; intermediate frames are on a timer.
    const settled = updates.filter((u) => u.finished);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.fen).toBe(A);
  });

  /**
   * The gap. `pendingStop` is cleared by exactly two things: a `bestmove`
   * arriving, and terminate(). A worker that stops answering fires no
   * `error` event - it is alive, just not talking - so neither happens,
   * and every later request is parked in a slot nobody drains.
   */
  it('goes permanently silent if the worker never answers a stop', async () => {
    vi.useFakeTimers();
    const { engine, updates, errors } = makeEngine();
    await engine.analyse(A, 20);
    const worker = FakeWorker.last!;

    await engine.analyse(B, 20); // sends `stop`, waits for `bestmove`
    const mark = worker.sent.length;

    // The worker wedges here: no bestmove, no error event, ever.
    await engine.analyse(C, 20);
    await engine.analyse(D, 20);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await engine.analyse(A, 20);

    expect(worker.since(mark)).toEqual([]); // nothing was ever sent again
    expect(errors).toEqual([]); // and nobody was told
    expect(updates.some((u) => u.fen === D)).toBe(false);
    expect(worker.terminated).toBe(false);
  });

  it('recovers only by being torn down and rebuilt', async () => {
    const { engine } = makeEngine();
    await engine.analyse(A, 20);
    const wedged = FakeWorker.last!;
    await engine.analyse(B, 20);

    // What the engine toggle does: terminate() resets pendingStop.
    engine.terminate();
    expect(wedged.terminated).toBe(true);

    await engine.analyse(C, 20);
    const fresh = FakeWorker.last!;
    expect(fresh).not.toBe(wedged);
    expect(fresh.sent).toContain(`position fen ${C}`);
  });
});
