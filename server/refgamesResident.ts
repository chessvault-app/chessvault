import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './paths.ts';
import type { PositionTarget } from './refgamesScan.ts';
import type { MaterialSpec } from '../shared/scanMatch.ts';

/**
 * The resident scan indexes: per opted-in database, one worker thread
 * holding its packed index in memory (scanWorker.ts). This module is
 * their lifecycle — lazy load on the first hunt, idle eviction after
 * disuse, termination as the one eviction mechanism — and the typed
 * face the deep-search route talks to. Opt-in itself is a meta key in
 * the database file (`fast_scan`), read by the route; nothing here
 * decides WHETHER a database should be resident, only keeps the ones
 * that are.
 *
 * Sized for the deployment reality the roadmap settled on: a packed
 * index is ~0.5 KB per game, so an Elite month is ~130 MB and a
 * multi-million-game corpus is gigabytes — memory that must not sit
 * idle on a 2 GB box. Hence per-database opt-in AND the idle sweep.
 */

const IDLE_EVICT_MS = 30 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;

/** The worker script: bundled beside a packaged server (see
    desktop/build-server.mjs), the TS source under tsx in dev — the
    worker inherits execArgv, so the tsx loader rides along. */
function workerPath(): string {
  const bundled = resolve(REPO_ROOT, 'server', 'scan-worker.mjs');
  return existsSync(bundled) ? bundled : resolve(REPO_ROOT, 'server', 'scanWorker.ts');
}

interface Pending {
  onHits?: (pairs: number[]) => void;
  onBad?: (ids: number[]) => void;
  onProgress?: (scanned: number) => void;
  settle: (result: { scanned: number } | Error) => void;
}

interface Entry {
  worker: Worker;
  seq: number;
  pending: Map<number, Pending>;
  ready: Promise<{ games: number; bytes: number }>;
  games: number;
  bytes: number;
  lastUsed: number;
}

const residents = new Map<string, Entry>();

let sweeper: ReturnType<typeof setInterval> | null = null;
function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [path, entry] of residents) {
      if (now - entry.lastUsed > IDLE_EVICT_MS) evictResident(path);
    }
    if (residents.size === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = null;
    }
  }, SWEEP_MS);
  // The sweep must never keep the process alive on its own.
  sweeper.unref();
}

function spawn(path: string): Entry {
  const script = workerPath();
  // The TS source needs the tsx loader IN THE WORKER — stated
  // explicitly rather than inherited, because the host is not always
  // tsx (vitest transforms through its own pipeline and its execArgv
  // says nothing useful). The bundled .mjs needs nothing.
  const worker = new Worker(script, script.endsWith('.ts') ? { execArgv: ['--import', 'tsx'] } : undefined);
  const entry: Entry = {
    worker,
    seq: 0,
    pending: new Map(),
    ready: Promise.resolve({ games: 0, bytes: 0 }),
    games: 0,
    bytes: 0,
    lastUsed: Date.now(),
  };
  worker.on(
    'message',
    (m: {
      seq: number;
      type: string;
      pairs?: number[];
      ids?: number[];
      scanned?: number;
      games?: number;
      bytes?: number;
      message?: string;
    }) => {
      const pending = entry.pending.get(m.seq);
      if (!pending) return;
      if (m.type === 'hits') pending.onHits?.(m.pairs!);
      else if (m.type === 'bad') pending.onBad?.(m.ids!);
      else if (m.type === 'progress') pending.onProgress?.(m.scanned!);
      else if (m.type === 'done') {
        entry.pending.delete(m.seq);
        pending.settle({ scanned: m.scanned! });
      } else if (m.type === 'error') {
        entry.pending.delete(m.seq);
        pending.settle(new Error(m.message ?? 'scan worker error'));
      }
    },
  );
  // A worker that dies takes its index with it: settle everything in
  // flight as failed and drop the entry — the next hunt reloads.
  const fail = (why: string): void => {
    for (const pending of entry.pending.values()) pending.settle(new Error(why));
    entry.pending.clear();
    if (residents.get(path) === entry) residents.delete(path);
  };
  worker.on('error', (error: Error) => fail(error.message));
  worker.on('exit', (code) => {
    if (code !== 0) fail(`scan worker exited with code ${code}`);
  });
  return entry;
}

