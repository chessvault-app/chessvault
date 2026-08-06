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

const ROLE_INDEX: Record<Role, number> = {
  pawn: 0,
  knight: 1,
  bishop: 2,
  rook: 3,
  queen: 4,
  king: 5,
};

const next = splitmix64(0x63686573735f7661n); // 'chess_va'

/** piece keys: [color(2) × role(6) × square(64)] */
const PIECE = Array.from({ length: 2 * 6 * 64 }, next);
/** castling rights keyed by rook square, so it generalises beyond corners. */
const CASTLING = Array.from({ length: 64 }, next);
/** en-passant keyed by file, only hashed when the capture is actually legal. */
const EP_FILE = Array.from({ length: 8 }, next);
const BLACK_TO_MOVE = next();

/** Zobrist key of a (normalised) setup. See the consistency rule above. */
export function hashSetup(setup: Setup): bigint {
  let h = 0n;
  for (const [square, piece] of setup.board) {
    const colorOffset = piece.color === 'white' ? 0 : 384;
    h ^= PIECE[colorOffset + ROLE_INDEX[piece.role] * 64 + square]!;
  }
  for (const rook of setup.castlingRights) h ^= CASTLING[rook]!;
  if (setup.epSquare !== undefined) h ^= EP_FILE[squareFile(setup.epSquare)]!;
  if (setup.turn === 'black') h ^= BLACK_TO_MOVE;
  return h;
}

/** The hash as SQLite stores it: signed 64-bit, for INTEGER column binds. */
export function toDbKey(hash: bigint): bigint {
  return BigInt.asIntN(64, hash);
}
