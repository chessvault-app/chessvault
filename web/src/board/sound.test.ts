import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The context has to be RUNNING before a sample is started on it.
 *
 * An iPhone parks the audio context in WebKit's `interrupted` state for a
 * call, for Siri, for another app taking the audio session, and for a
 * home-screen app being switched away from. The board went quiet from
 * there and stayed quiet: the resume was gated on `suspended` exactly, so
 * an interrupted context was never woken and every later move started a
 * source that would never be heard. These pin the two halves of the fix —
 * that any non-running state is resumed, and that the start waits for the
 * resume instead of racing it.
 */

/** The least AudioContext the module needs, with its state under test control. */
class FakeContext {
  state: string;
  destination = {};
  started: string[] = [];
  resumes = 0;
  private release: (() => void) | null = null;
  private listeners: (() => void)[] = [];
  constructor(state: string) {
    this.state = state;
  }
  resume(): Promise<void> {
    this.resumes += 1;
    // Held open, so a test can assert what happens BEFORE the resume lands.
    return new Promise((resolve) => {
      this.release = () => {
        this.state = 'running';
        this.listeners.forEach((l) => l());
        resolve();
      };
    });
  }
  /** The interruption ends. */
  wake(): Promise<void> {
    this.release?.();
    this.release = null;
    // Two turns: the resume's own continuation, then the play chained onto it.
    return Promise.resolve().then(() => undefined);
  }
  addEventListener(_: string, fn: () => void): void {
    this.listeners.push(fn);
  }
  createGain() {
    return { gain: { value: 0 }, connect: () => {} };
  }
  createBufferSource() {
    const self = this;
    return {
      set buffer(b: { name: string }) {
        this._b = b;
      },
      get buffer() {
        return this._b;
      },
      _b: { name: '' } as { name: string },
      connect: () => {},
      start(): void {
        self.started.push(this._b.name);
      },
    };
  }
  decodeAudioData(): Promise<{ name: string }> {
    return Promise.resolve({ name: 'sample' });
  }
}

let context: FakeContext;

async function load(state: string) {
  context = new FakeContext(state);
  vi.stubGlobal('AudioContext', function () {
    return context;
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: () => {},
  });
  vi.stubGlobal('fetch', () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
  vi.resetModules();
  return import('@/board/sound');
}

/** Let the fetch, the decode and the play chained after them settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

describe('move sounds', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('resumes a context that is interrupted, not only one that is suspended', async () => {
    const { playSound } = await load('interrupted');
    playSound('move');
    await settle();
    expect(context.resumes).toBe(1);
  });

  it('holds the sample until the resume lands, then plays it', async () => {
    const { playSound } = await load('interrupted');
    playSound('move');
    await settle();
    // Still interrupted: a source started here is one WebKit is free to drop.
    expect(context.started).toEqual([]);

    await context.wake();
    await settle();
    expect(context.started).toEqual(['sample']);
  });

  it('plays with no wait at all once the context is running', async () => {
    const { playSound } = await load('running');
    playSound('move'); // first move of the session: the decode is the only wait
    await settle();
    expect(context.resumes).toBe(0);
    expect(context.started).toEqual(['sample']);

    // The same take again: decoded, context running, nothing left to wait for.
    playSound('move');
    expect(context.started).toEqual(['sample', 'sample']); // synchronous, no turn of the loop
  });
});
