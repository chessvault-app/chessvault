import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StockfishEngine } from './StockfishEngine.ts';

/**
 * A worker that speaks just enough UCI to get the handshake done, and
 * otherwise says only what the test tells it to. `bestmove` is never
 * volunteered: a real engine emits it on its own, and the point of most
 * of these tests is what happens in the window before it does.
 *
 * With `autoHandshake` off the test completes the handshake by hand,
 * which is how the boot window is held open long enough to look at.
 */
class FakeWorker {
  static last: FakeWorker | null = null;
  static autoHandshake = true;
  sent: string[] = [];
  terminated = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(_url: string) {
    FakeWorker.last = this;
  }

  postMessage(command: string): void {
    this.sent.push(command);
    if (!FakeWorker.autoHandshake) return;
    if (command === 'uci') this.reply('uciok');
    else if (command === 'isready') this.reply('readyok');
  }

  reply(line: string): void {
    this.onmessage?.({ data: line });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Finish a handshake the worker was holding back. */
  handshake(): void {
    this.reply('uciok');
    this.reply('readyok');
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
  updates: { fen: string; finished: boolean; lines: number }[];
  errors: string[];
} {
  const updates: { fen: string; finished: boolean; lines: number }[] = [];
  const errors: string[] = [];
  const engine = new StockfishEngine(
    'lite-single',
    { threads: 1, hashMb: 16, multiPv: 1 },
    (update) =>
      updates.push({ fen: update.fen, finished: update.finished, lines: update.lines.length }),
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
    FakeWorker.autoHandshake = true;
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
});

/**
 * The boot window: the one analysis in a session that has to wait for a
 * worker to exist, which in practice is the starting position.
 */
describe('StockfishEngine during boot', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('document', { baseURI: 'http://localhost/' });
    FakeWorker.last = null;
    FakeWorker.autoHandshake = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.autoHandshake = true;
  });

  it('sends no position or go until the handshake has finished', async () => {
    const { engine } = makeEngine();
    const first = engine.analyse(A, 20);
    const worker = FakeWorker.last!;

    // A move played while the engine is still booting. NOT awaited here:
    // it now waits for the same handshake, which is the whole fix — await
    // it before completing that handshake and the test deadlocks.
    const second = engine.analyse(B, 20);

    expect(worker.sent).toEqual(['uci']);

    worker.handshake();
    await first;
    await second;

    // Options are configuration, and configuration precedes the first search.
    const firstGo = worker.sent.findIndex((c) => c.startsWith('go'));
    const lastOption = worker.sent.map((c) => c.startsWith('setoption')).lastIndexOf(true);
    expect(firstGo).toBeGreaterThan(lastOption);
  });

  it('ends on the position you are on, not the one you booted from', async () => {
    const { engine, updates } = makeEngine();
    const first = engine.analyse(A, 20);
    const worker = FakeWorker.last!;
    const second = engine.analyse(B, 20);
    worker.handshake();
    await first;
    await second;

    // A is searched first and superseded; B is what the reader is looking at.
    expect(worker.sent).toContain(`position fen ${A}`);
    worker.reply('bestmove e2e4');
    await Promise.resolve();

    expect(worker.sent.at(-2)).toBe(`position fen ${B}`);
    // The settled frame belongs to A, which the store discards; before the
    // fix this was the LAST thing that happened, and the pane kept it.
    expect(updates.at(-1)).toEqual({ fen: A, finished: true, lines: 0 });
    expect(goCount(worker)).toBe(2);
  });
});

describe('StockfishEngine stop watchdog', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('document', { baseURI: 'http://localhost/' });
    FakeWorker.last = null;
    FakeWorker.autoHandshake = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /**
   * `pendingStop` is cleared by exactly two things: a `bestmove` arriving,
   * and terminate(). A worker that stops answering fires no error event —
   * it is alive, just not talking — so without a watchdog every later
   * request parks in a slot nobody drains, silently and for good.
   */
  it('rebuilds the worker once when a stop goes unanswered', async () => {
    const { engine, errors } = makeEngine();
    await engine.analyse(A, 20);
    const wedged = FakeWorker.last!;
    await engine.analyse(B, 20); // sends `stop`; no bestmove will follow

    await vi.advanceTimersByTimeAsync(5_000);

    const fresh = FakeWorker.last!;
    expect(fresh).not.toBe(wedged);
    expect(wedged.terminated).toBe(true);
    // Resumed where the reader actually is.
    expect(fresh.sent).toContain(`position fen ${B}`);
    // And said nothing about it, because one rebuild is not news.
    expect(errors).toEqual([]);
  });

  it('reports it if the rebuilt worker wedges too', async () => {
    const { engine, errors } = makeEngine();
    await engine.analyse(A, 20);
    await engine.analyse(B, 20);
    await vi.advanceTimersByTimeAsync(5_000); // silent rebuild

    await engine.analyse(C, 20); // supersede the resumed search
    await vi.advanceTimersByTimeAsync(5_000);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/stopped responding/i);
  });

  it('disarms when the engine does answer', async () => {
    const { engine, errors } = makeEngine();
    await engine.analyse(A, 20);
    const worker = FakeWorker.last!;
    await engine.analyse(B, 20);

    worker.reply('bestmove e2e4'); // answered in time
    await vi.advanceTimersByTimeAsync(60_000);

    expect(errors).toEqual([]);
    expect(worker.terminated).toBe(false);
    expect(worker.sent).toContain(`position fen ${B}`);
  });
});
