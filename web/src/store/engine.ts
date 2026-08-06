import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  defaultFlavor,
  StockfishEngine,
  supportsThreads,
  type EngineFlavor,
  type SearchUpdate,
} from '@/engine/StockfishEngine';
import type { PvLine } from '@/engine/uci';

/** Sensible default: leave a couple of cores for the UI. */
const defaultThreads = (): number => {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(8, cores - 2));
};

interface EngineState {
  /** User's on/off switch. Off means no worker exists at all. */
  enabled: boolean;
  flavor: EngineFlavor;
  threads: number;
  hashMb: number;
  multiPv: number;
  depth: number;

  // -- live search state --
  /** FEN the current results belong to; guards against stale updates. */
  resultFen: string | null;
  lines: PvLine[];
  bestMove: string | null;
  finished: boolean;
  error: string | null;
  threadsAvailable: boolean;

  setEnabled: (on: boolean) => void;
  toggle: () => void;
  setOption: (patch: Partial<Pick<EngineState, 'threads' | 'hashMb' | 'multiPv' | 'depth'>>) => void;
  /** Analyse a position, or clear results if the engine is off. */
  analyse: (fen: string) => void;
  stop: () => void;
  clearResults: () => void;
}

/**
 * The engine driver lives outside the store.
 *
 * A `Worker` is not serialisable and must never end up in persisted state or in
 * React's render path, so the store holds only plain data and this module-level
 * handle owns the worker.
 */
let engine: StockfishEngine | null = null;
/** Position requested while the worker was still booting. */
let pendingFen: string | null = null;

export const useEngine = create<EngineState>()(
  persist(
    (set, get) => {
      const onUpdate = (update: SearchUpdate): void => {
        // Drop results for a position we have already navigated away from.
        if (pendingFen && update.fen !== pendingFen) return;
        set({
          resultFen: update.fen,
          lines: update.lines,
          bestMove: update.bestMove ?? null,
          finished: update.finished,
        });
      };

      const onError = (message: string): void => {
        set({ error: message, enabled: false });
        engine?.terminate();
        engine = null;
      };

      const ensureEngine = (): StockfishEngine => {
        if (!engine) {
          const { flavor, threads, hashMb, multiPv } = get();
          engine = new StockfishEngine(
            flavor,
            { threads, hashMb, multiPv },
            onUpdate,
            onError,
          );
        }
        return engine;
      };

      return {
        enabled: false,
        flavor: 'lite',
        threads: 2,
        hashMb: 128,
        multiPv: 3,
        depth: 22,

        resultFen: null,
        lines: [],
        bestMove: null,
        finished: false,
        error: null,
        threadsAvailable: true,

        setEnabled: (on) => {
          if (!on) {
            // Off means off: free the worker's memory rather than idling it.
            engine?.terminate();
            engine = null;
            pendingFen = null;
            set({ enabled: false, lines: [], bestMove: null, resultFen: null, finished: false });
            return;
          }
          set({ enabled: true, error: null, threadsAvailable: supportsThreads() });
          if (pendingFen) void ensureEngine().analyse(pendingFen, get().depth);
        },

        toggle: () => get().setEnabled(!get().enabled),

        setOption: (patch) => {
          set(patch);
          const { threads, hashMb, multiPv } = get();
          engine?.setOptions({ threads, hashMb, multiPv });
          // Re-run so the change is visible immediately rather than next move.
          if (get().enabled && pendingFen) {
            set({ lines: [], finished: false });
            void engine?.analyse(pendingFen, get().depth);
          }
        },

        analyse: (fen) => {
          pendingFen = fen;
          if (!get().enabled) return;
          // Clear straight away so the pane never shows another position's eval.
          set({ lines: [], bestMove: null, finished: false, resultFen: null });
          void ensureEngine().analyse(fen, get().depth);
        },

        stop: () => engine?.stop(),

        clearResults: () =>
          set({ lines: [], bestMove: null, resultFen: null, finished: false }),
      };
    },
    {
      name: 'chess-vault:engine',
      // Only preferences persist; live search state must not survive a reload.
      // `enabled` is deliberately NOT persisted: the engine always starts off
      // (lanph3re's preference) and is switched on per session when wanted.
      partialize: (s) => ({
        flavor: s.flavor,
        threads: s.threads,
        hashMb: s.hashMb,
        multiPv: s.multiPv,
        depth: s.depth,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Older persisted blobs carried `enabled` — force the always-off start.
        state.enabled = false;
        // First run: size threads to this machine rather than shipping a guess.
        if (state.threads === 2 && navigator.hardwareConcurrency) {
          state.threads = defaultThreads();
        }
        if (!supportsThreads()) {
          state.flavor = defaultFlavor();
          state.threadsAvailable = false;
        }
      },
    },
  ),
);
