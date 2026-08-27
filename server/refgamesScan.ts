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
import { PACK_KEYS_AT, packEventsAt, packLength, packPawnsAt, pawnFilesHash } from '../shared/scanPack.ts';

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

/**
 * A hunt compiled to flat scalars, once per scan, so the per-game loop
 * touches nothing but locals and pack bytes. The scan runs this loop a
 * hundred million times per Gigabase hunt: a class with array methods
 * here measured 4.5 s at 10.36M games, and the flattened form is what
 * the "sub-second at 10M" bar paid for. Semantics are identical to the
 * readable spec the loop replaced — the differential tests against the
 * replay reference are what hold that, not this comment.
 */
export interface CompiledPositionHunt {
  kind: 'position';
  /** 0 = exact (key32 gate), 1 = pawns/files (pawn-hash gate),
      2 = material rung (counts alone are the whole test). */
  gate: 0 | 1 | 2;
  parity: 0 | 1;
  key32: number;
  pawns8: number;
  tw: number;
  tb: number;
  /** The ten target counts, p,n,b,r,q per side. */
  c: Int32Array;
}

export interface CompiledMaterialHunt {
  kind: 'material';
  stable: number;
  loW: number;
  loB: number;
  hiW: number;
  hiB: number;
  /** Bounds, min/max interleaved: white p..q (0..9), black p..q
      (10..19), diff p..q (20..29), minor (30..31), major (32..33).
      Unconstrained slots hold sentinels wide enough to always pass. */
  b: Int32Array;
}

export type CompiledHunt = CompiledPositionHunt | CompiledMaterialHunt;

export function compilePositionHunt(target: PositionTarget): CompiledPositionHunt {
  const c = new Int32Array(10);
  for (let at = 0; at < 5; at += 1) {
    c[at] = target.wCounts[at]!;
    c[5 + at] = target.bCounts[at]!;
  }
  return {
    kind: 'position',
    gate: target.mode === 'exact' ? 0 : target.mode === 'material' ? 2 : 1,
    parity: target.blackToMove ? 1 : 0,
    key32: target.key32,
    pawns8: target.pawns8,
    tw: target.w,
    tb: target.b,
    c,
  };
}

export function compileMaterialHunt(spec: MaterialSpec): CompiledMaterialHunt {
  const { loW, loB, hiW, hiB } = materialMenBounds(spec);
  const b = new Int32Array(34);
  const LETTERS = ['p', 'n', 'b', 'r', 'q'] as const;
  const put = (at: number, entry: [number, number] | undefined, lo: number, hi: number): void => {
    b[at] = entry ? entry[0] : lo;
    b[at + 1] = entry ? entry[1] : hi;
  };
  for (let at = 0; at < 5; at += 1) {
    const letter = LETTERS[at]!;
    put(at * 2, spec.white[letter], 0, 99);
    put(10 + at * 2, spec.black[letter], 0, 99);
    put(20 + at * 2, spec.diff[letter], -99, 99);
  }
  put(30, spec.diff.minor, -99, 99);
  put(32, spec.diff.major, -99, 99);
  return { kind: 'material', stable: spec.stable, loW, loB, hiW, hiB, b };
}

const badLength = (pack: Uint8Array): number => {
  if (pack.length < 2) throw new BadPack('truncated header');
  const npos = pack[0]! | (pack[1]! << 8);
  if (npos < 1 || pack.length !== packLength(npos)) throw new BadPack('bad length');
  return npos;
};

/**
 * The pack-side answer to a position hunt: the first CANDIDATE ply, or
 * null when the game cannot contain the target at all.
 *
 * Exact where the pack carries the whole test (the material rung:
 * parity + per-piece counts IS the signature); a prefilter elsewhere —
 * the exact rung gates on parity, counts and the 32-bit key prefix
 * (a collision is possible, a miss is not), and the pawns/files rungs
 * add the pawn-files hash. Callers verify a non-null answer with
 * replayPositionHit unless the mode is 'material'.
 */
