import type { Board } from 'chessops/board';
import { squareFile } from 'chessops/util';

/**
 * The deep scan's relaxation ladder and material search.
 *
 * The ladder (Scid's) loosens a target position by degrees while the
 * scan skeleton stays the same: `exact` is the Zobrist key the scan has
 * always compared; `pawns` keeps every pawn on its exact square and the
 * piece material identical but lets the pieces stand anywhere; `files`
 * keeps the pawns only to their files; `material` keeps the piece
 * counts alone. Every one of THOSE rungs keeps the target's side to
 * move — they relax WHERE things stand, never whose turn it is — and
 * none of the relaxed rungs sees castling rights or en passant, which
 * are facts about squares the rung has already let go of.
 *
 * `structure` stands beside the ladder rather than on it (lanph3re's
 * rung): every pawn on its exact square and NOTHING else — pieces
 * free, side to move free. It is the query a pawns-only sketch means
 * ("games with this pawn skeleton, whatever the pieces are doing"),
 * which no ladder rung can express because they all pin the piece
 * material. The side to move is dropped deliberately: a structure is
 * a fact about a phase of the game, not about a move's turn, and
 * keeping it would silently halve the results of every hunt.
 *
 * The material search (ChessTempo's model) has no target position at
 * all: a spec of per-piece count ranges, white-minus-black difference
 * ranges, and a stability length in plies. Presets ("rook endings") are
 * data that expand to specs — never code.
 *
 * MIRRORED IN RUST: native/src/scan_match.rs implements these
 * byte-for-byte — the signature strings and the predicate are compared
 * against fixtures exported from THIS file (npm run
 * build:native-goldens). Change anything here and regenerate.
 */

export const MATCH_MODES = ['exact', 'pawns', 'files', 'material', 'structure'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/** Piece letters in the fixed order every signature and spec uses. */
const LETTERS = ['p', 'n', 'b', 'r', 'q'] as const;
export type PieceLetter = (typeof LETTERS)[number];

/** Per-side piece counts in LETTERS order (kings implicit — always 1). */
function counts(board: Board): { w: number[]; b: number[] } {
  const sets = [board.pawn, board.knight, board.bishop, board.rook, board.queen];
  return {
    w: sets.map((s) => s.intersect(board.white).size()),
    b: sets.map((s) => s.intersect(board.black).size()),
  };
}

/** Ascending square numbers (a1=0 … h8=63), the order both sides emit. */
function squares(set: Iterable<number>): number[] {
  return [...set].sort((a, z) => a - z);
}

/**
 * The position's signature under a relaxed rung — a string, compared to
 * the target's, computed only after the scan's cheap gates (men counts,
 * ply parity) already pass. The format is part of the native parity
 * contract; see the header.
 */
export function matchSignature(
  board: Board,
  mode: 'pawns' | 'files' | 'material' | 'structure',
): string {
  if (mode === 'structure') {
    const wp = squares(board.pawn.intersect(board.white)).join('.');
    const bp = squares(board.pawn.intersect(board.black)).join('.');
    return `s:${wp}/${bp}`;
  }
  const { w, b } = counts(board);
  const material = `${w.join(',')}-${b.join(',')}`;
  if (mode === 'material') return `m:${material}`;
  if (mode === 'pawns') {
    const wp = squares(board.pawn.intersect(board.white)).join('.');
    const bp = squares(board.pawn.intersect(board.black)).join('.');
    return `p:${material}:${wp}/${bp}`;
  }
  const perFile = (set: Iterable<number>): string => {
    const files = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const square of set) files[squareFile(square)] = (files[squareFile(square)] ?? 0) + 1;
    return files.join('');
  };
  const wf = perFile(board.pawn.intersect(board.white));
  const bf = perFile(board.pawn.intersect(board.black));
  return `f:${material}:${wf}/${bf}`;
}

/** An inclusive [min, max], both ends required by the canonical form. */
type Range = [number, number];

export interface MaterialSpec {
  white: Partial<Record<PieceLetter, Range>>;
  black: Partial<Record<PieceLetter, Range>>;
  /** White's count minus black's, per piece or aggregate. */
  diff: Partial<Record<PieceLetter | 'minor' | 'major', Range>>;
  /** The spec must hold for at least this many consecutive plies. */
  stable: number;
}

const DIFF_KEYS = [...LETTERS, 'minor', 'major'] as const;

/**
 * Parse a material spec from the request, strictly: unknown keys, bad
 * ranges and empty specs are null (the route answers 400), never
 * ignored — a constraint silently dropped would be the same wrong-rows
 * failure the capability negotiation exists to prevent. The server
 * validates for BOTH implementations: the binary only ever receives
 * what canonicalMaterial re-serialised, so this is the one gate.
 */
