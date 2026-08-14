import { parseEvalTrace, type EvalTrace } from './evalTrace.ts';
import {
  defaultFlavor,
  StockfishEngine,
  supportsThreads,
  type SearchUpdate,
} from './StockfishEngine.ts';
import type { PvLine } from './uci.ts';

/**
 * One lazy worker for every explanation probe — threat searches, why-not
 * searches, eval traces. Separate from the interactive engine on purpose:
 * a probe must never steal the search the user is watching, and the
 * interactive engine must never abort a probe mid-answer. Calls are
 * serialised on a promise queue (the driver runs one thing at a time by
 * design), and results are cached by the stores that ask, not here.
 *
 * Small on purpose: two threads and 32 MB of hash. Probes answer
 * qualitative questions at modest depth; the interactive engine is the
 * one that owns the machine.
 */

const PROBE_HASH_MB = 32;

let engine: StockfishEngine | null = null;
let resolveSearch: ((update: SearchUpdate) => void) | null = null;
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
    (update) => {
      if (update.finished) resolveSearch?.(update);
    },
    () => {
      // A dead worker answers what it can (nothing) rather than hanging
      // whoever is waiting; the next probe boots a fresh one.
      resolveSearch?.({ fen: '', lines: [], finished: true });
      engine?.terminate();
      engine = null;
    },
  );
  return engine;
}

/**
 * Search a position to a fixed depth and resolve with the final lines.
 * `searchMoves` restricts the root — "and if I play THIS?". Resolves []
 * for terminal positions and on engine failure.
 */
export function probeSearch(fen: string, depth: number, searchMoves?: string[]): Promise<PvLine[]> {
  const run = queue.then(
    () =>
      new Promise<PvLine[]>((resolve) => {
        resolveSearch = (update) => {
          resolveSearch = null;
          resolve(update.fen === fen ? update.lines : []);
        };
        void ensureEngine().analyse(fen, depth, searchMoves);
      }),
  );
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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
