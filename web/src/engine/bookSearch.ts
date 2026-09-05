import type { EngineLine } from '@shared/bookEngine';
import { StockfishEngine, supportsThreads } from './StockfishEngine';
import { terminalScore } from './terminal';

/**
 * The engines an import asks about the positions it read but could not
 * solve from the book (see shared/bookEngine.ts for what is done with the
 * answers).
 *
 * Their own workers, like the adjudicator has its own: an
 * import runs for minutes in the background and must never take the search
 * the reader is watching.
 *
 * A POOL, and single-threaded ones, which is the opposite of what this was.
 * It used to be one engine with four threads, on the reasoning that the
 * machine is idle by the time this runs so a search may as well be a good
 * one. That reasoning holds only if the searches have to happen one after
 * another, and they do not: the boards are independent, exactly as they
 * are in the page scan, which is already read six at a time. Four threads
 * on one position answer the same question better; six positions at once
 * answer six questions. This phase is the only one where a book waits on
 * questions rather than on answers.
 *
 * Each engine is therefore small — one thread, a small hash — because six
 * of them share the machine, and one core is left alone so the app stays
 * usable while this runs.
 *
 * Released when the import ends; nothing else keeps them alive.
 */

/**
 * Same rule as the classification pool: everything but one core.
 *
 * Exported because it is also how many boards the import should have in
 * the air at once — a caller asking for fewer leaves engines idle, and one
 * asking for more just queues.
 */
export const ENGINE_POOL_SIZE = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
const POOL_SIZE = ENGINE_POOL_SIZE;

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

interface Slot {
  engine: StockfishEngine | null;
  /** The one search it is running, or null when it is free. */
  pending: ((line: EngineLine | null) => void) | null;
  /**
   * Which pool this slot belongs to. releaseBookEngine moves the pool on,
   * so a slot handed out by the old one is recognised and dropped rather
   * than booting a fresh engine into a pool that has been given back.
   */
  pool: number;
}

let pool = 0;
const slots: Slot[] = [];
const idle: Slot[] = [];
const waiting: ((slot: Slot) => void)[] = [];

/**
 * Boot one engine into a slot. Lazy and re-entrant: a slot whose worker
 * died comes back through here rather than staying dead for the import.
 */
function ensure(slot: Slot): StockfishEngine {
  slot.engine ??= new StockfishEngine(
    // Single-threaded whatever the browser allows: the parallelism is in
    // the pool now, and threads inside a search would only take cores off
    // the other five.
    supportsThreads() ? 'lite' : 'lite-single',
    { threads: 1, hashMb: 16, multiPv: 1 },
    (update) => {
      if (!update.finished) return;
      const top = update.lines[0];
      const settle = slot.pending;
      slot.pending = null;
      settle?.(top ? { cp: top.cp ?? null, mate: top.mate ?? null, pv: top.moves } : null);
    },
    () => {
      // A dead worker answers "nothing", which degrades the board to a
      // draft rather than stranding the import on a promise. The slot is
      // emptied so the next board boots a fresh engine in its place.
      const settle = slot.pending;
      slot.pending = null;
      settle?.(null);
      slot.engine?.terminate();
      slot.engine = null;
    },
  );
  return slot.engine;
}

/** A free slot, growing the pool up to its size, else the next one back. */
function acquire(): Promise<Slot> {
  const free = idle.pop();
  if (free) return Promise.resolve(free);
  if (slots.length < POOL_SIZE) {
    const slot: Slot = { engine: null, pending: null, pool };
    slots.push(slot);
    return Promise.resolve(slot);
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release(slot: Slot): void {
  if (slot.pool !== pool) return;
  const next = waiting.shift();
  if (next) next(slot);
  else idle.push(slot);
}

/**
 * One position, one search, scored for the side to move. Concurrent calls
 * are what make this worth having: they run on separate engines, up to the
 * pool's width, and queue behind it after that.
 *
 * Null when there is nothing to say — a position already checkmated or
 * stalemated produces no engine line at all, and neither is a puzzle.
 */
export async function searchPosition(fen: string, moveMs: number): Promise<EngineLine | null> {
  if (terminalScore(fen)) return null;
  const slot = await acquire();
  try {
    // The import gave the pool back while this call was queued behind a
    // slot: answer nothing rather than boot an engine nobody is waiting on.
    if (slot.pool !== pool) return null;
    return await new Promise<EngineLine | null>((resolve) => {
      slot.pending = resolve;
      void ensure(slot).analyse(fen, DEPTH, moveMs);
    });
  } finally {
    release(slot);
  }
}

/** Give the engines back once the import is done with them. */
export function releaseBookEngine(): void {
  const gone = pool;
  pool += 1;
  idle.splice(0);
  for (const slot of slots.splice(0)) {
    const settle = slot.pending;
    slot.pending = null;
    settle?.(null);
    slot.engine?.terminate();
    slot.engine = null;
  }
  // Anything still queued for a slot is handed one from the pool that has
  // just gone, and answers nothing rather than waiting for an engine that
  // is never coming back.
  for (const wake of waiting.splice(0)) wake({ engine: null, pending: null, pool: gone });
}
