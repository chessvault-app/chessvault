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

/**
 * The limit that normally binds; the caller's millisecond budget is the
 * backstop behind it.
 *
 * This was 40 — deliberately unreachable, so that the clock ended every
 * search. That made the phase cost exactly its budget: a flat half second
 * a position, on a machine with eleven idle cores, whatever the position
 * was. Measured over 81 candidate boards from '1001 Chess Exercises for
 * Beginners' in this worker, half of them spent the whole 500 ms.
 *
 * Depth 16 on ONE thread reads the same 81 in 6.5 s against 26.5 s for
 * depth 40 at four threads. It agrees with a 3 s reference search on 74 of
 * them where the old setting agreed on 80, and the six it gives up are
 * boards it declines to call decisive — they import a tier lower, badged,
 * rather than wrongly. False verdicts, where a shallow search calls a
 * position winning that a long one does not, were one in 81; and nothing
 * is stored on the engine's word anyway, since every line is replayed from
 * the fen before it is written.
 */
const DEPTH = 16;

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