export function scanPackPosition(pack: Uint8Array, hunt: CompiledPositionHunt): number | null {
  const npos = badLength(pack);
  const { gate, parity, key32, pawns8, tw, tb, c } = hunt;
  const twp = c[0]!, twn = c[1]!, twb = c[2]!, twr = c[3]!, twq = c[4]!;
  const tbp = c[5]!, tbn = c[6]!, tbb = c[7]!, tbr = c[8]!, tbq = c[9]!;
  // The envelope: reject the whole game when the target's counts fall
  // outside what it ever held — a necessary condition, so a skipped
  // game never could have matched.
  if (pack[2]! > tw || pack[3]! > tb) return null;
  for (let at = 0; at < 10; at += 1) {
    const env = pack[4 + at]!;
    const want = c[at]!;
    if (want < env >> 4 || want > (env & 15)) return null;
  }
  const pawnsAt = packPawnsAt(npos);
  const eventsAt = packEventsAt(npos);
  let wp = 8, wn = 2, wb = 2, wr = 2, wq = 1, wTot = 16;
  let bp = 8, bn = 2, bb = 2, br = 2, bq = 1, bTot = 16;
  for (let ply = 0; ply < npos; ply += 1) {
    if (
      (ply & 1) === parity &&
      wTot === tw && bTot === tb &&
      wp === twp && wn === twn && wb === twb && wr === twr && wq === twq &&
      bp === tbp && bn === tbn && bb === tbb && br === tbr && bq === tbq &&
      (gate === 2 ||
        (gate === 1
          ? pack[pawnsAt + ply] === pawns8
          : ((pack[PACK_KEYS_AT + 4 * ply]! |
              (pack[PACK_KEYS_AT + 1 + 4 * ply]! << 8) |
              (pack[PACK_KEYS_AT + 2 + 4 * ply]! << 16) |
              (pack[PACK_KEYS_AT + 3 + 4 * ply]! << 24)) >>>
              0) ===
            key32))
    ) {
      return ply;
    }
    // Men only leave: below the target's totals, this game is done.
    if (wTot < tw || bTot < tb) return null;
    if (ply < npos - 1) {
      const event = pack[eventsAt + ply]!;
      if (event !== 0) {
        const cap = event & 7;
        const promo = (event >> 3) & 7;
        if ((ply & 1) === 0) {
          if (cap !== 0) {
            bTot -= 1;
            if (cap === 1) bp -= 1; else if (cap === 2) bn -= 1; else if (cap === 3) bb -= 1;
            else if (cap === 4) br -= 1; else bq -= 1;
          }
          if (promo !== 0) {
            wp -= 1;
            if (promo === 2) wn += 1; else if (promo === 3) wb += 1;
            else if (promo === 4) wr += 1; else wq += 1;
          }
        } else {
          if (cap !== 0) {
            wTot -= 1;
            if (cap === 1) wp -= 1; else if (cap === 2) wn -= 1; else if (cap === 3) wb -= 1;
            else if (cap === 4) wr -= 1; else wq -= 1;
          }
          if (promo !== 0) {
            bp -= 1;
            if (promo === 2) bn += 1; else if (promo === 3) bb += 1;
            else if (promo === 4) br += 1; else bq += 1;
          }
        }
      }
    }
  }
  return null;
}

/**
 * The pack-side answer to a material hunt — EXACT, not a prefilter:
 * the events reconstruct every position's counts, which is everything
 * the spec tests. Must answer identically to replayMaterialHit over
 * the same game; the differential tests hold it to that.
 */
