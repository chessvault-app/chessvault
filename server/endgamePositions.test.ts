import { describe, expect, it } from 'vitest';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { materialSatisfied, parseMaterialSpec, type MaterialSpec } from '../shared/scanMatch.ts';
import ENDGAMES from '../web/src/games/endgames.json';
import { MAX_MEN, drawCandidates, drillable, samplePosition } from './endgamePositions.ts';

/** mulberry32: a small seeded generator, so a failure here replays. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const spec = (json: unknown): MaterialSpec => {
  const parsed = parseMaterialSpec(JSON.stringify(json));
  if (!parsed) throw new Error('spec does not parse');
  return parsed;
};

/** Everything a candidate promises, checked with chessops rather than
    trusted from the sampler. */
function check(fen: string, of: MaterialSpec): void {
  const setup = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  expect(setup.board.occupied.size(), fen).toBeLessThanOrEqual(MAX_MEN);
  expect(setup.castlingRights.isEmpty(), fen).toBe(true);
  expect(setup.halfmoves).toBe(0);
  expect(materialSatisfied(setup.board, of), fen).toBe(true);
  // Pawns off the first and last ranks, where chessops would not have
  // refused them but no game could have put them.
  for (const square of setup.board.pawn) expect(square >= 8 && square < 56, fen).toBe(true);
  expect(pos.isEnd(), fen).toBe(false);
  expect(pos.isInsufficientMaterial(), fen).toBe(false);
  // The side to move has something to win with.
  expect(setup.board[setup.turn].diff(setup.board.king).isEmpty(), fen).toBe(false);
}

describe('drillable', () => {
  it('admits a class whose minimums fit under seven men with the kings', () => {
    expect(drillable(spec({ white: { r: [1, 2] }, black: { r: [1, 2] } }))).toBe(true);
    expect(drillable(spec({ white: { r: [2, 2], b: [1, 1] }, black: { r: [2, 2] } }))).toBe(true);
  });

  it('refuses one that cannot', () => {
    // Two rooks and a bishop against two rooks is seven pieces plus two
    // kings: nine men, past any table.
    expect(drillable(spec({ white: { r: [2, 2], b: [1, 1] }, black: { r: [2, 2], n: [1, 1] } }))).toBe(
      false,
    );
    expect(drawCandidates(spec({ white: { q: [3, 3] }, black: { q: [3, 3] } }), 5, rng(1))).toEqual([]);
  });
});

describe('samplePosition', () => {
  it('returns legal positions of the material asked for, with the side to move given', () => {
    const rook = spec({ white: { r: [1, 1], p: [0, 0] }, black: { r: [1, 1], p: [0, 0] } });
    const random = rng(7);
    let found = 0;
    for (let i = 0; i < 200 && found < 20; i += 1) {
      const fen = samplePosition(rook, i % 2 ? 'black' : 'white', random);
      if (!fen) continue;
      found += 1;
      check(fen, rook);
      expect(fen.split(' ')[1]).toBe(i % 2 ? 'b' : 'w');
    }
    expect(found).toBe(20);
  });

  it('honours a difference range, not just the per-side counts', () => {
    // "A pawn up": the preset says nothing about which pieces, only
    // that White has one more pawn.
    const pawnUp = spec(ENDGAMES.find((e) => e.id === 'pawn-up')!.spec);
    const random = rng(3);
    let found = 0;
    for (let i = 0; i < 400 && found < 10; i += 1) {
      const fen = samplePosition(pawnUp, 'white', random);
      if (!fen) continue;
      found += 1;
      const board = parseFen(fen).unwrap().board;
      // The preset: one to eight pawns up, every piece count level.
      expect(
        board.pawn.intersect(board.white).size() - board.pawn.intersect(board.black).size(),
      ).toBeGreaterThanOrEqual(1);
      for (const set of [board.knight, board.bishop, board.rook, board.queen]) {
        expect(set.intersect(board.white).size()).toBe(set.intersect(board.black).size());
      }
    }
    expect(found).toBe(10);
  });
});

describe('drawCandidates', () => {
  it('yields legal candidates for every preset that fits, and none for the rest', () => {
    for (const { id, spec: raw } of ENDGAMES) {
      const of = spec(raw);
      const drawn = drawCandidates(of, 12, rng(11));
      if (!drillable(of)) {
        expect(drawn, id).toEqual([]);
        continue;
      }
      expect(drawn.length, id).toBeGreaterThan(0);
      for (const fen of drawn) check(fen, of);
    }
  });

  it('is deterministic under a seed', () => {
    const queen = spec({ white: { q: [1, 1] }, black: { q: [1, 1] } });
    expect(drawCandidates(queen, 6, rng(5))).toEqual(drawCandidates(queen, 6, rng(5)));
  });
});
