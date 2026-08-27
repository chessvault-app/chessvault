import { Worker, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  BadPack,
  compileMaterialHunt,
  compilePositionHunt,
  replayMaterialHit,
  replayPositionHit,
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
 * file with workerData.role = 'shard') divides the work. That is an
 * implementation detail of the one worker, not a departure from the
 * shape: the shard count is set by the machine at load time and never
 * by request volume — requests still queue into one structure.
 *
 * The shards do three jobs:
 *  - FILL at load: the owner reads ids and lengths in one cheap pass,
 *    then every shard copies its contiguous slice of pack blobs from
 *    its own read-only connection — the 4.6 GB read parallelises.
 *  - SCAN: contiguous slot ranges of the shared structure.
 *  - VERIFY, in place: a pack candidate the pack could only gate
 *    (exact / pawns / files) is settled right in the shard — moves
 *    fetched from the shard's own connection, replayed through the
 *    same reference functions the route would have used. The runtime
 *    tether ("candidates verified by the reference on every request")
 *    holds; it just runs on all cores now. Hits leaving this worker
 *    are FINAL: (id, true ply), in global id order — the owner
 *    forwards shard k only after shards 0..k−1 finish.
 *
 * Protocol with the parent, all messages carrying the request's `seq`:
 *   {seq, op:'load', path}          → {seq, type:'loaded', games, bytes}
 *                                     or {seq, type:'error', message}
 *   {seq, op:'scan', target?, spec?, ids?} → a stream of
 *     {seq, type:'hits', pairs}     — [id, ply, …], id order, verified
 *     {seq, type:'bad', ids}        — games this worker could not
 *                                     settle (pack unreadable AND the
 *                                     replay row unfetchable): the
 *                                     route decides them, never drops
 *     {seq, type:'progress', scanned}
 *     {seq, type:'done', scanned}
 *   {op:'cancel', of}               → an atomic flag every shard reads
 *                                     at its next chunk boundary
 */

const CHUNK = 8192;

interface ShardInit {
  role: 'shard';
  path: string;
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

interface ShardFill {
  kind: 'fill';
  seq: number;
  fromSlot: number;
  toSlot: number;
}

interface ShardScanJob {
  kind: 'scan';
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
/* Shard role: fill, scan, and verify against the shared structure.    */

if ((workerData as ShardInit | null)?.role === 'shard') {
  const init = workerData as ShardInit;
  const blob = Buffer.from(init.blob);
  const ids = new Float64Array(init.ids);
  const offsets = new Float64Array(init.offsets);
  let db: InstanceType<typeof Database> | null = null;
  let movesStmt: ReturnType<InstanceType<typeof Database>['prepare']> | null = null;
  const movesOf = (id: number): string | null => {
    if (!db) {
      db = new Database(init.path, { readonly: true, fileMustExist: true });
      db.pragma('busy_timeout = 30000');
      movesStmt = db.prepare('SELECT moves FROM games WHERE id = ?');
    }
    const row = movesStmt!.get(id) as { moves: string } | undefined;
    return row?.moves ?? null;
  };

  const fill = (job: ShardFill): void => {
    try {
      const conn = new Database(init.path, { readonly: true, fileMustExist: true });
      try {
        if (job.fromSlot < job.toSlot) {
          const lo = ids[job.fromSlot]!;
          const hi = ids[job.toSlot - 1]!;
          let slot = job.fromSlot;
          for (const row of conn
            .prepare('SELECT pack FROM scan_pack WHERE game_id BETWEEN ? AND ? ORDER BY game_id')
            .iterate(lo, hi) as IterableIterator<{ pack: Buffer }>) {
            row.pack.copy(blob, Number(offsets[slot]));
            slot += 1;
          }
        }
        port.postMessage({ seq: job.seq, type: 'fillDone' });
      } finally {
        conn.close();
      }
    } catch (error) {
      port.postMessage({ seq: job.seq, type: 'fillError', message: (error as Error).message });
    }
  };

  const scan = (job: ShardScanJob): void => {
    const cancel = new Int32Array(job.cancel);
    const hunt: CompiledHunt = job.spec
      ? compileMaterialHunt(job.spec)
      : compilePositionHunt(job.target!);
    // What a pack answer MEANS for this hunt: final for material hunts
    // and the material rung, a candidate to verify otherwise.
    const needsVerify = !job.spec && job.target!.mode !== 'material';
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
        const id = ids[slot]!;
        const pack = blob.subarray(Number(offsets[slot]), Number(offsets[slot + 1]));
        try {
          let hit =
            hunt.kind === 'material' ? scanPackMaterial(pack, hunt) : scanPackPosition(pack, hunt);
          if (hit !== null && needsVerify) {
            const moves = movesOf(id);
            if (moves === null) {
              bad.push(id);
              continue;
            }
            hit = replayPositionHit(moves, job.target!);
          }
          if (hit !== null) pairs.push(id, hit);
        } catch (error) {
          if (!(error instanceof BadPack)) throw error;
          // An unreadable pack: settle it by replay, here — the route
          // only hears about games nothing could decide.
          const moves = movesOf(id);
          if (moves === null) {
            bad.push(id);
            continue;
          }
          const hit = job.spec
            ? replayMaterialHit(moves, job.spec)
            : replayPositionHit(moves, job.target!);
          if (hit !== null) pairs.push(id, hit);
        }
      }
      if (pairs.length > 0) port.postMessage({ seq: job.seq, type: 'shardHits', pairs });
      if (bad.length > 0) port.postMessage({ seq: job.seq, type: 'shardBad', ids: bad });
      if (at >= job.to) {
        port.postMessage({ seq: job.seq, type: 'shardDone', scanned });
        return;
      }
      port.postMessage({ seq: job.seq, type: 'shardProgress', scanned });
      scanned = 0; // progress is a delta, summed by the owner
      setImmediate(step);
    };
    step();
  };

