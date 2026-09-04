import { describe, expect, it } from 'vitest';
import { parseFen } from 'chessops/fen';
import {
  canonicalMaterial,
  isSymmetricMaterial,
  matchSignature,
  materialMenBounds,
  materialSatisfied,
  mirrorMaterialSpec,
  parseMaterialSpec,
} from './scanMatch.ts';

const board = (fen: string) => {
  const setup = parseFen(fen);
  if (setup.isErr) throw new Error(`bad fen: ${fen}`);
  return setup.unwrap().board;
};

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('matchSignature', () => {
  it('pins the literal formats the Rust twin must emit', () => {
    // The strings themselves are the contract — a byte of drift here is
    // a scan that agrees with nobody.
    expect(matchSignature(board(START), 'material')).toBe('m:8,2,2,2,1-8,2,2,2,1');
    expect(matchSignature(board(START), 'pawns')).toBe(
      'p:8,2,2,2,1-8,2,2,2,1:8.9.10.11.12.13.14.15/48.49.50.51.52.53.54.55',
    );
    expect(matchSignature(board(START), 'files')).toBe(
      'f:8,2,2,2,1-8,2,2,2,1:11111111/11111111',
    );
  });

  it('material ignores placement, pawns does not', () => {
    // Same men, knights developed: material and files agree with the
    // start, pawns agrees too (no pawn moved) — then a pawn push splits
    // pawns from files, and a capture splits everything.
    const developed = board('r1bqkbnr/pppppppp/2n5/8/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 4 3');
    expect(matchSignature(developed, 'material')).toBe(matchSignature(board(START), 'material'));
    expect(matchSignature(developed, 'pawns')).toBe(matchSignature(board(START), 'pawns'));

    const pushed = board('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(matchSignature(pushed, 'material')).toBe(matchSignature(board(START), 'material'));
    expect(matchSignature(pushed, 'pawns')).not.toBe(matchSignature(board(START), 'pawns'));
    // e2→e4 stays on the e-file, so the files rung still matches.
    expect(matchSignature(pushed, 'files')).toBe(matchSignature(board(START), 'files'));
  });

  it('files counts doubled pawns per file', () => {
    // After exd5 white has two d-pawns and no e-pawn.
    const doubled = board('rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2');
    expect(matchSignature(doubled, 'files')).toBe('f:8,2,2,2,1-7,2,2,2,1:11120111/11101111');
  });
});

describe('parseMaterialSpec', () => {
  it('accepts a spec and normalises its shape', () => {
    const spec = parseMaterialSpec('{"white":{"r":[1,1]},"black":{"r":[1,1]},"stable":4}');
    expect(spec).toEqual({ white: { r: [1, 1] }, black: { r: [1, 1] }, diff: {}, stable: 4 });
  });

  it('defaults stability to one ply', () => {
    expect(parseMaterialSpec('{"diff":{"q":[1,10]}}')?.stable).toBe(1);
  });

  it('rejects everything that is not exactly a spec', () => {
    for (const bad of [
      'not json',
      '[]',
      '"rooks"',
      '{}', // constrains nothing — a whole-database dump by accident
      '{"stable":5}', // likewise
      '{"white":{"k":[1,1]}}', // kings are not a constraint
      '{"white":{"r":[2,1]}}', // min above max
      '{"white":{"r":[1]}}',
      '{"white":{"r":[0,11]}}',
      '{"white":{"r":[0,1.5]}}',
      '{"diff":{"minor":[-11,0]}}',
      '{"white":{"r":[1,1]},"colour":"white"}', // unknown key
      '{"white":{"r":[1,1]},"stable":0}',
      '{"white":{"r":[1,1]},"stable":61}',
      '{"white":{"r":[1,1]},"stable":2.5}',
    ]) {
      expect(parseMaterialSpec(bad), bad).toBeNull();
    }
  });

  it('canonicalises in a fixed key order, every field present', () => {
    const spec = parseMaterialSpec('{"stable":2,"diff":{"major":[0,0],"p":[-2,2]},"white":{"q":[0,0],"n":[1,2]}}')!;
    expect(canonicalMaterial(spec)).toBe(
      '{"white":{"n":[1,2],"q":[0,0]},"black":{},"diff":{"p":[-2,2],"major":[0,0]},"stable":2}',
    );
  });
});

describe('materialSatisfied', () => {
  // K+R vs K+R with three pawns each side.
  const ROOK_ENDING = '8/1k3ppp/8/8/8/8/1K3PPP/R6r w - - 0 1';

  it('answers per-side ranges', () => {
    const rooks = parseMaterialSpec(
      '{"white":{"r":[1,1],"n":[0,0],"b":[0,0],"q":[0,0]},"black":{"r":[1,1],"n":[0,0],"b":[0,0],"q":[0,0]}}',
    )!;
    expect(materialSatisfied(board(ROOK_ENDING), rooks)).toBe(true);
    expect(materialSatisfied(board(START), rooks)).toBe(false);
  });

  it('answers differences, aggregates included', () => {
    // White is a whole queen up.
    const up = board('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
    expect(materialSatisfied(up, parseMaterialSpec('{"diff":{"q":[1,10]}}')!)).toBe(true);
    expect(materialSatisfied(up, parseMaterialSpec('{"diff":{"minor":[1,10]}}')!)).toBe(false);
    // Two minors vs a rook: minor diff +2, major diff -1.
    const imbalance = board('4k3/8/8/8/8/8/8/1NB1K2r w - - 0 1');
    expect(
      materialSatisfied(imbalance, parseMaterialSpec('{"diff":{"minor":[2,2],"major":[-1,-1]}}')!),
    ).toBe(true);
  });
});

describe('materialMenBounds', () => {
  it('derives the prefilter bounds, king included', () => {
    const rooks = parseMaterialSpec(
      '{"white":{"p":[0,3],"r":[1,1],"n":[0,0],"b":[0,0],"q":[0,0]},"black":{"r":[1,2]}}',
    )!;
    expect(materialMenBounds(rooks)).toEqual({
      loW: 2, // king + the one rook
      hiW: 5, // king + 3 pawns + the rook
      loB: 2, // king + one rook
      hiB: 16, // everything else unconstrained — capped at the board
    });
  });
});

describe('mirrorMaterialSpec', () => {
  it('swaps the sides and flips every difference', () => {
    expect(mirrorMaterialSpec({ diff: { q: [1, 9] } })).toEqual({ diff: { q: [-9, -1] } });
    expect(
      mirrorMaterialSpec({
        white: { r: [1, 1], p: [1, 8] },
        black: { r: [1, 1], p: [0, 0] },
        diff: { major: [1, 10], minor: [-10, -1] },
        stable: 4,
      }),
    ).toEqual({
      white: { r: [1, 1], p: [0, 0] },
      black: { r: [1, 1], p: [1, 8] },
      diff: { major: [-10, -1], minor: [1, 10] },
      stable: 4,
    });
    // A missing block stays missing rather than becoming an empty one.
    expect(mirrorMaterialSpec({ white: { q: [0, 0] } })).toEqual({ black: { q: [0, 0] } });
  });

  it('is its own inverse, and the mirror satisfies the mirrored board', () => {
    const spec = { white: { b: [2, 2], n: [0, 0] }, black: { b: [1, 1], n: [1, 1] }, diff: { p: [1, 3] } };
    expect(mirrorMaterialSpec(mirrorMaterialSpec(spec))).toEqual(spec);
    // White's bishop pair and a pawn up: true as written, true for
    // Black through the mirror on the colours-swapped board.
    const pair = board('2b1k1n1/pppp4/8/8/8/8/PPPPP3/2BBK3 w - - 0 1');
    const swapped = board('2bbk3/ppppp3/8/8/8/8/PPPP4/2B1K1N1 w - - 0 1');
    expect(materialSatisfied(pair, parseMaterialSpec(JSON.stringify(spec))!)).toBe(true);
    expect(materialSatisfied(swapped, parseMaterialSpec(JSON.stringify(spec))!)).toBe(false);
    expect(materialSatisfied(swapped, parseMaterialSpec(JSON.stringify(mirrorMaterialSpec(spec)))!)).toBe(true);
  });

  it('tells a symmetric situation from an imbalance', () => {
    expect(isSymmetricMaterial({ white: { q: [0, 0] }, black: { q: [0, 0] } })).toBe(true);
    expect(isSymmetricMaterial({ diff: { minor: [-1, 1], major: [-1, 1] } })).toBe(true);
    expect(isSymmetricMaterial({ diff: { q: [1, 9] } })).toBe(false);
    expect(isSymmetricMaterial({ white: { r: [1, 1] }, black: { q: [1, 1] } })).toBe(false);
    // A spec that does not parse is nobody's symmetric.
    expect(isSymmetricMaterial({})).toBe(false);
  });
});
