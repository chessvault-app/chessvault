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
 * 12 × u8      env    — the count envelope below
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
 * ## The count envelope
 *
 * Twelve bytes letting a scanner reject a WHOLE game in constant time
 * — the same sharpen-the-index move that took the pawns rung from
 * 112 s to 3 s, applied to the games themselves:
 *
 * ```
 * env[0]     the smallest white total-men count over every position
 * env[1]     the same for black
 * env[2..7)  white p,n,b,r,q — per piece, (min << 4) | max over every
 *            position (counts fit a nibble: promotions cap a piece at
 *            10, pawns at 8)
 * env[7..12) black, likewise
 * ```
 *
 * A position hunt whose target counts fall outside any [min, max], or
 * whose totals are below what the game ever reaches, cannot hit; a
 * material spec whose per-piece or difference ranges cannot overlap
 * the envelope's cannot either. Every skip rule is a NECESSARY
 * condition — the envelope's extremes need not co-occur, so a game
 * that survives the skip may still not match, but a skipped game
 * never could.
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

/** Where the streams sit for a pack of `npos` positions. */
export const PACK_ENV_AT = 2;
export const PACK_KEYS_AT = 14;
export const packPawnsAt = (npos: number): number => 14 + 4 * npos;
export const packEventsAt = (npos: number): number => 14 + 5 * npos;
export const packLength = (npos: number): number => 13 + 6 * npos;

/** Encode one game's movetext into its pack. Replays with the same
    chessops pipeline as every other consumer, full depth. */
export function encodeScanPack(moves: string): Uint8Array {
  const pos = Chess.default();
  const keys: number[] = [Number(hashSetup(pos.toSetup()) & MASK32)];
  const pawns: number[] = [pawnFilesHash(pos.board)];
  const events: number[] = [];
  // The envelope's extremes, per piece per side plus the totals — read
  // from the board itself each position, the same source every other
  // stream reads.
  const min = [8, 2, 2, 2, 1, 8, 2, 2, 2, 1];
  const max = [8, 2, 2, 2, 1, 8, 2, 2, 2, 1];
  let minWTot = 16;
  let minBTot = 16;
  const envelope = (board: Board): void => {
    const sets = [board.pawn, board.knight, board.bishop, board.rook, board.queen];
    let wTot = 1;
    let bTot = 1;
    for (let at = 0; at < 5; at += 1) {
      const w = sets[at]!.intersect(board.white).size();
      const b = sets[at]!.intersect(board.black).size();
      wTot += w;
      bTot += b;
      if (w < min[at]!) min[at] = w;
      if (w > max[at]!) max[at] = w;
      if (b < min[5 + at]!) min[5 + at] = b;
      if (b > max[5 + at]!) max[5 + at] = b;
    }
    if (wTot < minWTot) minWTot = wTot;
    if (bTot < minBTot) minBTot = bTot;
  };
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
    envelope(pos.board);
  }
  const npos = keys.length;
  const pack = new Uint8Array(packLength(npos));
  const view = new DataView(pack.buffer);
  view.setUint16(0, npos, true);
  pack[2] = minWTot;
  pack[3] = minBTot;
  for (let at = 0; at < 10; at += 1) pack[4 + at] = (min[at]! << 4) | max[at]!;
  keys.forEach((key, at) => view.setUint32(PACK_KEYS_AT + 4 * at, key, true));
  const pawnsAt = packPawnsAt(npos);
  pawns.forEach((hash, at) => {
    pack[pawnsAt + at] = hash;
  });
  const eventsAt = packEventsAt(npos);
  events.forEach((event, at) => {
    pack[eventsAt + at] = event;
  });
  return pack;
}

/** A decoded pack, for tests and the scanner to come. */
export interface ScanPack {
  envelope: number[];
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
  if (npos < 1 || pack.length !== packLength(npos)) return null;
  const envelope: number[] = [];
  for (let at = 0; at < 12; at += 1) envelope.push(pack[PACK_ENV_AT + at]!);
  const keys: number[] = [];
  for (let at = 0; at < npos; at += 1) keys.push(view.getUint32(PACK_KEYS_AT + 4 * at, true));
  const pawns: number[] = [];
  const pawnsAt = packPawnsAt(npos);
  for (let at = 0; at < npos; at += 1) pawns.push(pack[pawnsAt + at]!);
  const events: number[] = [];
  const eventsAt = packEventsAt(npos);
  for (let at = 0; at < npos - 1; at += 1) events.push(pack[eventsAt + at]!);
  return { envelope, keys, pawns, events };
}
