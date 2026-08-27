import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';
import {
  matchSignature,
  materialMenBounds,
  materialSatisfied,
  type MatchMode,
  type MaterialSpec,
} from '../shared/scanMatch.ts';
import { pawnFilesHash } from '../shared/scanPack.ts';

/**
 * The deep scan's per-game answers, in both speeds.
 *
 * The REPLAY functions are the reference: they parse the SAN and walk
 * the real board, and the deep-search route streams whatever they say.
 * The PACK functions answer the same questions from a game's scan_pack
 * blob (shared/scanPack.ts) without touching the movetext — key32
 * prefixes and material events instead of replay — which is the whole
 * point of the packed index. Their contract with the replay side is
 * exact where the pack carries enough (a material hunt, the material
 * rung) and a SOUND PREFILTER where it does not (exact / pawns / files
 * rungs): a pack candidate must be verified by the replay function, and
 * a pack answering null MUST mean the replay would too — a false
 * negative is a silently missing game, the one failure nothing would
 * surface. The differential tests in refgamesScan.test.ts hold that
 * line over a generated corpus.
 */

/** What one position must equal for a position hunt — precomputed once
    per hunt, shared by both speeds. */
export interface PositionTarget {
  mode: MatchMode;
  /** Signed db key — the exact rung's test (mode 'exact'). */
  key: bigint;
  /** Low 32 bits of the unsigned hash — the pack's prefilter. */
  key32: number;
  /** The relaxed rung's signature (modes other than 'exact'). */
  sig: string;
  /** The pawn-files hash — the pack's structure gate for the pawns and
      files rungs, without which their candidates were every game whose
      piece counts matched (measured 112 s of verification at 5M). */
  pawns8: number;
  /** Per-piece counts in p,n,b,r,q order — the pack-side gates. */
  wCounts: number[];
  bCounts: number[];
  w: number;
  b: number;
  blackToMove: boolean;
}

const MASK32 = 0xffffffffn;

/** Build the target from a parsed position, for either speed. */
export function positionTarget(target: Chess, mode: MatchMode): PositionTarget {
  const hash = hashSetup(target.toSetup());
  const sets = [
    target.board.pawn,
    target.board.knight,
    target.board.bishop,
    target.board.rook,
    target.board.queen,
  ];
  return {
    mode,
    key: toDbKey(hash),
    key32: Number(hash & MASK32),
    sig: mode === 'exact' ? '' : matchSignature(target.board, mode),
    pawns8: pawnFilesHash(target.board),
    wCounts: sets.map((s) => s.intersect(target.board.white).size()),
    bCounts: sets.map((s) => s.intersect(target.board.black).size()),
    w: target.board.white.size(),
    b: target.board.black.size(),
    blackToMove: target.turn === 'black',
  };
}

/**
 * The ply at which the game reaches the target position, or null — the
 * reference the deep-search route streams. Cheap gates before the
 * expensive test; SAN's own capture mark tracks the men (a board check
 * would miss en passant); men only leave, so past the target's counts
 * the game is done; the final position is a position too.
 */
export function replayPositionHit(moves: string, target: PositionTarget): number | null {
  const pos = Chess.default();
  let w = 16;
  let b = 16;
  let ply = 0;
  const atTarget = (): boolean =>
    (ply % 2 === 1) === target.blackToMove &&
    w === target.w &&
    b === target.b &&
    (target.mode === 'exact'
      ? toDbKey(hashSetup(pos.toSetup())) === target.key
      : matchSignature(pos.board, target.mode) === target.sig);
  for (const san of moves.split(' ')) {
    if (atTarget()) return ply;
    const move = parseSan(pos, san);
    if (!move) break;
    if (san.includes('x')) {
      if (ply % 2 === 0) b -= 1;
      else w -= 1;
      if (w < target.w || b < target.b) break;
    }
    pos.play(move);
    ply += 1;
  }
  return atTarget() ? ply : null;
}

/**
 * The FIRST ply of the earliest streak satisfying the material spec for
 * its stability length, or null — the reference. No parity gate, the
 * spec's own floor as the early exit, and breaks return null directly:
 * the streak is stateful, and re-testing a counted position would
 * count it twice.
 */
export function replayMaterialHit(moves: string, spec: MaterialSpec): number | null {
  const { loW, loB } = materialMenBounds(spec);
  const pos = Chess.default();
  let w = 16;
  let b = 16;
  let ply = 0;
  let streak = 0;
  const step = (): number | null => {
    if (materialSatisfied(pos.board, spec)) {
      streak += 1;
      if (streak >= spec.stable) return ply - spec.stable + 1;
    } else {
      streak = 0;
    }
    return null;
  };
  for (const san of moves.split(' ')) {
    const hit = step();
    if (hit !== null) return hit;
    const move = parseSan(pos, san);
    if (!move) return null;
    if (san.includes('x')) {
      if (ply % 2 === 0) b -= 1;
      else w -= 1;
      if (w < loW || b < loB) return null;
    }
    pos.play(move);
    ply += 1;
  }
  return step();
}

/** A malformed blob — the caller falls back to the replay for that
    game rather than silently losing it. */
