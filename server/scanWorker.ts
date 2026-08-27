import { Worker, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  BadPack,
  compileMaterialHunt,
  compilePositionHunt,
  scanPackMaterial,
  scanPackPosition,
  type CompiledHunt,
  type PositionTarget,
} from './refgamesScan.ts';
import type { MaterialSpec } from '../shared/scanMatch.ts';

/**
 * The resident scan worker: one thread OWNING one database's packed
 * index — the "one worker owning one structure" shape the search
 * roadmap settled on, as against a worker pool on the request path.
 * The main thread (refgamesResident.ts) spawns one of these per
 * opted-in database, asks it to scan, and terminates it to evict.
 *
 * Inside, the owner shards: the index lives in SharedArrayBuffers, and
 * a FIXED set of shard threads (spawned once at load, from this same
 * file with workerData.role = 'shard') scans contiguous slot ranges
 * concurrently. That is an implementation detail of the one worker,
 * not a departure from the shape: the shard count is set by the
 * machine at load time and never by request volume — requests still
 * queue into one structure. Hits still stream to the parent in global
 * id order: the owner forwards shard k's results only after shards
 * 0..k-1 finished, which costs buffering only on hunts so abundant the
 * cap cancels them early anyway.
 *
 * Protocol with the parent, all messages carrying the request's `seq`
 * (unchanged by the sharding):
 *   {seq, op:'load', path}          → {seq, type:'loaded', games, bytes}
 *                                     or {seq, type:'error', message}
 *   {seq, op:'scan', target?, spec?, ids?} → a stream of
 *     {seq, type:'hits', pairs}     — [id, ply, …] in id order;
 *                                     candidates for the prefilter
 *                                     rungs, final answers otherwise
 *     {seq, type:'bad', ids}        — games whose pack was malformed:
 *                                     the caller answers them by
 *                                     replay, never drops them
 *     {seq, type:'progress', scanned}
 *     {seq, type:'done', scanned}
 *   {op:'cancel', of}               → an atomic flag every shard reads
 *                                     at its next chunk boundary
 */

const CHUNK = 8192;

interface ShardInit {
  role: 'shard';
  blob: SharedArrayBuffer;
  ids: SharedArrayBuffer;
  offsets: SharedArrayBuffer;
}

interface ScanRequest {
  seq: number;
  op: 'load' | 'scan' | 'cancel';
  path?: string;
  of?: number;
  target?: PositionTarget;
  spec?: MaterialSpec;
  ids?: Float64Array;
}

interface ShardScan {
  seq: number;
  from: number;
  to: number;
  target?: PositionTarget;
  spec?: MaterialSpec;
  wanted?: Float64Array;
  cancel: SharedArrayBuffer;
}

/** Slot of `id` in the ascending ids array, or -1 — a binary search: a
    Map here cost hundreds of megabytes at ten million entries for a
    lookup the sorted array already answers. */
function slotOf(ids: Float64Array, id: number): number {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = ids[mid]!;
    if (at === id) return mid;
    if (at < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

const port = parentPort!;

/* ------------------------------------------------------------------ */
/* Shard role: scan assigned ranges of the shared structure.           */

if ((workerData as ShardInit | null)?.role === 'shard') {
  const init = workerData as ShardInit;
  const blob = Buffer.from(init.blob);
  const ids = new Float64Array(init.ids);
  const offsets = new Float64Array(init.offsets);

  port.on('message', (job: ShardScan) => {
    const cancel = new Int32Array(job.cancel);
    const hunt: CompiledHunt = job.spec
      ? compileMaterialHunt(job.spec)
      : compilePositionHunt(job.target!);
    const wanted = job.wanted ?? null;
    let at = job.from;
    let scanned = 0;
    const step = (): void => {
      if (Atomics.load(cancel, 0) === 1) {
        port.postMessage({ seq: job.seq, type: 'shardDone', scanned });
        return;
      }
      const pairs: number[] = [];
      const bad: number[] = [];
      const end = Math.min(at + CHUNK, job.to);
      for (; at < end; at += 1) {
        const slot = wanted ? slotOf(ids, wanted[at - job.from]!) : at;
        scanned += 1;
        if (slot < 0) {
          // A filtered id the pack table does not know — a race with
          // an append; the route replays it rather than losing it.
          bad.push(wanted![at - job.from]!);
          continue;
        }
        const pack = blob.subarray(Number(offsets[slot]), Number(offsets[slot + 1]));
        try {
          const hit =
            hunt.kind === 'material' ? scanPackMaterial(pack, hunt) : scanPackPosition(pack, hunt);
          if (hit !== null) pairs.push(ids[slot]!, hit);
        } catch (error) {
          if (!(error instanceof BadPack)) throw error;
          bad.push(ids[slot]!);
        }
      }
      if (pairs.length > 0) port.postMessage({ seq: job.seq, type: 'shardHits', pairs });
      if (bad.length > 0) port.postMessage({ seq: job.seq, type: 'shardBad', ids: bad });
      if (at >= job.to) {
        port.postMessage({ seq: job.seq, type: 'shardDone', scanned });
        return;
      }
      port.postMessage({ seq: job.seq, type: 'shardProgress', scanned });
      scanned = 0; // progress is reported as a delta, summed by the owner
      setImmediate(step);
    };
    step();
  });
}

/* ------------------------------------------------------------------ */
/* Owner role: load the structure, command the shards, keep id order.  */

interface Loaded {
  ids: Float64Array;
  offsets: Float64Array;
  games: number;
  shards: Worker[];
}

let loaded: Loaded | null = null;

interface ShardState {
  queue: { type: 'hits' | 'bad'; payload: number[] }[];
  done: boolean;
  scanned: number;
}

interface ScanState {
  shards: ShardState[];
  flushed: number;
  cancel: Int32Array;
  lastProgress: number;
}

const scans = new Map<number, ScanState>();

function load(seq: number, path: string): void {
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const count = (db.prepare('SELECT COUNT(*) AS n FROM scan_pack').get() as { n: number }).n;
      const total = (
        db.prepare('SELECT COALESCE(SUM(LENGTH(pack)), 0) AS n FROM scan_pack').get() as {
          n: number;
        }
      ).n;
      const blobSab = new SharedArrayBuffer(total);
      const idsSab = new SharedArrayBuffer(count * 8);
      const offsetsSab = new SharedArrayBuffer((count + 1) * 8);
      const blob = Buffer.from(blobSab);
      const ids = new Float64Array(idsSab);
      const offsets = new Float64Array(offsetsSab);
      let at = 0;
      let offset = 0;
      for (const row of db
        .prepare('SELECT game_id, pack FROM scan_pack ORDER BY game_id')
        .iterate() as IterableIterator<{ game_id: number; pack: Buffer }>) {
        ids[at] = row.game_id;
        offsets[at] = offset;
        row.pack.copy(blob, offset);
        offset += row.pack.length;
        at += 1;
      }
      offsets[count] = offset;
      // The fixed shard set — sized by the machine once, never by load:
      // leave two cores for the server and the world.
      const width = Math.max(1, Math.min(8, availableParallelism() - 2));
      const init: Omit<ShardInit, 'role'> & { role: 'shard' } = {
        role: 'shard',
        blob: blobSab,
        ids: idsSab,
        offsets: offsetsSab,
      };
      const here = fileURLToPath(import.meta.url);
      const shards = Array.from({ length: width }, () => new Worker(here, { workerData: init }));
      loaded = { ids, offsets, games: count, shards };
      port.postMessage({ seq, type: 'loaded', games: count, bytes: total });
    } finally {
      db.close();
    }
  } catch (error) {
    port.postMessage({ seq, type: 'error', message: (error as Error).message });
  }
}

