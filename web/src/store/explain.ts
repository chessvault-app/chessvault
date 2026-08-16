import { create } from 'zustand';
import type { TracePiece } from '@/engine/evalTrace';
import { probeEvalTrace, releaseProbeWorker } from '@/engine/probe';

/**
 * State for the piece-value heat map. Plain data only — the probe worker
 * lives in engine/probe.ts, module-level, exactly like the interactive
 * engine's driver lives outside its store.
 */

interface HeatData {
  fen: string;
  pieces: Record<string, TracePiece>;
}

interface ExplainState {
  /** The board overlay's toggle. Off by default; loud things must be asked for. */
  heatOn: boolean;
  heat: HeatData | null;
  /**
   * Set after the first trace comes back unparseable — the engine build
   * has no `eval` command, so the toggle hides rather than dangling a
   * feature that can never answer.
   */
  heatUnsupported: boolean;

  toggleHeat: () => void;
  /** Fetch the trace for a position if the overlay is on and lacks it. */
  ensureHeat: (fen: string) => void;
}

/** FEN of the trace in flight, so a second render never double-asks. */
let heatRequested: string | null = null;

export const useExplain = create<ExplainState>()((set, get) => ({
  heatOn: false,
  heat: null,
  heatUnsupported: false,

  toggleHeat: () => {
    const on = !get().heatOn;
    set({ heatOn: on, ...(on ? {} : { heat: null }) });
    if (!on) {
      heatRequested = null;
      // The worker is real memory (WASM heap); an idle overlay gives it back.
      releaseProbeWorker();
    }
  },

  ensureHeat: (fen) => {
    if (!get().heatOn || get().heatUnsupported) return;
    if (get().heat?.fen === fen || heatRequested === fen) return;
    heatRequested = fen;
    void probeEvalTrace(fen).then((trace) => {
      // Only the answer to the newest question counts.
      if (heatRequested !== fen || !get().heatOn) return;
      heatRequested = null;
      if (!trace) {
        set({ heatUnsupported: true, heatOn: false, heat: null });
        releaseProbeWorker();
        return;
      }
      set({ heat: { fen, pieces: trace.pieces } });
    });
  },
}));