export class BadPack extends Error {}

/** The pack's counts machine: per-piece counts per side, evolved one
    event byte at a time. Indices are the LETTERS order p,n,b,r,q. */
class Counts {
  w = [8, 2, 2, 2, 1];
  b = [8, 2, 2, 2, 1];
  wTotal = 16;
  bTotal = 16;

  /** Apply the event that produced position `ply + 1` from `ply`. */
  apply(event: number, ply: number): void {
    const captured = event & 7;
    const promoted = (event >> 3) & 7;
    const whiteMoved = ply % 2 === 0;
    if (captured !== 0) {
      const side = whiteMoved ? this.b : this.w;
      side[captured - 1] = (side[captured - 1] ?? 0) - 1;
      if (whiteMoved) this.bTotal -= 1;
      else this.wTotal -= 1;
    }
    if (promoted !== 0) {
      const side = whiteMoved ? this.w : this.b;
      side[0] = (side[0] ?? 0) - 1;
      side[promoted - 1] = (side[promoted - 1] ?? 0) + 1;
    }
  }

  equals(wCounts: number[], bCounts: number[]): boolean {
    for (let at = 0; at < 5; at += 1) {
      if (this.w[at] !== wCounts[at] || this.b[at] !== bCounts[at]) return false;
    }
    return true;
  }
}

const header = (pack: Uint8Array): { npos: number; view: DataView } => {
  if (pack.length < 2) throw new BadPack('truncated header');
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const npos = view.getUint16(0, true);
  if (npos < 1 || pack.length !== 2 + 5 * npos + (npos - 1)) throw new BadPack('bad length');
  return { npos, view };
};

/**
 * The pack-side answer to a position hunt: the first CANDIDATE ply, or
 * null when the game cannot contain the target at all.
 *
 * Exact where the pack carries the whole test (the material rung:
 * parity + per-piece counts IS the signature); a prefilter elsewhere —
 * the exact rung gates on parity, counts and the 32-bit key prefix
 * (a collision is possible, a miss is not), and the pawns/files rungs
 * gate on parity and counts alone (the pack has no pawn squares).
 * Callers verify a non-null answer with replayPositionHit unless the
 * mode is 'material'.
 */
export function packPositionCandidate(pack: Uint8Array, target: PositionTarget): number | null {
  const { npos, view } = header(pack);
  const counts = new Counts();
  for (let ply = 0; ply < npos; ply += 1) {
    if (
      (ply % 2 === 1) === target.blackToMove &&
      counts.wTotal === target.w &&
      counts.bTotal === target.b &&
      counts.equals(target.wCounts, target.bCounts) &&
      // The structure gates, each rung's own: the exact rung has the
      // key prefix, the pawns and files rungs the pawn-files hash
      // (same placement implies same file counts, so it is sound for
      // pawns too), the material rung needs nothing past the counts.
      (target.mode === 'exact'
        ? view.getUint32(2 + 4 * ply, true) === target.key32
        : target.mode === 'material' || pack[2 + 4 * npos + ply] === target.pawns8)
    ) {
      return ply;
    }
    // Men only leave: below the target's totals, this game is done.
    if (counts.wTotal < target.w || counts.bTotal < target.b) return null;
    if (ply < npos - 1) counts.apply(pack[2 + 5 * npos + ply]!, ply);
  }
  return null;
}

/**
 * The pack-side answer to a material hunt — EXACT, not a prefilter:
 * the events reconstruct every position's counts, which is everything
 * the spec tests. Must answer identically to replayMaterialHit over
 * the same game; the differential tests hold it to that.
 */
export function packMaterialHit(pack: Uint8Array, spec: MaterialSpec): number | null {
  const { npos } = header(pack);
  const { loW, loB } = materialMenBounds(spec);
  const counts = new Counts();
  let streak = 0;
  const LETTERS = ['p', 'n', 'b', 'r', 'q'] as const;
  const inRange = (value: number, entry: [number, number] | undefined): boolean =>
    entry === undefined || (value >= entry[0] && value <= entry[1]);
  const satisfied = (): boolean => {
    for (let at = 0; at < 5; at += 1) {
      const letter = LETTERS[at]!;
      if (!inRange(counts.w[at]!, spec.white[letter])) return false;
      if (!inRange(counts.b[at]!, spec.black[letter])) return false;
      if (!inRange(counts.w[at]! - counts.b[at]!, spec.diff[letter])) return false;
    }
    return (
      inRange(counts.w[1]! + counts.w[2]! - counts.b[1]! - counts.b[2]!, spec.diff.minor) &&
      inRange(counts.w[3]! + counts.w[4]! - counts.b[3]! - counts.b[4]!, spec.diff.major)
    );
  };
  for (let ply = 0; ply < npos; ply += 1) {
    if (satisfied()) {
      streak += 1;
      if (streak >= spec.stable) return ply - spec.stable + 1;
    } else {
      streak = 0;
    }
    if (counts.wTotal < loW || counts.bTotal < loB) return null;
    if (ply < npos - 1) counts.apply(pack[2 + 5 * npos + ply]!, ply);
  }
  return null;
}
