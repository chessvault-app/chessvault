import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchUpdate } from '@/engine/StockfishEngine';

/**
 * A driver that never boots a worker, and hands the test the store's own
 * `onUpdate` so a late message can be delivered by hand — which is the
 * whole subject here: what the store does with results that arrive after
 * it has stopped wanting them.
 */
const sent: string[] = [];
let emit: ((update: SearchUpdate) => void) | null = null;

vi.mock('@/engine/StockfishEngine', () => ({
  supportsThreads: () => false,
  defaultFlavor: () => 'lite-single',
  StockfishEngine: class {
    constructor(
      _flavor: string,
      _options: unknown,
      onUpdate: (update: SearchUpdate) => void,
    ) {
      emit = onUpdate;
    }
    analyse(fen: string): Promise<void> {
      sent.push(fen);
      return Promise.resolve();
    }
    setOptions(): void {}
    stop(): void {}
    terminate(): void {}
  },
}));

const { useEngine } = await import('./engine.ts');

const A = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const B = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

const line = { multipv: 1, depth: 18, cp: 31, moves: ['e2e4'] } as never;

describe('the engine store drops results it did not ask for', () => {
  beforeEach(() => {
    sent.length = 0;
    useEngine.setState({ enabled: false, lines: [], resultFen: null, finished: false });
  });

  it('keeps nothing from a search that was switched off mid-flight', () => {
    useEngine.getState().analyse(A);
    useEngine.getState().setEnabled(true);
    emit?.({ fen: A, lines: [line], finished: false });
    expect(useEngine.getState().lines).toHaveLength(1);

    // Switching off stops the search, but the worker answers the `stop`
    // a few milliseconds later, and a coalesced frame may still be armed.
    useEngine.getState().setEnabled(false);
    emit?.({ fen: A, lines: [line], finished: true });

    expect(useEngine.getState().lines).toEqual([]);
    expect(useEngine.getState().resultFen).toBeNull();
  });

  it('shows nothing from the last position when switched on at a new one', () => {
    // The state a leaked late update leaves behind.
    useEngine.setState({ lines: [line], resultFen: A, finished: true });

    useEngine.getState().analyse(B); // the new page's pane, engine still off
    useEngine.getState().setEnabled(true);

    expect(useEngine.getState().resultFen).toBeNull();
    expect(useEngine.getState().lines).toEqual([]);
    expect(sent).toEqual([B]);
  });
});
