import { describe, expect, it } from 'vitest';
import { Chess, normalizeMove } from 'chessops/chess';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import type { NormalMove, Role } from 'chessops/types';
import { MATCH_MODES, parseMaterialSpec } from '../shared/scanMatch.ts';
import { encodeScanPack } from '../shared/scanPack.ts';
import {
  BadPack,
  packMaterialHit,
  packPositionCandidate,
  positionTarget,
  replayMaterialHit,
  replayPositionHit,
} from './refgamesScan.ts';

/**
 * The pack scanner's contract, held differentially against the replay
 * reference over a generated corpus: EXACT agreement where the pack
 * carries the whole test (material hunts, the material rung), and
 * soundness where it is a prefilter (a replay hit implies a pack
 * candidate at or before it — a false negative is a silently missing
 * game, the failure nothing would surface).
 */

// Deterministic self-play, the goldens' own generator shape.
const MASK64 = (1n << 64n) - 1n;
const splitmix64 = (seed: bigint): (() => bigint) => {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  };
};
const rng = splitmix64(0x7363616e7061636bn); // 'scanpack'
const randInt = (n: number): number => Number(rng() % BigInt(n));

const legalMoves = (pos: Chess): NormalMove[] => {
  const out: NormalMove[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from);
      if (piece?.role === 'pawn' && (to >= 56 || to <= 7)) {
        for (const promotion of ['queen', 'knight', 'rook', 'bishop'] as Role[]) {
          out.push({ from, to, promotion });
        }
      } else {
        out.push({ from, to });
      }
    }
  }
  return out;
};

const selfPlay = (targetPlies: number): string => {
  const pos = Chess.default();
  const sans: string[] = [];
  for (let ply = 0; ply < targetPlies; ply += 1) {
    const moves = legalMoves(pos);
    if (moves.length === 0) break;
    sans.push(makeSanAndPlay(pos, normalizeMove(pos, moves[randInt(moves.length)]!)));
  }
  return sans.join(' ');
};

const CORPUS: string[] = [
  // The event-byte corner cases, by hand.
  'e4 c5 e5 d5 exd6', // en passant
  'e4 d5 exd5 c6 dxc6 Nf6 cxb7 Nbd7 bxa8=Q', // capture-promotion
  'e4 d5 exd5 c6 dxc6 Nf6 cxb7 Nbd7 bxa8=N', // underpromotion
  'd4 d5 Nc3 Nc6 Bf4 Bf5 Qd2 Qd7 O-O-O O-O-O', // castling both sides
  'e4 e5 Zz9 d4', // SAN stops parsing — both sides stop together
  ...Array.from({ length: 40 }, () => selfPlay(20 + randInt(140))),
];

const positionAt = (moves: string, ply: number): Chess | null => {
  const pos = Chess.default();
  let at = 0;
  for (const san of moves.split(' ')) {
    if (at === ply) return pos;
    const move = parseSan(pos, san);
    if (!move) return null;
    pos.play(move);
    at += 1;
  }
  return at === ply ? pos : null;
};

describe('pack scan vs replay scan', () => {
  it('position hunts: exact where the pack can be, sound everywhere', () => {
    let hits = 0;
    let candidatesVerifiedAway = 0;
    for (const moves of CORPUS) {
      const pack = encodeScanPack(moves);
      const plyCount = moves.split(' ').length;
      // Targets that occur (sampled from THIS game) and ones that
      // mostly do not (sampled from the next game over).
      const sources = [moves, CORPUS[(CORPUS.indexOf(moves) + 7) % CORPUS.length]!];
      for (const source of sources) {
        for (const at of [0, 5, 11, 24, Math.max(0, plyCount - 1)]) {
          const target = positionAt(source, at);
          if (!target) continue;
          for (const mode of MATCH_MODES) {
            const built = positionTarget(target, mode);
            const replay = replayPositionHit(moves, built);
            const candidate = packPositionCandidate(pack, built);
            if (mode === 'material') {
              // The pack carries the material rung's whole test.
              expect(candidate, `material rung on ${moves.slice(0, 40)}`).toBe(replay);
            } else if (replay !== null) {
              hits += 1;
              // Soundness: a replay hit MUST have a candidate, at or
              // before it (a 32-bit collision can only fire early).
              expect(candidate, `missed hit in ${moves.slice(0, 40)}`).not.toBeNull();
              expect(candidate!).toBeLessThanOrEqual(replay);
            } else if (candidate !== null) {
              // A candidate the replay rejects — allowed (prefilter),
              // counted so a wildly loose filter would show up here.
              candidatesVerifiedAway += 1;
            }
          }
        }
      }
    }
    // The corpus must actually exercise the hit path, or the soundness
    // clause above tested nothing.
    expect(hits).toBeGreaterThan(50);
    // And the prefilter must be doing SOME work: the pawns/files rungs
    // gate on counts alone, so some verified-away candidates are
    // expected — but if most tests produced one, the gates are broken.
    expect(candidatesVerifiedAway).toBeGreaterThan(0);
  });

  it('material hunts: byte-for-byte the replay answer', () => {
    const SPECS = [
      '{"white":{"q":[0,0]},"black":{"q":[0,0]}}',
      '{"white":{"r":[1,1],"n":[0,0],"b":[0,0],"q":[0,0]},"black":{"r":[1,2]},"stable":4}',
      '{"diff":{"minor":[1,10]},"stable":2}',
      '{"diff":{"q":[1,9]}}',
      '{"white":{"p":[0,4]},"black":{"p":[0,4]},"stable":8}',
      '{"white":{"n":[2,2]},"stable":1}',
    ].map((raw) => parseMaterialSpec(raw)!);
    let hits = 0;
    for (const moves of CORPUS) {
      const pack = encodeScanPack(moves);
      for (const spec of SPECS) {
        const replay = replayMaterialHit(moves, spec);
        expect(packMaterialHit(pack, spec), `${moves.slice(0, 40)}`).toBe(replay);
        if (replay !== null) hits += 1;
      }
    }
    expect(hits).toBeGreaterThan(20);
  });

  it('refuses a malformed pack instead of answering from it', () => {
    const target = positionTarget(Chess.default(), 'exact');
    const spec = parseMaterialSpec('{"white":{"q":[0,0]}}')!;
    for (const bad of [new Uint8Array([]), new Uint8Array([0, 0]), encodeScanPack('e4').slice(0, 5)]) {
      expect(() => packPositionCandidate(bad, target)).toThrow(BadPack);
      expect(() => packMaterialHit(bad, spec)).toThrow(BadPack);
    }
  });
});
