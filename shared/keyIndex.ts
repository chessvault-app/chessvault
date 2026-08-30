/**
 * The inverted key index: exact position search as lookup, not scan.
 *
 * Derived ENTIRELY from the packed scan-index (shared/scanPack.ts) —
 * every position's 32-bit key prefix, inverted into sorted per-bucket
 * runs — so an exact hunt reads one bucket and binary-searches instead
 * of walking half a billion positions. This is what desktop databases
 * call a search booster. It answers ONLY key equality; every other
 * hunt shape (rungs, material specs) stays with the scan.
 *
 * ## Format (version 1)
 *
 * One row per non-empty bucket in `key_index(bucket INTEGER PRIMARY
 * KEY, entries BLOB)`, where bucket = key32 >>> 16. Each blob is a run
 * of u64 little-endian entries, ascending:
 *
 *   entry = (key32 & 0xffff) << 48 | gameId << 16 | min(ply, 65535)
 *
 * Composed so that NUMERIC u64 order IS (low16, gameId, ply) order —
 * both indexers sort plain integers and write the same bytes. Game ids
 * must fit 32 bits and plies clamp at 65535 (the pack's u16 position
 * count caps far below that anyway). A position occurring at several
 * plies of one game yields several entries; readers wanting one per
 * game take the first, which the sort makes the earliest ply.
 *
 * The meta key `key_index` carries the version. The index is a pure
 * derivation of scan_pack, rebuilt whole whenever packs are (an append
 * included — merging sorted runs was not worth a second code path),
 * and a 32-bit key match is still a PREFILTER: the route replays the
 * few candidate games through the reference before answering.
 */
export const KEY_INDEX_VERSION = 1;
export const KEY_INDEX_META = 'key_index';

export const keyBucket = (key32: number): number => key32 >>> 16;

export const keyEntry = (key32: number, gameId: number, ply: number): bigint =>
  (BigInt(key32 & 0xffff) << 48n) | (BigInt(gameId) << 16n) | BigInt(Math.min(ply, 65535));

export const entryGameId = (entry: bigint): number => Number((entry >> 16n) & 0xffffffffn);

/** The [from, to) bounds of one low16's run, for a bucket's entries. */
export const low16Bounds = (key32: number): { lo: bigint; hi: bigint } => {
  const low16 = BigInt(key32 & 0xffff);
  return { lo: low16 << 48n, hi: (low16 + 1n) << 48n };
};
