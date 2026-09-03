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
  /** Seconds a single search may run for; 0 is no cap. See the default. */
  moveSeconds: number;

  // -- live search state --
  /** FEN the current results belong to; guards against stale updates. */
  resultFen: string | null;
  lines: PvLine[];
  finished: boolean;
  error: string | null;
  threadsAvailable: boolean;

  setEnabled: (on: boolean) => void;
  /**
   * The engine is on but not searching: a review has the cores. Nothing
   * about `enabled` changes, so the eval bar keeps its lane and the panel
   * its shape, which is the point: a review used to switch the engine
   * off and back on, and the board column grew and shrank by the bar's
   * lane at both ends of it (lanph3re's report). Positions asked for
   * while held are remembered and the last one is searched on release.
   */
  held: boolean;
  hold: () => void;
  release: () => void;
  toggle: () => void;
  setOption: (patch: Partial<Pick<EngineState, 'threads' | 'hashMb' | 'multiPv' | 'depth' | 'moveSeconds'>>) => void;
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

/**
 * How long a switched-off engine is kept before its worker is destroyed.
 *
 * Switching off used to terminate immediately, which is right for "off
 * means off — free the worker's memory rather than idling it" and wrong
 * for the thing people actually do, which is toggle. Every switch-on
 * builds a new worker and a new Hash table — 128MB by default, on a phone
 * as much as a desktop — so flicking the engine on and off N times asked
 * for that allocation N times. Desktop Chrome reclaims it between clicks
 * and never notices; a phone reclaims WASM memory lazily against a much
 * lower ceiling, and lanph3re got it to throw OOM.
 *
 * A grace period costs one idle worker for ten seconds and collapses a
 * burst of toggling onto ONE allocation. Off for real is still off, ten
 * seconds later.
 */
const IDLE_TEARDOWN_MS = 10_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const holdIdleTeardown = (): void => {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};


export const useEngine = create<EngineState>()(
  persist(
    (set, get) => {
      const onUpdate = (update: SearchUpdate): void => {
        /**
         * Only results this store is still waiting for.
         *
         * The guard used to be `pendingFen && update.fen !== pendingFen`,
         * which let everything through in the one state where nothing
         * should be: switched OFF, where `pendingFen` is null. Off does
         * not silence the worker instantly — `stop` is answered by a
         * `bestmove` a round trip later, and a coalesced `info` frame can
         * still be armed — so the last search's lines landed in the store
         * a few milliseconds AFTER setEnabled(false) had cleared them.
         * Invisible at the time, because nothing renders while the engine
         * is off, and still there whenever it was switched back on:
         * lanph3re saw one position's answer under another position's
         * board. Two conditions, both of which have to hold for a result
         * to be wanted at all.
         */
        if (!get().enabled || update.fen !== pendingFen) return;
        set({
          resultFen: update.fen,
          lines: update.lines,
          finished: update.finished,
        });
      };

      const onError = (message: string): void => {
        set({ error: message, enabled: false });
        holdIdleTeardown();
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
        /**
         * A ceiling on the clock, because depth is a target and not a
         * promise about time.
         *
         * The note above measures the depth-to-seconds rate on one machine
         * and picks a depth from it — but that rate varies by an order of
         * magnitude between a desktop and a phone, and by a good deal more
         * between a quiet endgame and a sharp middlegame. So the one dial
         * cannot be set correctly for both, and where it is set too high
         * the symptom is not "slow": the pane clears itself when a search
         * starts and only fills in when lines arrive, and the repertoire's
         * final assessment waits for `bestmove` before it shows anything at
         * all — so a long search looks like a hang, which is what lanph3re
         * reported.
         *
         * Sent ALONGSIDE the depth, never instead of it (see the `go` in
         * StockfishEngine): whichever limit is reached first ends the
         * search, so a desktop still gets its full depth and only the
         * device that would have run for a minute is cut short.
         *
         * 10 seconds is a backstop rather than a budget — comfortably above
         * the 2.0s the measured depth-18 search takes on that desktop, and
         * well below the point where a reader concludes nothing is
         * happening. 0 turns it off for anyone who wants the depth whatever
         * it costs.
         */
        moveSeconds: 10,

        resultFen: null,
        lines: [],
        finished: false,
        error: null,
        threadsAvailable: true,

        setEnabled: (on) => {
          if (!on) {
            // Stop searching now; free the worker shortly (IDLE_TEARDOWN_MS).
            holdIdleTeardown();
            engine?.stop();
            pendingFen = null;
            requestedFen = null;
            set({ enabled: false, lines: [], resultFen: null, finished: false });
            idleTimer = setTimeout(() => {
              idleTimer = null;
              engine?.terminate();
              engine = null;
            }, IDLE_TEARDOWN_MS);
            return;
          }
          // Back on within the grace period: the worker is still here.
          holdIdleTeardown();
          // Cleared here as well as on the way off, because the way off is
          // not the only way results get in (see onUpdate) and because a
          // switch-on starts a search rather than finishing one: until its
          // first update arrives there is nothing to show, and whatever is
          // left in the store is by definition an older position's.
          set({
            enabled: true,
            error: null,
            threadsAvailable: supportsThreads(),
            lines: [],
            resultFen: null,
            finished: false,
          });
          if (pendingFen) {
            requestedFen = pendingFen;
            void ensureEngine().analyse(pendingFen, get().depth, get().moveSeconds * 1000);
          }
        },

        toggle: () => get().setEnabled(!get().enabled),

        held: false,
        hold: () => {
          if (get().held) return;
          engine?.stop();
          requestedFen = null;
          // The last result stays on screen: it is still this position's,
          // and a bar that blanks for the length of a review is the pop
          // this exists to remove, in a quieter form.
          set({ held: true });
        },
        release: () => {
          if (!get().held) return;
          set({ held: false });
          if (get().enabled && pendingFen && pendingFen !== get().resultFen) {
            requestedFen = pendingFen;
            set({ lines: [], finished: false, resultFen: null });
            void ensureEngine().analyse(pendingFen, get().depth, get().moveSeconds * 1000);
          }
        },

        setOption: (patch) => {
          set(patch);
          const { threads, hashMb, multiPv } = get();
          engine?.setOptions({ threads, hashMb, multiPv });
          // Re-run so the change is visible immediately rather than next move.
          if (get().enabled && !get().held && pendingFen) {
            set({ lines: [], finished: false });
            void engine?.analyse(pendingFen, get().depth, get().moveSeconds * 1000);
          }
        },

        analyse: (fen) => {
          if (get().enabled && fen === requestedFen) return; // the twin pane's echo
          pendingFen = fen;
          if (!get().enabled) return;
          if (get().held) {
            // Remembered for release. The old result is cleared here as it
            // is below: the bar stays, but never shows another position's eval.
            if (fen !== get().resultFen) set({ lines: [], finished: false, resultFen: null });
            return;
          }
          requestedFen = fen;
          // Clear straight away so the pane never shows another position's eval.
          set({ lines: [], finished: false, resultFen: null });
          void ensureEngine().analyse(fen, get().depth, get().moveSeconds * 1000);
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
        moveSeconds: s.moveSeconds,
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
