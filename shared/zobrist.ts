import type { Setup } from 'chessops/setup';
import { squareFile } from 'chessops/util';
import type { Role } from 'chessops/types';

/**
 * 64-bit Zobrist hashing for opening-book keys.
 *
 * The tables are generated from a fixed seed with splitmix64, so keys are
 * stable across processes and releases — a book built by the indexer stays
 * readable by the server forever. (Not Polyglot-compatible on purpose: we
 * never read Polyglot books, and generated tables avoid embedding 781 magic
 * constants.) Bump BOOK_SCHEMA_VERSION if the scheme ever changes.
 *
 * CONSISTENCY RULE: always hash a `Setup` that came from `pos.toSetup()` or
 * `parseFen(...)`. `toSetup()` runs chessops's X-FEN normalisation, dropping
 * the en-passant square unless a legal capture exists. Hashing a raw
 * `pos.epSquare` (set after *every* double push) would make index-time and
 * query-time keys diverge on the same position.
 */

export const BOOK_SCHEMA_VERSION = 1;

const MASK64 = (1n << 64n) - 1n;

function splitmix64(seed: bigint): () => bigint {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  };
}

const next = splitmix64(0x63686573735f7661n); // 'chess_va'

/** piece keys: [color(2) × role(6) × square(64)] */
const PIECE = Array.from({ length: 2 * 6 * 64 }, next);
/** castling rights keyed by rook square, so it generalises beyond corners. */
const CASTLING = Array.from({ length: 64 }, next);
/** en-passant keyed by file, only hashed when the capture is actually legal. */
const EP_FILE = Array.from({ length: 8 }, next);
const BLACK_TO_MOVE = next();

/**
 * The tables split into 32-bit halves, so the hot loop XORs int32s.
 *
 * A BigInt XOR allocates, and the board iterator yields a fresh tuple
 * and a fresh Piece per occupied square; the index pass hashes every
 * ply of every game (the Gigabase is ~1.4 billion positions), so the
 * per-position cost was ~32 tuples, ~32 pieces and ~33 BigInts. The
 * halves are read from each colour-and-role bitboard's own `lo`/`hi`
 * words instead, and the one BigInt is built at the end. Same key:
 * XOR is order-independent, and the tables are the same numbers.
 */
function halves(keys: bigint[]): [Int32Array, Int32Array] {
  const lo = new Int32Array(keys.length);
  const hi = new Int32Array(keys.length);
  keys.forEach((k, i) => {
    lo[i] = Number(k & 0xffffffffn) | 0;
    hi[i] = Number(k >> 32n) | 0;
  });
  return [lo, hi];
}
const [PIECE_LO, PIECE_HI] = halves(PIECE);
const [CASTLING_LO, CASTLING_HI] = halves(CASTLING);
const [EP_FILE_LO, EP_FILE_HI] = halves(EP_FILE);
const BLACK_LO = Number(BLACK_TO_MOVE & 0xffffffffn) | 0;
const BLACK_HI = Number(BLACK_TO_MOVE >> 32n) | 0;

/** Table order: [color(2) x role(6) x square(64)], roles in this order. */
const ROLES: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/** The two words of the key, left here by `mix` (no result object per call). */
let accLo = 0;
let accHi = 0;

function mix(setup: Setup): void {
  let lo = 0;
  let hi = 0;
  const board = setup.board;
  for (let color = 0; color < 2; color += 1) {
    const side = color === 0 ? board.white : board.black;
    for (let role = 0; role < 6; role += 1) {
      const base = color * 384 + role * 64;
      const set = board[ROLES[role]!];
      let bits = side.lo & set.lo;
      while (bits !== 0) {
        const idx = 31 - Math.clz32(bits & -bits);
        bits ^= 1 << idx;
        lo ^= PIECE_LO[base + idx]!;
        hi ^= PIECE_HI[base + idx]!;
      }
      bits = side.hi & set.hi;
      while (bits !== 0) {
        const idx = 31 - Math.clz32(bits & -bits);
        bits ^= 1 << idx;
        lo ^= PIECE_LO[base + 32 + idx]!;
        hi ^= PIECE_HI[base + 32 + idx]!;
      }
    }
  }
  for (const rook of setup.castlingRights) {
    lo ^= CASTLING_LO[rook]!;
    hi ^= CASTLING_HI[rook]!;
  }
  if (setup.epSquare !== undefined) {
    const file = squareFile(setup.epSquare);
    lo ^= EP_FILE_LO[file]!;
    hi ^= EP_FILE_HI[file]!;
  }
  if (setup.turn === 'black') {
    lo ^= BLACK_LO;
    hi ^= BLACK_HI;
  }
  accLo = lo;
  accHi = hi;
}

/** Zobrist key of a (normalised) setup. See the consistency rule above. */
export function hashSetup(setup: Setup): bigint {
  mix(setup);
  return (BigInt(accHi >>> 0) << 32n) | BigInt(accLo >>> 0);
}

/**
 * The key's low 32 bits as a number: what the scan pack stores per
 * position (shared/scanPack.ts), with no BigInt built at all.
 */
export function hashSetupLow32(setup: Setup): number {
  mix(setup);
  return accLo >>> 0;
}

/** The hash as SQLite stores it: signed 64-bit, for INTEGER column binds. */
export function toDbKey(hash: bigint): bigint {
  return BigInt.asIntN(64, hash);
}
