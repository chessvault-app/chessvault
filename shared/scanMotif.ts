import type { Board } from 'chessops/board';
import type { SquareSet } from 'chessops/squareSet';
import type { Color } from 'chessops/types';

/**
 * The deep scan's canned motifs: curated pattern hunts the relaxation
 * ladder (shared/scanMatch.ts) cannot express, never a query language
 * (docs/deferred.md records that decision).
 *
 * A motif is a PREDICATE over each replayed position, the material
 * search's shape (a spec plus a stability length in plies) rather than
 * a ladder rung's (string equality against one whole signature).
 * Equality cannot say "one pawn on this file and none beside it,
 * whatever else stands anywhere", and no signature sees a MOVE — so the
 * motifs come in three kinds, by what the replay must watch:
 *
 *   `board` — a fact about the position, read off the board before
 *   each move, for a side (or either):
 *     `iqp` — an isolated queen's pawn: exactly one pawn on the d-file,
 *     none on the c- or e-file, AND the opponent has no d-pawn. The last
 *     clause is a judgment call, taken deliberately: it is what "the
 *     IQP" means in the literature — a lone d-pawn facing an open
 *     d-file — and without it every symmetrical d4-vs-d5 isolani pair
 *     would answer too.
 *     `doubled-pawns` — two or more pawns on one file.
 *     `passed-pawn` — a pawn with no enemy pawn ahead of it on its own
 *     or an adjacent file.
 *     `rook-on-seventh` — a rook on the seventh rank from its side.
 *     `fianchetto` — a bishop on g2 with a pawn on g3, or on b2 with
 *     b3 (g7/g6 and b7/b6 for Black): the structure, not the bishop
 *     alone.
 *     `knight-outpost` — a knight on its fifth or sixth rank, supported
 *     by a pawn, on a square no enemy pawn can ever attack (none on an
 *     adjacent file ahead of it).
 *     `opposite-bishops` — one bishop each on squares of different
 *     colours and no other piece but the kings and pawns: the ending.
 *     Symmetric, so it takes no side.
 *
 *   `castling` — a fact about the moves, not the board (a king on g1
 *   may have walked there): each side's castling wing is noted as the
 *   move is played. `opposite-castling` is the two kings on different
 *   wings, `same-side-castling` the same wing. Both symmetric, no side.
 *
 *   `move` — a fact about one move, remembered from then on, for the
 *   side that played it (or either): `greek-gift` is a bishop taking
 *   the pawn on h7 with check while the king stands on g8 (h2 and g1
 *   for Black); `underpromotion` a promotion to anything but a queen;
 *   `en-passant` an en passant capture.
 *
 * The board predicates live here; the castling and move kinds are
 * replay state and live with the replay in server/refgamesScan.ts.
 * None of the motifs is answerable from the packed scan-index
 * (shared/scanPack.ts carries no castling, no squares, only a
 * pawn-FILES hash), so motif hunts replay — the JS fallback and the
 * native twin — and skip the key-index and resident paths. Presets
 * are data (web/src/games/motifs.json), never code.
 *
 * MIRRORED IN RUST: native/src/scan_motif.rs implements the spec and
 * the board predicates byte-for-byte, and native/src/deep.rs the
 * replay; both are compared against fixtures exported from THIS file
 * (npm run build:native-goldens). Change anything here and regenerate,
 * and declare a new id in the crate's SUPPORTED_SCAN (the goldens hold
 * it to this list).
 */

export const MOTIF_IDS = [
  'iqp',
  'doubled-pawns',
  'passed-pawn',
  'rook-on-seventh',
  'fianchetto',
  'knight-outpost',
  'opposite-bishops',
  'opposite-castling',
  'same-side-castling',
  'greek-gift',
  'underpromotion',
  'en-passant',
] as const;
export type MotifId = (typeof MOTIF_IDS)[number];

export type MotifKind = 'board' | 'castling' | 'move';

