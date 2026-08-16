import { parseEvalTrace, type EvalTrace } from './evalTrace.ts';
import { defaultFlavor, StockfishEngine, supportsThreads } from './StockfishEngine.ts';

/**
 * One lazy worker for eval traces, separate from the interactive engine
 * on purpose: a trace must never steal the search the user is watching,
 * and the interactive engine must never abort a trace mid-answer. Calls
 * are serialised on a promise queue (the driver runs one thing at a time
 * by design), and results are cached by the store that asks, not here.
 *
 * Small on purpose: two threads and 32 MB of hash. A trace is a single
 * forward pass; the interactive engine is the one that owns the machine.
 */

const PROBE_HASH_MB = 32;

let engine: StockfishEngine | null = null;
let queue: Promise<unknown> = Promise.resolve();

function ensureEngine(): StockfishEngine {
  engine ??= new StockfishEngine(
    defaultFlavor(),
    {
      threads: supportsThreads()
        ? Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 4) - 2))
        : 1,
      hashMb: PROBE_HASH_MB,
      multiPv: 1,
    },
    () => {},
    () => {
      // A dead worker is discarded; the next trace boots a fresh one.
      engine?.terminate();
      engine = null;
    },
  );
  return engine;
}

/** Run the NNUE eval trace. Null when the build has no `eval` command. */
export function probeEvalTrace(fen: string): Promise<EvalTrace | null> {
  const run = queue.then(async () => {
    const eng = ensureEngine();
    await eng.start();
    try {
      return parseEvalTrace(await eng.evalTrace(fen));
    } catch {
      return null;
    }
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Free the worker's memory once nothing on screen needs probes. */
export function releaseProbeWorker(): void {
  engine?.terminate();
  engine = null;
}