/** Forward what id order allows: shard k's results wait for 0..k-1. */
function flush(seq: number): void {
  const state = scans.get(seq);
  if (!state) return;
  for (;;) {
    const shard = state.shards[state.flushed];
    if (!shard) break;
    for (const item of shard.queue) {
      port.postMessage(
        item.type === 'hits'
          ? { seq, type: 'hits', pairs: item.payload }
          : { seq, type: 'bad', ids: item.payload },
      );
    }
    shard.queue.length = 0;
    if (!shard.done) break;
    state.flushed += 1;
  }
  const scanned = state.shards.reduce((sum, s) => sum + s.scanned, 0);
  if (state.flushed >= state.shards.length) {
    scans.delete(seq);
    port.postMessage({ seq, type: 'done', scanned });
    return;
  }
  if (scanned - state.lastProgress >= CHUNK * 4) {
    state.lastProgress = scanned;
    port.postMessage({ seq, type: 'progress', scanned });
  }
}

function scan(request: ScanRequest): void {
  const { seq } = request;
  if (!loaded) {
    port.postMessage({ seq, type: 'error', message: 'no index loaded' });
    return;
  }
  const index = loaded;
  const wanted = request.ids ?? null;
  const domain = wanted ? wanted.length : index.games;
  const width = index.shards.length;
  const cancel = new Int32Array(new SharedArrayBuffer(4));
  const state: ScanState = {
    shards: Array.from({ length: width }, () => ({ queue: [], done: false, scanned: 0 })),
    flushed: 0,
    cancel,
    lastProgress: 0,
  };
  scans.set(seq, state);
  const per = Math.ceil(domain / width) || 1;
  index.shards.forEach((shard, k) => {
    const from = Math.min(k * per, domain);
    const to = Math.min(from + per, domain);
    if (from >= to) {
      state.shards[k]!.done = true;
      return;
    }
    const job: ShardScan = {
      seq,
      from,
      to,
      target: request.target,
      spec: request.spec,
      wanted: wanted ? wanted.slice(from, to) : undefined,
      cancel: cancel.buffer as SharedArrayBuffer,
    };
    const onMessage = (m: {
      seq: number;
      type: string;
      pairs?: number[];
      ids?: number[];
      scanned?: number;
    }): void => {
      if (m.seq !== seq) return;
      const mine = state.shards[k]!;
      if (m.type === 'shardHits') mine.queue.push({ type: 'hits', payload: m.pairs! });
      else if (m.type === 'shardBad') mine.queue.push({ type: 'bad', payload: m.ids! });
      else if (m.type === 'shardProgress') mine.scanned += m.scanned!;
      else if (m.type === 'shardDone') {
        mine.scanned += m.scanned!;
        mine.done = true;
        shard.off('message', onMessage);
      }
      flush(seq);
    };
    shard.on('message', onMessage);
    shard.postMessage(job);
  });
  flush(seq); // width may exceed the domain — every shard already done
}

if ((workerData as ShardInit | null)?.role !== 'shard') {
  port.on('message', (request: ScanRequest) => {
    if (request.op === 'cancel') {
      const state = scans.get(request.of!);
      if (state) Atomics.store(state.cancel, 0, 1);
      return;
    }
    if (request.op === 'load') {
      load(request.seq, request.path!);
      return;
    }
    scan(request);
  });
}