/** What the replay must watch for each motif (see the header). */
export const MOTIF_KIND: Record<MotifId, MotifKind> = {
  iqp: 'board',
  'doubled-pawns': 'board',
  'passed-pawn': 'board',
  'rook-on-seventh': 'board',
  fianchetto: 'board',
  'knight-outpost': 'board',
  'opposite-bishops': 'board',
  'opposite-castling': 'castling',
  'same-side-castling': 'castling',
  'greek-gift': 'move',
  underpromotion: 'move',
  'en-passant': 'move',
};

/** Whether a motif can be somebody's: the castling motifs and the
    opposite-bishops ending are symmetric and take 'either' only. */
export function motifTakesSide(id: MotifId): boolean {
  return MOTIF_KIND[id] !== 'castling' && id !== 'opposite-bishops';
}

export const MOTIF_SIDES = ['white', 'black', 'either'] as const;
export type MotifSide = (typeof MOTIF_SIDES)[number];

export interface MotifSpec {
  id: MotifId;
  /** Whose pattern; 'either' for the symmetric motifs. */
  side: MotifSide;
  /** The motif must hold for at least this many consecutive plies. */
  stable: number;
}

/**
 * Parse a motif spec from the request, strictly: an unknown key, id or
 * side, a stability outside 1..60, or a side on a motif that takes
 * none are null (the route answers 400), never ignored — a constraint
 * silently dropped would be the same wrong-rows failure the capability
 * negotiation exists to prevent. Defaults: side 'either', stable 1.
 * The server validates for BOTH implementations: the binary only ever
 * receives what canonicalMotif re-serialised, so this is the one gate.
 */
export function parseMotifSpec(raw: string): MotifSpec | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const top = body as Record<string, unknown>;
  for (const key of Object.keys(top)) {
    if (!['id', 'side', 'stable'].includes(key)) return null;
  }
  if (typeof top.id !== 'string' || !(MOTIF_IDS as readonly string[]).includes(top.id)) {
    return null;
  }
  const id = top.id as MotifId;
  let side: MotifSide = 'either';
  if (top.side !== undefined) {
    if (typeof top.side !== 'string' || !(MOTIF_SIDES as readonly string[]).includes(top.side)) {
      return null;
    }
    side = top.side as MotifSide;
  }
  if (!motifTakesSide(id) && side !== 'either') return null;
  let stable = 1;
  if (top.stable !== undefined) {
    if (typeof top.stable !== 'number' || !Number.isInteger(top.stable)) return null;
    if (top.stable < 1 || top.stable > 60) return null;
    stable = top.stable;
  }
  return { id, side, stable };
}

/**
 * The one serialisation the native binary ever sees: fixed key order,
 * every field present. Deterministic, so the same spec always produces
 * the same argv and the Rust side parses a closed shape.
 */
export function canonicalMotif(spec: MotifSpec): string {
  return JSON.stringify({ id: spec.id, side: spec.side, stable: spec.stable });
}

/**
 * The motif id a raw request names, for the capability negotiation's
 * per-id token (server/refgames.ts) — read tolerantly, because the
 * negotiation runs on the request as sent, and garbage there must
 * route to the JS path (which then refuses it) rather than throw.
 */
