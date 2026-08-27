import type { Board } from 'chessops/board';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { squareFile } from 'chessops/util';
import type { Role } from 'chessops/types';
import { hashSetup } from './zobrist.ts';

/**
 * The packed scan-index: one blob per game, everything a deep scan
 * tests, precomputed — so a future scanner reads bytes instead of
 * parsing SAN and replaying (the whole cost of today's scan, measured
 * 12.7 s JS / 1.3 s native per Elite month).
 *
 * This module is the SPEC as much as the implementation. The Rust
 * indexer (native/src/scan_pack.rs) must emit byte-identical blobs —
 * pinned by fixtures exported from this file into the goldens — and a
 * blob, once written, is read by whichever side scans it, so the layout
 * below can only ever be extended behind a version bump, never changed.
 *
 * ## Layout (version 1, all integers little-endian)
 *
 * ```
 * u16          npos   — positions encoded: replayed plies + 1
 * npos × u32   key32  — per position, the low 32 bits of the UNSIGNED
 *                       zobrist hash (shared/zobrist.ts, before the
 *                       signed db-key conversion), position 0 first
 * npos × u8    pawns8 — per position, the pawn-files hash below
 * (npos−1) × u8 event — per ply, what the move did to the material
 * ```
 *
 * The replay follows the plies index's own stopping rules — the first
 * SAN token that fails to parse or is illegal ends the stream, keeping
 * everything before it — but has NO ply cap: the pack exists precisely
 * for the depths the plies table stops short of. A 32-bit key is a
 * prefilter, not an answer: a scanner that matches one must verify the
 * hit by replaying that one game, which is cheap because hits are few.
 *
 * ## The pawn-files hash
 *
 * One byte discriminating pawn STRUCTURE, for the ladder's pawns and
 * files rungs: without it their candidates were every game whose piece
 * counts matched, and verification dominated (measured 112 s over five
 * million games; the whole point of the pack is not replaying). The
 * hash digests the files-rung projection — per file, per side, how
 * many pawns — so it is exact for the files rung up to its 8 bits, and
 * a sound prefilter for the pawns rung (same placement implies same
 * file counts). Defined arithmetic, not a library: h starts at 5, and
 * for each of the 16 counts v (white files a…h, then black a…h),
 * h = (h * 33 + v) mod 256.
 *
 * ## The event byte
 *
 * `captured | promoted << 3`, with roles numbered none=0, pawn=1,
 * knight=2, bishop=3, rook=4, queen=5 (kings are never captured, and a
 * promotion is never to a pawn or king). The captured side is the side
 * that did NOT move — ply parity says which. From these events alone a
 * scanner reconstructs every position's per-piece counts, which is what
 * the material hunt and the ladder's cheap gates test.
 *
 * Deriving the two fields is specified so both implementations agree
 * without sharing a chess library:
 * - promoted: the move's own promotion role, none otherwise.
 * - captured: the role of the ENEMY piece on the destination square —
 *   an own piece there is castling (king takes rook encoding), which
 *   captures nothing; a pawn landing on an EMPTY square while changing
 *   file is en passant and captures a pawn.
 */
export const SCAN_PACK_VERSION = 1;

/** The meta key naming the version of the packs a database carries —
    absent means no packs (or packs with holes: an append refuses to
    leave a partially packed file, see the indexers). */
export const SCAN_PACK_META = 'scan_pack';

const ROLE_CODE: Record<Role, number> = {
  pawn: 1,
  knight: 2,
  bishop: 3,
  rook: 4,
  queen: 5,
  king: 0, // never captured, never promoted to — encoded as none
};

const MASK32 = 0xffffffffn;

/** The pawn-files hash of a board — see the header for the exact
    arithmetic, which the Rust twin repeats digit for digit. */
export function pawnFilesHash(board: Board): number {
  const files = new Array<number>(16).fill(0);
  for (const square of board.pawn.intersect(board.white)) {
    files[squareFile(square)] = (files[squareFile(square)] ?? 0) + 1;
  }
  for (const square of board.pawn.intersect(board.black)) {
    files[8 + squareFile(square)] = (files[8 + squareFile(square)] ?? 0) + 1;
  }
  let h = 5;
  for (const value of files) h = (h * 33 + value) & 0xff;
  return h;
}

/** Encode one game's movetext into its pack. Replays with the same
    chessops pipeline as every other consumer, full depth. */
export function encodeScanPack(moves: string): Uint8Array {
  const pos = Chess.default();
  const keys: number[] = [Number(hashSetup(pos.toSetup()) & MASK32)];
  const pawns: number[] = [pawnFilesHash(pos.board)];
  const events: number[] = [];
  for (const san of moves.split(' ')) {
    const move = parseSan(pos, san);
    if (!move) break;
    let event = 0;
    if ('from' in move) {
      const mover = pos.board.get(move.from);
      const target = pos.board.get(move.to);
      if (target && target.color !== pos.turn) {
        event |= ROLE_CODE[target.role];
      } else if (
        !target &&
        mover?.role === 'pawn' &&
        squareFile(move.from) !== squareFile(move.to)
      ) {
        event |= ROLE_CODE.pawn; // en passant
      }
      if (move.promotion) event |= ROLE_CODE[move.promotion] << 3;
    }
    pos.play(move);
    events.push(event);
    keys.push(Number(hashSetup(pos.toSetup()) & MASK32));
    pawns.push(pawnFilesHash(pos.board));
  }
  const npos = keys.length;
  const pack = new Uint8Array(2 + 5 * npos + events.length);
  const view = new DataView(pack.buffer);
  view.setUint16(0, npos, true);
  keys.forEach((key, at) => view.setUint32(2 + 4 * at, key, true));
  pawns.forEach((hash, at) => {
    pack[2 + 4 * npos + at] = hash;
  });
  events.forEach((event, at) => {
    pack[2 + 5 * npos + at] = event;
  });
  return pack;
}

/** A decoded pack, for tests and the scanner to come. */
export interface ScanPack {
  keys: number[];
  pawns: number[];
  events: number[];
}

/** Decode a pack, or null when the bytes are not a well-formed v1 blob
    — truncated, oversized, or an impossible header. */
export function decodeScanPack(pack: Uint8Array): ScanPack | null {
  if (pack.length < 2) return null;
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const npos = view.getUint16(0, true);
  if (npos < 1 || pack.length !== 2 + 5 * npos + (npos - 1)) return null;
  const keys: number[] = [];
  for (let at = 0; at < npos; at += 1) keys.push(view.getUint32(2 + 4 * at, true));
  const pawns: number[] = [];
  for (let at = 0; at < npos; at += 1) pawns.push(pack[2 + 4 * npos + at]!);
  const events: number[] = [];
  for (let at = 0; at < npos - 1; at += 1) events.push(pack[2 + 5 * npos + at]!);
  return { keys, pawns, events };
}
