import type { CellCandidates } from '@shared/bookRepair';
import type { CellReading } from './classify';
import type { Gray } from './image';

/**
 * The CellNet worker pool, shared by the puzzle importer and the library's
 * diagram job (books/diagramJob.ts). It lived inside importJob.ts until the
 * diagram job arrived and read boards on the main thread, one at a time —
 * five seconds a page where the importer, with the pool, takes one.
 */

/**
 * The classification pool.
 *
 * Reading one board is ~950 ms of CellNet inference and nothing else:
 * measured over 212 boards of '1001 Chess Exercises', classifyBoardNet is
 * 948 ms of a 1014 ms board, against 62 ms to warp it, 5 ms to find its
 * corners and 8 ms to detect a whole page's diagrams. A book is a thousand
 * boards, so on ONE worker a scan is twenty minutes with every other core
 * idle — the offline pipeline gets 4.3x out of the same work simply by
 * sharding it across six processes.
 *
 * Boards are independent, so they go out to a pool instead. One core is
 * left alone: the main thread still has to render pages, cut crops and
 * keep the app usable while this runs in the background.
 */
export const POOL_SIZE = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));

/** What the worker sends back, before it is turned into either answer. */
interface WorkerReply {
  readings?: CellReading[] | null;
  cells?: { probs: number[]; top: number; votes: [number, number][] }[] | null;
  labels?: string[];
}

interface Job {
  id: number;
  detail: boolean;
  w: number;
  h: number;
  data: ArrayBuffer;
  /** null = the worker died holding this board; the caller degrades. */
  settle: (reply: WorkerReply | null) => void;
}

interface PoolWorker {
  w: Worker;
  /** The one board it is reading, or null when it is free. */
  job: Job | null;
}

const pool: PoolWorker[] = [];
const queue: Job[] = [];
let nextId = 0;

/**
 * How many jobs are holding the pool open. Two jobs can share it — a
 * puzzle import and a library book's diagram pass — and either finishing
 * must not terminate workers the other still has boards out with, which
 * is what releasePool() does to a queue: the boards come back unread.
 * A job that takes a lease keeps the pool alive until it lets go; the
 * release is idempotent, since the importer releases from two places.
 */
let leases = 0;

/** Hold the pool open; returns the release, which releases once. */
export function leasePool(): () => void {
  leases++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    leases--;
    releasePool();
  };
}

/** Boot a worker. Lazy, so the chunk only loads when a scan starts. */
function spawn(): PoolWorker {
  const entry: PoolWorker = {
    w: new Worker(new URL('./cellnet.worker.ts', import.meta.url), { type: 'module' }),
    job: null,
  };
  entry.w.onmessage = (e: MessageEvent) => {
    const job = entry.job;
    entry.job = null;
    job?.settle(e.data as WorkerReply);
    pump();
  };
  // A crashed worker must not strand its caller: the board it was holding
  // resolves to "unread" (which degrades to a draft), and the worker is
  // dropped so the next board boots a fresh one in its place.
  entry.w.onerror = () => {
    const job = entry.job;
    entry.job = null;
    job?.settle(null);
    entry.w.terminate();
    const at = pool.indexOf(entry);
    if (at >= 0) pool.splice(at, 1);
    pump();
  };
  pool.push(entry);
  return entry;
}

/** Hand queued boards to free workers, growing the pool up to its size. */
function pump(): void {
  while (queue.length > 0) {
    const free = pool.find((p) => p.job === null) ?? (pool.length < POOL_SIZE ? spawn() : null);
    if (!free) return;
    const job = queue.shift()!;
    free.job = job;
    free.w.postMessage({ id: job.id, w: job.w, h: job.h, data: job.data, detail: job.detail }, [
      job.data,
    ]);
  }
}

function submit(board: Gray, detail: boolean, settle: Job['settle']): void {
  // Copied out of the page's gray, not sliced off its buffer: the copy is
  // what gets transferred, so the caller keeps its own pixels intact.
  const data = new Uint8ClampedArray(board.data).buffer;
  queue.push({ id: ++nextId, detail, w: board.w, h: board.h, data, settle });
  pump();
}

/**
 * Hand the workers back.
 *
 * They used to be one worker that simply stayed alive for the session,
 * which was small enough not to matter; a pool the width of the machine
 * is not, and a phone that has finished an import should not still be
 * holding six of them. Queued boards are settled as unread rather than
 * left hanging — nothing calls this with work outstanding, but a promise
 * nobody ever resolves would hang the import rather than degrade it.
 */
export function releasePool(): void {
  if (leases > 0) return;
  for (const job of queue.splice(0)) job.settle(null);
  for (const entry of pool.splice(0)) {
    entry.job?.settle(null);
    entry.w.terminate();
  }
}

export function classifyInWorker(board: Gray): Promise<CellReading[] | null> {
  return new Promise((resolve) => {
    submit(board, false, (reply) => resolve(reply?.readings ?? null));
  });
}

/** Every cell's full distribution, plus what its shifted re-reads said. */
export interface DetailedReading {
  cells: CellCandidates[];
  labels: string[];
}

/** The same pool, asked for every cell's distribution — repair only. */
export function classifyDetailInWorker(board: Gray): Promise<DetailedReading | null> {
  return new Promise((resolve) => {
    submit(board, true, (reply) =>
      resolve(
        reply?.cells && reply.labels
          ? {
              cells: reply.cells.map((c) => ({ ...c, votes: new Map(c.votes) })),
              labels: reply.labels,
            }
          : null,
      ),
    );
  });
}

/**
 * Give the event loop a turn.
 *
 * Every one of these used to be `setTimeout(r, 0)`, which is not free: a
 * nested timer is clamped, and measured on a hidden window it cost 5.1 ms
 * a hop against 3.3 us for `scheduler.yield` and 12.3 us for a message
 * hop. A browser clamps timers harder still once a tab has been in the
 * background a while, which is the difference between an import that runs
 * unattended and one that must be watched.
 *
 * `scheduler.yield` is the primitive meant for exactly this and lets input
 * and painting go first; the message hop is the fallback where it is
 * missing, and a fresh channel per call is close enough to free that
 * pooling them would only be more code to read.
 */
export function yieldToUi(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}