export function motifIdOf(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    const body: unknown = JSON.parse(raw);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const id = (body as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

// The board predicates work on square numbers (a1 = 0 … h8 = 63, file =
// square & 7, rank = square >> 3), the one vocabulary both sides share
// exactly; nothing here leans on a library helper the Rust side would
// have to re-derive.

const fileOf = (square: number): number => square & 7;
const rankOf = (square: number): number => square >> 3;

/** Does the side hold the board motif in this position (stability
    aside)? The definitions are the header's; `opposite-bishops` is
    symmetric and answers the same for either colour. */
function boardHolds(board: Board, id: MotifId, color: Color): boolean {
  const white = color === 'white';
  const own = white ? board.white : board.black;
  const theirs = white ? board.black : board.white;
  const ownPawns = board.pawn.intersect(own);
  const theirPawns = board.pawn.intersect(theirs);
  // "Ahead" from this side's point of view.
  const ahead = (rank: number, from: number): boolean => (white ? rank > from : rank < from);
  const enemyPawnAhead = (files: number[], from: number): boolean => {
    for (const square of theirPawns) {
      if (files.includes(fileOf(square)) && ahead(rankOf(square), from)) return true;
    }
    return false;
  };
  const has = (set: SquareSet, square: number): boolean => set.has(square);
  switch (id) {
    case 'iqp': {
      let d = 0;
      let ce = 0;
      for (const square of ownPawns) {
        const file = fileOf(square);
        if (file === 3) d += 1;
        else if (file === 2 || file === 4) ce += 1;
      }
      if (d !== 1 || ce !== 0) return false;
      for (const square of theirPawns) if (fileOf(square) === 3) return false;
      return true;
    }
    case 'doubled-pawns': {
      const files = [0, 0, 0, 0, 0, 0, 0, 0];
      for (const square of ownPawns) {
        files[fileOf(square)] = (files[fileOf(square)] ?? 0) + 1;
        if (files[fileOf(square)]! >= 2) return true;
      }
      return false;
    }
    case 'passed-pawn': {
      for (const square of ownPawns) {
        const file = fileOf(square);
        if (!enemyPawnAhead([file - 1, file, file + 1], rankOf(square))) return true;
      }
      return false;
    }
    case 'rook-on-seventh': {
      const seventh = white ? 6 : 1;
      for (const square of board.rook.intersect(own)) {
        if (rankOf(square) === seventh) return true;
      }
      return false;
    }
    case 'fianchetto': {
      const bishops = board.bishop.intersect(own);
      // g2+g3 / b2+b3, or g7+g6 / b7+b6.
      return white
        ? (has(bishops, 14) && has(ownPawns, 22)) || (has(bishops, 9) && has(ownPawns, 17))
        : (has(bishops, 54) && has(ownPawns, 46)) || (has(bishops, 49) && has(ownPawns, 41));
    }
    case 'knight-outpost': {
      for (const square of board.knight.intersect(own)) {
        const file = fileOf(square);
        const rank = rankOf(square);
        // The fifth or sixth rank from this side.
        if (white ? rank !== 4 && rank !== 5 : rank !== 3 && rank !== 2) continue;
        // Supported by a pawn diagonally behind it.
        const behind = white ? rank - 1 : rank + 1;
        const supported =
          (file > 0 && has(ownPawns, behind * 8 + file - 1)) ||
          (file < 7 && has(ownPawns, behind * 8 + file + 1));
        if (!supported) continue;
        // No enemy pawn on an adjacent file could ever attack it.
        if (!enemyPawnAhead([file - 1, file + 1], rank)) return true;
      }
      return false;
    }
    case 'opposite-bishops': {
      if (!board.knight.isEmpty() || !board.rook.isEmpty() || !board.queen.isEmpty()) return false;
      const wb = board.bishop.intersect(board.white);
      const bb = board.bishop.intersect(board.black);
      if (wb.size() !== 1 || bb.size() !== 1) return false;
      const dark = (square: number): number => (fileOf(square) + rankOf(square)) & 1;
      return dark(wb.first()!) !== dark(bb.first()!);
    }
    default:
      return false;
  }
}

/** Does this position hold the board motif for the side asked, or for
    either side? For the castling and move kinds, which the board cannot
    show, always false — the replay answers those. */
export function boardMotifSatisfied(board: Board, id: MotifId, side: MotifSide): boolean {
  if (MOTIF_KIND[id] !== 'board') return false;
  if (side === 'white') return boardHolds(board, id, 'white');
  if (side === 'black') return boardHolds(board, id, 'black');
  return boardHolds(board, id, 'white') || boardHolds(board, id, 'black');
}

/** The IQP alone, the first motif and the one the tests name. */
export function iqpSatisfied(board: Board, side: MotifSide): boolean {
  return boardMotifSatisfied(board, 'iqp', side);
}