/**
 * Load the database's packed index into a resident worker (or touch
 * the one already holding it). Resolves when the index is in memory —
 * the first hunt after opt-in pays this once.
 */
export function ensureResident(path: string): Promise<{ games: number; bytes: number }> {
  let entry = residents.get(path);
  if (!entry) {
    entry = spawn(path);
    residents.set(path, entry);
    const seq = ++entry.seq;
    const loading = new Promise<{ games: number; bytes: number }>((done, refuse) => {
      entry!.pending.set(seq, {
        settle: (result) => {
          if (result instanceof Error) {
            evictResident(path);
            refuse(result);
          } else {
            done({ games: entry!.games, bytes: entry!.bytes });
          }
        },
      });
    });
    entry.ready = loading;
    // 'loaded' arrives as a bespoke type — adapt it onto the pending
    // shape by listening once here instead of complicating the router.
    const onLoaded = (m: { seq: number; type: string; games?: number; bytes?: number }): void => {
      if (m.seq !== seq || (m.type !== 'loaded' && m.type !== 'error')) return;
      entry!.worker.off('message', onLoaded);
      if (m.type === 'loaded') {
        entry!.games = m.games!;
        entry!.bytes = m.bytes!;
        entry!.pending.get(seq)?.settle({ scanned: 0 });
        entry!.pending.delete(seq);
      }
      // 'error' settles through the main router above.
    };
    entry.worker.on('message', onLoaded);
    entry.worker.postMessage({ seq, op: 'load', path });
    ensureSweeper();
  }
  entry.lastUsed = Date.now();
  return entry.ready;
}

/** One scan over a resident index. `ids` narrows to a filtered game
    list (ascending); hits stream through the callbacks in id order. */
export function residentScan(
  path: string,
  hunt: { target?: PositionTarget; spec?: MaterialSpec },
  ids: Float64Array | null,
  callbacks: {
    onHits: (pairs: number[]) => void;
    onBad: (ids: number[]) => void;
    onProgress?: (scanned: number) => void;
  },
): { done: Promise<{ scanned: number }>; cancel: () => void } {
  const entry = residents.get(path);
  if (!entry) {
    return {
      done: Promise.reject(new Error('index not resident')),
      cancel: () => {},
    };
  }
  entry.lastUsed = Date.now();
  const seq = ++entry.seq;
  const done = new Promise<{ scanned: number }>((settle, refuse) => {
    entry.pending.set(seq, {
      onHits: callbacks.onHits,
      onBad: callbacks.onBad,
      onProgress: (scanned) => {
        entry.lastUsed = Date.now();
        callbacks.onProgress?.(scanned);
      },
      settle: (result) => (result instanceof Error ? refuse(result) : settle(result)),
    });
  });
  entry.worker.postMessage({ seq, op: 'scan', ...hunt, ids: ids ?? undefined });
  return {
    done,
    cancel: () => entry.worker.postMessage({ op: 'cancel', of: seq }),
  };
}

/** Whether this database's index is resident right now (and how big). */
export function residentStatus(path: string): { games: number; bytes: number } | null {
  const entry = residents.get(path);
  return entry && entry.games > 0 ? { games: entry.games, bytes: entry.bytes } : null;
}

/** Terminate the worker — eviction IS termination, nothing partial. */
export function evictResident(path: string): void {
  const entry = residents.get(path);
  if (!entry) return;
  residents.delete(path);
  void entry.worker.terminate();
}

/** Every resident index down — the test suite's afterAll, and nothing
    else: production eviction is per-database or idle. */
export function evictAllResidents(): void {
  for (const path of [...residents.keys()]) evictResident(path);
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}
