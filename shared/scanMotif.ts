import type { Board } from 'chessops/board';
import { SquareSet } from 'chessops/squareSet';

/**
 * The deep scan's canned motifs: a few curated pattern hunts the
 * relaxation ladder (shared/scanMatch.ts) cannot express, never a
 * query language (docs/deferred.md records that decision).
 *
 * A motif is a PREDICATE over each replayed position, the material
 * search's shape (a spec plus a stability length in plies) rather than
 * a ladder rung's (string equality against one whole signature).
 * Equality cannot say "one pawn on this file and none beside it,
 * whatever else stands anywhere", and no signature sees a MOVE — so
 * the two motifs here are the two kinds the ladder lacks:
 *
 *   `iqp` — an isolated queen's pawn. For a side: exactly one pawn on
 *   the d-file, none on the c- or e-file, AND the opponent has no
 *   d-pawn. The last clause is a judgment call, taken deliberately: it
 *   is what "the IQP" means in the literature — a lone d-pawn facing
 *   an open d-file, the middlegame ChessTempo and every textbook file
 *   under that name — and without it every symmetrical d4-vs-d5
 *   isolani pair would answer too. `side: 'either'` is the OR of the
 *   two sides, position by position.
 *
 *   `opposite-castling` — the two kings castled to different wings. A
 *   fact about the moves, not the board (a king on g1 may have walked
 *   there), so it lives in the replay functions (server/refgamesScan.ts)
 *   that observe each move; only its spec is parsed here. It takes no
 *   side.
 *
 * Neither motif is answerable from the packed scan-index
 * (shared/scanPack.ts carries no castling and only a pawn-FILES hash),
 * so motif hunts replay — the JS fallback and the native twin — and
 * skip the key-index and resident paths. Presets are data
 * (web/src/games/motifs.json), never code.
 *
 * MIRRORED IN RUST: native/src/scan_motif.rs implements the spec and
 * the IQP predicate byte-for-byte, and native/src/deep.rs the replay;
 * both are compared against fixtures exported from THIS file (npm run
 * build:native-goldens). Change anything here and regenerate.
 */

export const MOTIF_IDS = ['iqp', 'opposite-castling'] as const;
export type MotifId = (typeof MOTIF_IDS)[number];

export const MOTIF_SIDES = ['white', 'black', 'either'] as const;
export type MotifSide = (typeof MOTIF_SIDES)[number];

export interface MotifSpec {
  id: MotifId;
  /** Whose pattern. The IQP's alone: opposite castling is symmetric and
      must say 'either'. */
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
  if (id === 'opposite-castling' && side !== 'either') return null;
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

const C_FILE = SquareSet.fromFile(2);
const D_FILE = SquareSet.fromFile(3);
const E_FILE = SquareSet.fromFile(4);

/** Does this position hold an isolated queen's pawn for the side (the
    definition in the header), stability aside? */
export function iqpSatisfied(board: Board, side: MotifSide): boolean {
  const holds = (own: SquareSet, theirs: SquareSet): boolean =>
    own.intersect(D_FILE).size() === 1 &&
    own.intersect(C_FILE).isEmpty() &&
    own.intersect(E_FILE).isEmpty() &&
    theirs.intersect(D_FILE).isEmpty();
  const white = board.pawn.intersect(board.white);
  const black = board.pawn.intersect(board.black);
  if (side === 'white') return holds(white, black);
  if (side === 'black') return holds(black, white);
  return holds(white, black) || holds(black, white);
}