  port.on('message', (job: ShardFill | ShardScanJob) => {
    if (job.kind === 'fill') fill(job);
    else scan(job);
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
    let count = 0;
    let total = 0;
    const idsSabRef: { ids: Float64Array; offsets: Float64Array; blobSab: SharedArrayBuffer } = (() => {
      try {
        // One cheap pass for the shape — ids and lengths — so the heavy
        // blob copy can be divided among the shards' own connections.
        count = (db.prepare('SELECT COUNT(*) AS n FROM scan_pack').get() as { n: number }).n;
        const idsSab = new SharedArrayBuffer(count * 8);
        const offsetsSab = new SharedArrayBuffer((count + 1) * 8);
        const ids = new Float64Array(idsSab);
        const offsets = new Float64Array(offsetsSab);
        let at = 0;
        let offset = 0;
        for (const row of db
          .prepare('SELECT game_id, LENGTH(pack) AS len FROM scan_pack ORDER BY game_id')
          .iterate() as IterableIterator<{ game_id: number; len: number }>) {
          ids[at] = row.game_id;
          offsets[at] = offset;
          offset += row.len;
          at += 1;
        }
        offsets[count] = offset;
        total = offset;
        const blobSab = new SharedArrayBuffer(total);
        return { ids, offsets, blobSab };
      } finally {
        db.close();
      }
    })();
    const { ids, offsets, blobSab } = idsSabRef;
    // The fixed shard set — sized by the machine once, never by load:
    // leave two cores for the server and the world.
    const width = Math.max(1, Math.min(8, availableParallelism() - 2));
    const init: ShardInit = {
      role: 'shard',
      path,
      blob: blobSab,
      ids: ids.buffer as SharedArrayBuffer,
      offsets: offsets.buffer as SharedArrayBuffer,
    };
    const here = fileURLToPath(import.meta.url);
    const shards = Array.from({ length: width }, () => new Worker(here, { workerData: init }));
    const per = Math.ceil(count / width) || 1;
    let filled = 0;
    let failed = false;
    shards.forEach((shard, k) => {
      const onFill = (m: { seq: number; type: string; message?: string }): void => {
        if (m.seq !== seq || (m.type !== 'fillDone' && m.type !== 'fillError')) return;
        shard.off('message', onFill);
        if (m.type === 'fillError' && !failed) {
          failed = true;
          port.postMessage({ seq, type: 'error', message: m.message ?? 'fill failed' });
          return;
        }
        filled += 1;
        if (filled === width && !failed) {
          loaded = { ids, offsets, games: count, shards };
          port.postMessage({ seq, type: 'loaded', games: count, bytes: total });
        }
      };
      shard.on('message', onFill);
      const fromSlot = Math.min(k * per, count);
      const toSlot = Math.min(fromSlot + per, count);
      shard.postMessage({ kind: 'fill', seq, fromSlot, toSlot } satisfies ShardFill);
    });
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
    const job: ShardScanJob = {
      kind: 'scan',
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
