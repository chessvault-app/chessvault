import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';
import {
  BadPack,
  packMaterialHit,
  packPositionCandidate,
  type PositionTarget,
} from './refgamesScan.ts';
import type { MaterialSpec } from '../shared/scanMatch.ts';

/**
 * The resident scan worker: one thread, one database's packed index,
 * loaded whole into this thread's memory — the "one worker owning one
 * structure" shape the search roadmap settled on, as against a worker
 * pool on the request path. The main thread (refgamesResident.ts)
 * spawns one of these per opted-in database, asks it to scan, and
 * terminates it to evict; nothing here touches the request path
 * directly.
 *
 * Protocol, all messages carrying the request's `seq`:
 *   {seq, op:'load', path}          → {seq, type:'loaded', games, bytes}
 *                                     or {seq, type:'error', message}
 *   {seq, op:'scan', target?, spec?, ids?} → a stream of
 *     {seq, type:'hits', pairs}     — [id, ply, id, ply …] in id order;
 *                                     candidate plies for the prefilter
 *                                     rungs, final answers otherwise
 *     {seq, type:'bad', ids}        — games whose pack was malformed:
 *                                     the caller must answer them by
 *                                     replay, never silently drop them
 *     {seq, type:'progress', scanned}
 *     {seq, type:'done', scanned}
 *   {op:'cancel', of}               → the scan with seq `of` stops at
 *                                     its next chunk boundary
 *
 * The scan yields between chunks so a cancel can land mid-scan; the
 * structure itself is immutable after load, so there is no locking.
 */

interface Loaded {
  /** Game ids, ascending — the id order every scan streams in. */
  ids: Float64Array;
  /** ids.length + 1 byte offsets into the blob. */
  offsets: Float64Array;
  /** Every pack, concatenated in id order. */
  blob: Buffer;
  /** game id → position in `ids`, for filtered scans. */
  at: Map<number, number>;
}

let loaded: Loaded | null = null;
const cancelled = new Set<number>();

const CHUNK = 8192;

interface ScanRequest {
  seq: number;
  op: 'load' | 'scan' | 'cancel';
  path?: string;
  of?: number;
  target?: PositionTarget;
  spec?: MaterialSpec;
  ids?: Float64Array;
}

const port = parentPort!;

function load(seq: number, path: string): void {
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const count = (db.prepare('SELECT COUNT(*) AS n FROM scan_pack').get() as { n: number }).n;
      const ids = new Float64Array(count);
      const offsets = new Float64Array(count + 1);
      const total = (
        db.prepare('SELECT COALESCE(SUM(LENGTH(pack)), 0) AS n FROM scan_pack').get() as {
          n: number;
        }
      ).n;
      const blob = Buffer.allocUnsafe(total);
      let at = 0;
      let offset = 0;
      const map = new Map<number, number>();
      for (const row of db
        .prepare('SELECT game_id, pack FROM scan_pack ORDER BY game_id')
        .iterate() as IterableIterator<{ game_id: number; pack: Buffer }>) {
        ids[at] = row.game_id;
        offsets[at] = offset;
        map.set(row.game_id, at);
        row.pack.copy(blob, offset);
        offset += row.pack.length;
        at += 1;
      }
      offsets[count] = offset;
      loaded = { ids, offsets, blob, at: map };
      port.postMessage({ seq, type: 'loaded', games: count, bytes: total });
    } finally {
      db.close();
    }
  } catch (error) {
    port.postMessage({ seq, type: 'error', message: (error as Error).message });
  }
}

function scan(request: ScanRequest): void {
  const { seq } = request;
  if (!loaded) {
    port.postMessage({ seq, type: 'error', message: 'no index loaded' });
    return;
  }
  const index = loaded;
  // The iteration order: every game, or the caller's filtered id list —
  // both ascend, so hits stream in id order either way.
  const wanted = request.ids ?? null;
  const total = wanted ? wanted.length : index.ids.length;
  let at = 0;
  let scanned = 0;
  const step = (): void => {
    if (cancelled.has(seq)) {
      cancelled.delete(seq);
      port.postMessage({ seq, type: 'done', scanned });
      return;
    }
    const pairs: number[] = [];
    const bad: number[] = [];
    const end = Math.min(at + CHUNK, total);
    for (; at < end; at += 1) {
      const slot = wanted ? (index.at.get(wanted[at]!) ?? -1) : at;
      scanned += 1;
      if (slot < 0) {
        // A filtered id the pack table does not know — completeness is
        // checked at load time, so this is a race with an append; the
        // caller replays it rather than losing it.
        bad.push(wanted![at]!);
        continue;
      }
      const pack = index.blob.subarray(Number(index.offsets[slot]), Number(index.offsets[slot + 1]));
      try {
        const hit = request.spec
          ? packMaterialHit(pack, request.spec)
          : packPositionCandidate(pack, request.target!);
        if (hit !== null) pairs.push(index.ids[slot]!, hit);
      } catch (error) {
        if (!(error instanceof BadPack)) throw error;
        bad.push(index.ids[slot]!);
      }
    }
    if (pairs.length > 0) port.postMessage({ seq, type: 'hits', pairs });
    if (bad.length > 0) port.postMessage({ seq, type: 'bad', ids: bad });
    if (at >= total) {
      port.postMessage({ seq, type: 'done', scanned });
      return;
    }
    port.postMessage({ seq, type: 'progress', scanned });
    setImmediate(step);
  };
  step();
}

port.on('message', (request: ScanRequest) => {
  if (request.op === 'cancel') {
    cancelled.add(request.of!);
    return;
  }
  if (request.op === 'load') {
    load(request.seq, request.path!);
    return;
  }
  scan(request);
});
