import { create } from 'zustand';
import { probeEvalTrace, releaseProbeWorker } from '@/engine/probe';
import type { TracePiece } from '@/engine/evalTrace';

/**
 * State for the explanation features: the piece-value heat map here, the
 * Why card's probes alongside. Plain data only — the probe worker lives
 * in engine/probe.ts, module-level, exactly like the interactive engine's
 * driver lives outside its store.
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
let requested: string | null = null;

export const useExplain = create<ExplainState>()((set, get) => ({
  heatOn: false,
  heat: null,
  heatUnsupported: false,

  toggleHeat: () => {
    const on = !get().heatOn;
    set({ heatOn: on, ...(on ? {} : { heat: null }) });
    if (!on) {
      requested = null;
      // The worker is ~50 MB of WASM heap; an off toggle should give it back.
      releaseProbeWorker();
    }
  },

  ensureHeat: (fen) => {
    if (!get().heatOn || get().heatUnsupported) return;
    if (get().heat?.fen === fen || requested === fen) return;
    requested = fen;
    void probeEvalTrace(fen).then((trace) => {
      // Only the answer to the newest question counts.
      if (requested !== fen || !get().heatOn) return;
      requested = null;
      if (!trace) {
        set({ heatUnsupported: true, heatOn: false, heat: null });
        releaseProbeWorker();
        return;
      }
      set({ heat: { fen, pieces: trace.pieces } });
    });
  },
}));
