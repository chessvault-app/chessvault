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
  finished: boolean;
  error: string | null;
  threadsAvailable: boolean;

  setEnabled: (on: boolean) => void;
  toggle: () => void;
  setOption: (patch: Partial<Pick<EngineState, 'threads' | 'hashMb' | 'multiPv' | 'depth'>>) => void;
  /** Analyse a position, or clear results if the engine is off. */
  analyse: (fen: string) => void;
  stop: () => void;
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
/**
 * The fen a live search was last STARTED for. Two EngineBlocks are
 * mounted at once (desktop docked + phone tab, one CSS-hidden) and both
 * run the re-analyse effect, so every position change used to arrive
 * here twice: the second call saw a running search and go→stop→go'd the
 * SAME fen — a flash of shallow "finished" eval and a wasted restart.
 * A repeat of the fen already being searched is dropped instead. Reset
 * wherever the search stops being live, so a remounted pane (navigate
 * away and back) re-analyses the same position.
 */
let requestedFen: string | null = null;

export const useEngine = create<EngineState>()(
  persist(
    (set, get) => {
      const onUpdate = (update: SearchUpdate): void => {
        // Drop results for a position we have already navigated away from.
        if (pendingFen && update.fen !== pendingFen) return;
        set({
          resultFen: update.fen,
          lines: update.lines,
          finished: update.finished,
        });
      };

      const onError = (message: string): void => {
        set({ error: message, enabled: false });
        engine?.terminate();
        engine = null;
        requestedFen = null;
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
        /**
         * 18, not 22.
         *
         * The last plies are where the time goes. Measured on a 12-core
         * desktop at ~8.5M nps, one middlegame position, multiPv 3:
         * depth 14 at 1.0s, 18 at 2.0s, 20 at 3.0s, 22 at 4.8s — so the
         * three plies past 18 cost more than everything before them. A
         * phone runs this an order of magnitude slower, which is where
         * "the lines take forever" comes from.
         *
         * Lines still appear as they are found (depth 10 inside half a
         * second here), so this is not about the first result; it is
         * about how long the fan runs for the last one. Adjustable in the
         * engine's settings, and persisted, so anyone who wants 22 keeps
         * it.
         */
        depth: 18,

        resultFen: null,
        lines: [],
        finished: false,
        error: null,
        threadsAvailable: true,

        setEnabled: (on) => {
          if (!on) {
            // Off means off: free the worker's memory rather than idling it.
            engine?.terminate();
            engine = null;
            pendingFen = null;
            requestedFen = null;
            set({ enabled: false, lines: [], resultFen: null, finished: false });
            return;
          }
          set({ enabled: true, error: null, threadsAvailable: supportsThreads() });
          if (pendingFen) {
            requestedFen = pendingFen;
            void ensureEngine().analyse(pendingFen, get().depth);
          }
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
          if (get().enabled && fen === requestedFen) return; // the twin pane's echo
          pendingFen = fen;
          if (!get().enabled) return;
          requestedFen = fen;
          // Clear straight away so the pane never shows another position's eval.
          set({ lines: [], finished: false, resultFen: null });
          void ensureEngine().analyse(fen, get().depth);
        },

        stop: () => {
          requestedFen = null;
          engine?.stop();
        },
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