export function scanPackMaterial(pack: Uint8Array, hunt: CompiledMaterialHunt): number | null {
  const npos = badLength(pack);
  const { stable, loW, loB, hiW, hiB, b } = hunt;
  // The envelope: the game's count ranges must OVERLAP everything the
  // spec demands — per piece, per side, per difference, and in totals
  // (the game must dip to the spec's ceiling to ever be in range).
  // Necessary conditions all: extremes need not co-occur, so surviving
  // proves nothing, but a skip is final.
  if (pack[2]! > hiW || pack[3]! > hiB) return null;
  for (let at = 0; at < 5; at += 1) {
    const wEnv = pack[4 + at]!;
    const bEnv = pack[9 + at]!;
    const wMin = wEnv >> 4, wMax = wEnv & 15;
    const bMin = bEnv >> 4, bMax = bEnv & 15;
    if (wMin > b[at * 2 + 1]! || wMax < b[at * 2]!) return null;
    if (bMin > b[10 + at * 2 + 1]! || bMax < b[10 + at * 2]!) return null;
    if (wMin - bMax > b[20 + at * 2 + 1]! || wMax - bMin < b[20 + at * 2]!) return null;
  }
  {
    const wnEnv = pack[5]!, wbEnv = pack[6]!, bnEnv = pack[10]!, bbEnv = pack[11]!;
    const wrEnv = pack[7]!, wqEnv = pack[8]!, brEnv = pack[12]!, bqEnv = pack[13]!;
    const minorLo = (wnEnv >> 4) + (wbEnv >> 4) - (bnEnv & 15) - (bbEnv & 15);
    const minorHi = (wnEnv & 15) + (wbEnv & 15) - (bnEnv >> 4) - (bbEnv >> 4);
    if (minorLo > b[31]! || minorHi < b[30]!) return null;
    const majorLo = (wrEnv >> 4) + (wqEnv >> 4) - (brEnv & 15) - (bqEnv & 15);
    const majorHi = (wrEnv & 15) + (wqEnv & 15) - (brEnv >> 4) - (bqEnv >> 4);
    if (majorLo > b[33]! || majorHi < b[32]!) return null;
  }
  const eventsAt = packEventsAt(npos);
  let wp = 8, wn = 2, wb = 2, wr = 2, wq = 1, wTot = 16;
  let bp = 8, bn = 2, bb = 2, br = 2, bq = 1, bTot = 16;
  let streak = 0;
  for (let ply = 0; ply < npos; ply += 1) {
    if (
      wp >= b[0]! && wp <= b[1]! && wn >= b[2]! && wn <= b[3]! &&
      wb >= b[4]! && wb <= b[5]! && wr >= b[6]! && wr <= b[7]! &&
      wq >= b[8]! && wq <= b[9]! &&
      bp >= b[10]! && bp <= b[11]! && bn >= b[12]! && bn <= b[13]! &&
      bb >= b[14]! && bb <= b[15]! && br >= b[16]! && br <= b[17]! &&
      bq >= b[18]! && bq <= b[19]! &&
      wp - bp >= b[20]! && wp - bp <= b[21]! &&
      wn - bn >= b[22]! && wn - bn <= b[23]! &&
      wb - bb >= b[24]! && wb - bb <= b[25]! &&
      wr - br >= b[26]! && wr - br <= b[27]! &&
      wq - bq >= b[28]! && wq - bq <= b[29]! &&
      wn + wb - bn - bb >= b[30]! && wn + wb - bn - bb <= b[31]! &&
      wr + wq - br - bq >= b[32]! && wr + wq - br - bq <= b[33]!
    ) {
      streak += 1;
      if (streak >= stable) return ply - stable + 1;
    } else {
      streak = 0;
    }
    if (wTot < loW || bTot < loB) return null;
    if (ply < npos - 1) {
      const event = pack[eventsAt + ply]!;
      if (event !== 0) {
        const cap = event & 7;
        const promo = (event >> 3) & 7;
        if ((ply & 1) === 0) {
          if (cap !== 0) {
            bTot -= 1;
            if (cap === 1) bp -= 1; else if (cap === 2) bn -= 1; else if (cap === 3) bb -= 1;
            else if (cap === 4) br -= 1; else bq -= 1;
          }
          if (promo !== 0) {
            wp -= 1;
            if (promo === 2) wn += 1; else if (promo === 3) wb += 1;
            else if (promo === 4) wr += 1; else wq += 1;
          }
        } else {
          if (cap !== 0) {
            wTot -= 1;
            if (cap === 1) wp -= 1; else if (cap === 2) wn -= 1; else if (cap === 3) wb -= 1;
            else if (cap === 4) wr -= 1; else wq -= 1;
          }
          if (promo !== 0) {
            bp -= 1;
            if (promo === 2) bn += 1; else if (promo === 3) bb += 1;
            else if (promo === 4) br += 1; else bq += 1;
          }
        }
      }
    }
  }
  return null;
}

/** The uncompiled faces, for tests and one-off callers: compile, scan. */
export function packPositionCandidate(pack: Uint8Array, target: PositionTarget): number | null {
  return scanPackPosition(pack, compilePositionHunt(target));
}

export function packMaterialHit(pack: Uint8Array, spec: MaterialSpec): number | null {
  return scanPackMaterial(pack, compileMaterialHunt(spec));
}