export function parseMaterialSpec(raw: string): MaterialSpec | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const top = body as Record<string, unknown>;
  for (const key of Object.keys(top)) {
    if (!['white', 'black', 'diff', 'stable'].includes(key)) return null;
  }
  const range = (value: unknown, lo: number, hi: number): Range | null => {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [min, max] = value as unknown[];
    if (typeof min !== 'number' || typeof max !== 'number') return null;
    if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
    if (min < lo || max > hi || min > max) return null;
    return [min, max];
  };
  const side = (value: unknown): Partial<Record<PieceLetter, Range>> | null => {
    if (value === undefined) return {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const out: Partial<Record<PieceLetter, Range>> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!(LETTERS as readonly string[]).includes(key)) return null;
      const parsed = range(entry, 0, 10);
      if (!parsed) return null;
      out[key as PieceLetter] = parsed;
    }
    return out;
  };
  const white = side(top.white);
  const black = side(top.black);
  if (!white || !black) return null;
  const diff: MaterialSpec['diff'] = {};
  if (top.diff !== undefined) {
    if (typeof top.diff !== 'object' || top.diff === null || Array.isArray(top.diff)) return null;
    for (const [key, entry] of Object.entries(top.diff)) {
      if (!(DIFF_KEYS as readonly string[]).includes(key)) return null;
      const parsed = range(entry, -10, 10);
      if (!parsed) return null;
      diff[key as (typeof DIFF_KEYS)[number]] = parsed;
    }
  }
  let stable = 1;
  if (top.stable !== undefined) {
    if (typeof top.stable !== 'number' || !Number.isInteger(top.stable)) return null;
    if (top.stable < 1 || top.stable > 60) return null;
    stable = top.stable;
  }
  // A spec that constrains nothing would match every game at ply 0 —
  // an accidental whole-database dump, refused rather than served.
  if (
    Object.keys(white).length === 0 &&
    Object.keys(black).length === 0 &&
    Object.keys(diff).length === 0
  ) {
    return null;
  }
  return { white, black, diff, stable };
}

/**
 * The one serialisation the native binary ever sees: keys in the fixed
 * LETTERS / DIFF_KEYS order, every field present. Deterministic, so the
 * same spec always produces the same argv and the Rust side can parse
 * a closed shape instead of re-validating the world.
 */
export function canonicalMaterial(spec: MaterialSpec): string {
  const ranges = <K extends string>(
    keys: readonly K[],
    from: Partial<Record<K, Range>>,
  ): Record<string, Range> => {
    const out: Record<string, Range> = {};
    for (const key of keys) {
      const entry = from[key];
      if (entry) out[key] = entry;
    }
    return out;
  };
  return JSON.stringify({
    white: ranges(LETTERS, spec.white),
    black: ranges(LETTERS, spec.black),
    diff: ranges(DIFF_KEYS, spec.diff),
    stable: spec.stable,
  });
}

/** Does this position's material satisfy the spec (stability aside)? */
export function materialSatisfied(board: Board, spec: MaterialSpec): boolean {
  const { w, b } = counts(board);
  const inRange = (value: number, entry: Range | undefined): boolean =>
    entry === undefined || (value >= entry[0] && value <= entry[1]);
  for (let at = 0; at < LETTERS.length; at += 1) {
    const letter = LETTERS[at]!;
    if (!inRange(w[at]!, spec.white[letter])) return false;
    if (!inRange(b[at]!, spec.black[letter])) return false;
    if (!inRange(w[at]! - b[at]!, spec.diff[letter])) return false;
  }
  if (!inRange(w[1]! + w[2]! - b[1]! - b[2]!, spec.diff.minor)) return false;
  if (!inRange(w[3]! + w[4]! - b[3]! - b[4]!, spec.diff.major)) return false;
  return true;
}

/**
 * Total-men bounds per side implied by the spec, king included — the
 * scan's SQL prefilter (a game must dip to hi or below to ever be in
 * range) and its early exit (below lo, men only leave, never again).
 * An unconstrained letter contributes its theoretical ceiling, capped
 * at the board's 16.
 */
export function materialMenBounds(spec: MaterialSpec): {
  loW: number;
  hiW: number;
  loB: number;
  hiB: number;
} {
  const CEILING: Record<PieceLetter, number> = { p: 8, n: 10, b: 10, r: 10, q: 9 };
  const bounds = (from: Partial<Record<PieceLetter, Range>>): [number, number] => {
    let lo = 1;
    let hi = 1;
    for (const letter of LETTERS) {
      const entry = from[letter];
      lo += entry ? entry[0] : 0;
      hi += entry ? entry[1] : CEILING[letter];
    }
    return [lo, Math.min(16, hi)];
  };
  const [loW, hiW] = bounds(spec.white);
  const [loB, hiB] = bounds(spec.black);
  return { loW, hiW, loB, hiB };
}
