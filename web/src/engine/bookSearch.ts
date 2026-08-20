import type { EngineLine } from '@shared/bookEngine';
import { defaultFlavor, StockfishEngine, supportsThreads } from './StockfishEngine';
import { terminalScore } from './terminal';

/**
 * The engine an import asks about a position it read but could not solve
 * from the book (see shared/bookEngine.ts for what is done with the
 * answer).
 *
 * Its own worker, like the probe and the adjudicator have theirs: an
 * import runs for minutes in the background and must never take the search
 * the reader is watching. It is the opposite of the probe in size, though
 * — by the time this runs the page scan is finished and the machine is
 * idle, and every search here is a fixed half-second in which more threads
 * simply mean a better answer for the same wait.
 *
 * Released when the import ends; nothing else keeps it alive.
 */

let engine: StockfishEngine | null = null;
let resolveSearch: ((line: EngineLine | null) => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Deep enough that the time limit is always the one that binds. */
const DEPTH = 40;

function ensureEngine(): StockfishEngine {
  engine ??= new StockfishEngine(
    defaultFlavor(),
    {
      threads: supportsThreads() ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)) : 1,
      hashMb: 64,
      multiPv: 1,
    },
    (update) => {
      if (!update.finished) return;
      const top = update.lines[0];
      resolveSearch?.(
        top ? { cp: top.cp ?? null, mate: top.mate ?? null, pv: top.moves } : null,
      );
      resolveSearch = null;
    },
    () => {
      // A dead worker answers "nothing", which degrades the board to a
      // draft rather than stranding the import on a promise.
      resolveSearch?.(null);
      resolveSearch = null;
      engine?.terminate();
      engine = null;
    },
  );
  return engine;
}

/**
 * One position, one fixed-time search, scored for the side to move.
 *
 * Null when there is nothing to say — a position already checkmated or
 * stalemated produces no engine line at all, and neither is a puzzle.
 */
export function searchPosition(fen: string, moveMs: number): Promise<EngineLine | null> {
  if (terminalScore(fen)) return Promise.resolve(null);
  const run = queue.then(
    () =>
      new Promise<EngineLine | null>((resolve) => {
        resolveSearch = resolve;
        void ensureEngine().analyse(fen, DEPTH, moveMs);
      }),
  );
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Give the worker back once the import is done with it. */
export function releaseBookEngine(): void {
  engine?.terminate();
  engine = null;
  resolveSearch?.(null);
  resolveSearch = null;
}
