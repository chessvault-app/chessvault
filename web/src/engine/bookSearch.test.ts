import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The import's engines are a POOL, which is the whole point of them: the
 * boards are independent and the phase is nothing but waiting on searches.
 * What is worth pinning down is the edges of that — that the pool's width
 * is really a limit, that a board queued behind it still gets an engine,
 * and that giving the pool back does not strand a caller on a promise or
 * quietly boot a replacement engine for a book nobody is importing.
 */
class FakeWorker {
  static all: FakeWorker[] = [];
  sent: string[] = [];
  terminated = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(_url: string) {
    FakeWorker.all.push(this);
  }

  postMessage(command: string): void {
    this.sent.push(command);
    if (command === 'uci') this.reply('uciok');
    else if (command === 'isready') this.reply('readyok');
  }

  reply(line: string): void {
    this.onmessage?.({ data: line });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answer the search in flight, the way a real engine ends one. */
  finish(cp: number, pv = 'e2e4 e7e5'): void {
    this.reply(`info depth 16 multipv 1 score cp ${cp} nodes 1000 nps 1000 time 5 pv ${pv}`);
    this.reply(`bestmove ${pv.split(' ')[0]}`);
  }

  get searching(): boolean {
    return this.sent.some((c) => c.startsWith('go'));
  }
}

/** Four distinct legal positions, none of them already over. */
const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
];

type BookSearch = typeof import('./bookSearch.ts');

/** Loaded per test, because the pool's width is read at module load. */
async function load(cores: number): Promise<BookSearch> {
  vi.stubGlobal('navigator', { hardwareConcurrency: cores });
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { baseURI: 'http://localhost/' });
  vi.resetModules();
  return import('./bookSearch.ts');
}

/** Let the queued promise callbacks run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('the import engine pool', () => {
  beforeEach(() => {
    FakeWorker.all = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches the pool’s width at once and queues the rest', async () => {
    // Four cores, so three engines: everything but one.
    const { searchPosition } = await load(4);
    const answers = FENS.map((fen) => searchPosition(fen, 500));
    await settle();

    expect(FakeWorker.all).toHaveLength(3);
    expect(FakeWorker.all.every((w) => w.searching)).toBe(true);

    // The fourth board is waiting for an engine, not for a fourth engine.
    FakeWorker.all[0]!.finish(120);
    await settle();
    expect(FakeWorker.all).toHaveLength(3);
    expect(FakeWorker.all[0]!.sent.filter((c) => c.startsWith('go'))).toHaveLength(2);

    await expect(answers[0]).resolves.toEqual({ cp: 120, mate: null, pv: ['e2e4', 'e7e5'] });

    for (const w of FakeWorker.all) if (w.searching) w.finish(40);
    await settle();
    await Promise.all(answers);
  });

  it('runs on one engine when the machine has one core to spare', async () => {
    const { searchPosition } = await load(2);
    void searchPosition(FENS[0]!, 500);
    void searchPosition(FENS[1]!, 500);
    await settle();
    expect(FakeWorker.all).toHaveLength(1);
  });

  it('answers nothing, rather than hanging, when the pool is given back', async () => {
    const { searchPosition, releaseBookEngine } = await load(4);
    const running = FENS.map((fen) => searchPosition(fen, 500));
    await settle();

    releaseBookEngine();
    // Both the three in flight and the one queued behind them: a board
    // that answers null degrades to a draft, which an import can finish
    // with. A promise nobody resolves is one it never finishes at all.
    await expect(Promise.all(running)).resolves.toEqual([null, null, null, null]);
    expect(FakeWorker.all.every((w) => w.terminated)).toBe(true);

    // And the board that was still queued did not boot a replacement.
    await settle();
    expect(FakeWorker.all).toHaveLength(3);
  });

  it('boots a fresh pool for the next import', async () => {
    const { searchPosition, releaseBookEngine } = await load(4);
    void searchPosition(FENS[0]!, 500);
    await settle();
    releaseBookEngine();

    const next = searchPosition(FENS[1]!, 500);
    await settle();
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1]!.finish(75);
    await expect(next).resolves.toMatchObject({ cp: 75 });
  });

  it('says nothing about a position that is already over', async () => {
    const { searchPosition } = await load(4);
    // Checkmate on the board: no search, and no engine booted for it.
    await expect(
      searchPosition('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 500),
    ).resolves.toBeNull();
    expect(FakeWorker.all).toHaveLength(0);
  });
});
