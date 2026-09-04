import { describe, expect, it } from 'vitest';
import { parseFen } from 'chessops/fen';
import {
  MOTIF_IDS,
  MOTIF_KIND,
  boardMotifSatisfied,
  canonicalMotif,
  iqpSatisfied,
  motifIdOf,
  motifTakesSide,
  parseMotifSpec,
} from './scanMotif.ts';

const board = (fen: string) => {
  const setup = parseFen(fen);
  if (setup.isErr) throw new Error(`bad fen: ${fen}`);
  return setup.unwrap().board;
};

describe('parseMotifSpec', () => {
  it('accepts a spec and pins the defaults', () => {
    expect(parseMotifSpec('{"id":"iqp"}')).toEqual({ id: 'iqp', side: 'either', stable: 1 });
    expect(parseMotifSpec('{"id":"iqp","side":"black","stable":8}')).toEqual({
      id: 'iqp',
      side: 'black',
      stable: 8,
    });
    expect(parseMotifSpec('{"id":"opposite-castling"}')).toEqual({
      id: 'opposite-castling',
      side: 'either',
      stable: 1,
    });
  });

  it('refuses anything it would otherwise have to guess at', () => {
    // Not JSON, not an object, an unknown key: each would be a
    // constraint silently dropped.
    expect(parseMotifSpec('nonsense')).toBeNull();
    expect(parseMotifSpec('["iqp"]')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","colour":"white"}')).toBeNull();
    // An id nothing answers, a side nothing means.
    expect(parseMotifSpec('{}')).toBeNull();
    expect(parseMotifSpec('{"id":"rook-lift"}')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","side":"both"}')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","side":1}')).toBeNull();
    // The symmetric motifs take no side: a side on one is a request
    // the predicate cannot honour.
    expect(parseMotifSpec('{"id":"opposite-castling","side":"white"}')).toBeNull();
    expect(parseMotifSpec('{"id":"opposite-castling","side":"either"}')).not.toBeNull();
    expect(parseMotifSpec('{"id":"same-side-castling","side":"black"}')).toBeNull();
    expect(parseMotifSpec('{"id":"opposite-bishops","side":"white"}')).toBeNull();
    // Every other motif is somebody's.
    for (const id of MOTIF_IDS) {
      expect(parseMotifSpec(JSON.stringify({ id, side: 'white' })) !== null, id).toBe(
        motifTakesSide(id),
      );
      expect(MOTIF_KIND[id], id).toBeDefined();
    }
    // Stability: an integer in 1..60, the material spec's range.
    expect(parseMotifSpec('{"id":"iqp","stable":0}')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","stable":61}')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","stable":2.5}')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","stable":"8"}')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","stable":60}')).not.toBeNull();
  });
});

describe('canonicalMotif', () => {
  it('writes one fixed shape whatever order the request used', () => {
    const a = parseMotifSpec('{"stable":8,"side":"white","id":"iqp"}')!;
    const b = parseMotifSpec('{"id":"iqp","side":"white","stable":8}')!;
    expect(canonicalMotif(a)).toBe('{"id":"iqp","side":"white","stable":8}');
    expect(canonicalMotif(b)).toBe(canonicalMotif(a));
    // Defaults are written out: the binary parses a closed shape.
    expect(canonicalMotif(parseMotifSpec('{"id":"opposite-castling"}')!)).toBe(
      '{"id":"opposite-castling","side":"either","stable":1}',
    );
    // The canonical form parses back to itself.
    expect(parseMotifSpec(canonicalMotif(a))).toEqual(a);
  });
});

describe('motifIdOf', () => {
  it('reads the id tolerantly and never throws', () => {
    expect(motifIdOf('{"id":"iqp","stable":8}')).toBe('iqp');
    // An id this build does not know still names itself, so the
    // negotiation can route it away from a binary that lacks it.
    expect(motifIdOf('{"id":"rook-lift"}')).toBe('rook-lift');
    expect(motifIdOf(undefined)).toBeNull();
    expect(motifIdOf('nonsense')).toBeNull();
    expect(motifIdOf('[]')).toBeNull();
    expect(motifIdOf('{"id":7}')).toBeNull();
    expect(motifIdOf('{}')).toBeNull();
  });
});

describe('iqpSatisfied', () => {
  // The Tarrasch-shaped middlegame: white's lone d4 pawn, nothing on
  // c or e, and black's d-pawn gone — the textbook IQP.
  const WHITE_IQP = 'r1bq1rk1/pp2bppp/2n2n2/8/3P4/2N2N2/PP3PPP/R1BQ1RK1 w - - 0 1';
  const BLACK_IQP = 'r1bq1rk1/pp3ppp/2n2n2/3p4/8/2N2N2/PP3PPP/R1BQ1RK1 w - - 0 1';

  it('a lone d-pawn facing an open d-file, for the side asked', () => {
    expect(iqpSatisfied(board(WHITE_IQP), 'white')).toBe(true);
    expect(iqpSatisfied(board(WHITE_IQP), 'black')).toBe(false);
    expect(iqpSatisfied(board(WHITE_IQP), 'either')).toBe(true);
    // The mirror.
    expect(iqpSatisfied(board(BLACK_IQP), 'black')).toBe(true);
    expect(iqpSatisfied(board(BLACK_IQP), 'white')).toBe(false);
    expect(iqpSatisfied(board(BLACK_IQP), 'either')).toBe(true);
  });

  it('a neighbour on c or e, or two d-pawns, is not isolated', () => {
    // d4 with c3 beside it.
    expect(
      iqpSatisfied(board('r1bq1rk1/pp2bppp/2n2n2/8/3P4/2P2N2/P4PPP/R1BQ1RK1 w - - 0 1'), 'white'),
    ).toBe(false);
    // d4 with e3 beside it.
    expect(
      iqpSatisfied(board('r1bq1rk1/pp2bppp/2n2n2/8/3P4/4PN2/PP3PPP/R1BQ1RK1 w - - 0 1'), 'white'),
    ).toBe(false);
    // Doubled on the d-file: two pawns, not one.
    expect(
      iqpSatisfied(board('r1bq1rk1/pp2bppp/2n2n2/8/3P4/3P1N2/PP3PPP/R1BQ1RK1 w - - 0 1'), 'white'),
    ).toBe(false);
    // No d-pawn at all.
    expect(
      iqpSatisfied(board('r1bq1rk1/pp2bppp/2n2n2/8/8/2N2N2/PP3PPP/R1BQ1RK1 w - - 0 1'), 'white'),
    ).toBe(false);
  });

  it('an opposing d-pawn takes the isolani out of the definition', () => {
    // Symmetrical isolanis, d4 against d5: neither side's, by the
    // deliberate clause in the header.
    const pair = board('r1bq1rk1/pp3ppp/2n2n2/3p4/3P4/2N2N2/PP3PPP/R1BQ1RK1 w - - 0 1');
    expect(iqpSatisfied(pair, 'white')).toBe(false);
    expect(iqpSatisfied(pair, 'black')).toBe(false);
    expect(iqpSatisfied(pair, 'either')).toBe(false);
  });

  it('the start position and a pawnless board hold none', () => {
    expect(
      iqpSatisfied(board('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 'either'),
    ).toBe(false);
    expect(iqpSatisfied(board('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'either')).toBe(false);
  });
});

describe('board motifs', () => {
  const on = (fen: string, side: 'white' | 'black' | 'either' = 'either') =>
    MOTIF_IDS.filter((id) => boardMotifSatisfied(board(fen), id, side));

  it('doubled pawns: two on one file', () => {
    expect(on('4k3/8/8/8/3P4/3P4/8/4K3 w - - 0 1', 'white')).toContain('doubled-pawns');
    expect(on('4k3/8/8/8/3P4/2P5/8/4K3 w - - 0 1', 'either')).not.toContain('doubled-pawns');
    // Black's, not White's.
    expect(on('4k3/3p4/3p4/8/8/8/8/4K3 w - - 0 1', 'white')).not.toContain('doubled-pawns');
    expect(on('4k3/3p4/3p4/8/8/8/8/4K3 w - - 0 1', 'black')).toContain('doubled-pawns');
  });

  it('passed pawn: nothing ahead on its file or the neighbours', () => {
    expect(on('4k3/8/8/3P4/8/8/8/4K3 w - - 0 1', 'white')).toContain('passed-pawn');
    // Blocked on its file, or an enemy pawn on a neighbouring file ahead.
    expect(on('4k3/8/3p4/3P4/8/8/8/4K3 w - - 0 1', 'white')).not.toContain('passed-pawn');
    expect(on('4k3/4p3/8/3P4/8/8/8/4K3 w - - 0 1', 'white')).not.toContain('passed-pawn');
    // An enemy pawn BEHIND it does not count.
    expect(on('4k3/8/8/3P4/4p3/8/8/4K3 w - - 0 1', 'white')).toContain('passed-pawn');
    // And the black e4 pawn there has already passed the white d5 pawn,
    // so it is passed too; put a white pawn on d3, ahead of it, and it
    // is not.
    expect(on('4k3/8/8/3P4/4p3/8/8/4K3 w - - 0 1', 'black')).toContain('passed-pawn');
    expect(on('4k3/8/8/8/4p3/3P4/8/4K3 w - - 0 1', 'black')).not.toContain('passed-pawn');
  });

  it('rook on the seventh, from its own side', () => {
    expect(on('6k1/R7/8/8/8/8/8/6K1 w - - 0 1', 'white')).toContain('rook-on-seventh');
    expect(on('6k1/R7/8/8/8/8/8/6K1 w - - 0 1', 'black')).not.toContain('rook-on-seventh');
    expect(on('6k1/8/8/8/8/8/r7/6K1 w - - 0 1', 'black')).toContain('rook-on-seventh');
    expect(on('6k1/8/8/8/8/8/r7/6K1 w - - 0 1', 'white')).not.toContain('rook-on-seventh');
    // A black rook on White's seventh is not on ITS seventh.
    expect(on('6k1/r7/8/8/8/8/8/6K1 w - - 0 1', 'either')).not.toContain('rook-on-seventh');
  });

  it('fianchetto: the bishop with its pawn beside it', () => {
    expect(on('4k3/8/8/8/8/6P1/6B1/4K3 w - - 0 1', 'white')).toContain('fianchetto');
    expect(on('4k3/8/8/8/8/1P6/1B6/4K3 w - - 0 1', 'white')).toContain('fianchetto');
    expect(on('4k3/6b1/6p1/8/8/8/8/4K3 w - - 0 1', 'black')).toContain('fianchetto');
    // The bishop alone, or the pawn alone, is not the structure.
    expect(on('4k3/8/8/8/8/8/6B1/4K3 w - - 0 1', 'white')).not.toContain('fianchetto');
    expect(on('4k3/8/8/8/8/6P1/8/4K3 w - - 0 1', 'white')).not.toContain('fianchetto');
  });

  it('knight outpost: fifth or sixth rank, supported, beyond the reach of enemy pawns', () => {
    expect(on('4k3/8/8/3N4/2P5/8/8/4K3 w - - 0 1', 'white')).toContain('knight-outpost');
    expect(on('4k3/8/3N4/2P5/8/8/8/4K3 w - - 0 1', 'white')).toContain('knight-outpost');
    // An enemy pawn on a neighbouring file ahead could chase it.
    expect(on('4k3/2p5/8/3N4/2P5/8/8/4K3 w - - 0 1', 'white')).not.toContain('knight-outpost');
    // Unsupported, or not far enough forward.
    expect(on('4k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'white')).not.toContain('knight-outpost');
    expect(on('4k3/8/8/8/3N4/2P5/8/4K3 w - - 0 1', 'white')).not.toContain('knight-outpost');
    // Black's mirror: its fifth rank is rank 4, the pawn behind on rank 5.
    expect(on('4k3/8/8/2p5/3n4/8/8/4K3 w - - 0 1', 'black')).toContain('knight-outpost');
    // On rank 5 it is only Black's fourth: not an outpost yet.
    expect(on('4k3/8/2p5/3n4/8/8/8/4K3 w - - 0 1', 'black')).not.toContain('knight-outpost');
  });

  it('opposite-coloured bishops: one each, different colours, nothing else', () => {
    // c3 (dark) against d5 (light).
    expect(on('8/5k2/8/3b4/8/2B5/5K2/8 w - - 0 1')).toContain('opposite-bishops');
    expect(on('8/5k2/8/3b4/8/2B5/5K2/8 w - - 0 1', 'white')).toContain('opposite-bishops');
    // c3 against c5: both dark.
    expect(on('8/5k2/8/2b5/8/2B5/5K2/8 w - - 0 1')).not.toContain('opposite-bishops');
    // A rook still on the board makes it no bishop ending.
    expect(on('r7/5k2/8/3b4/8/2B5/5K2/8 w - - 0 1')).not.toContain('opposite-bishops');
    // Two bishops on one side is not "one each".
    expect(on('8/5k2/8/3b4/8/2B2B2/5K2/8 w - - 0 1')).not.toContain('opposite-bishops');
    // Pawns are allowed: it is the ending's shape.
    expect(on('8/5kp1/8/3b4/8/2B5/5KP1/8 w - - 0 1')).toContain('opposite-bishops');
  });

  it('the castling and move kinds are never a board fact', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(on(start)).toEqual([]);
    for (const id of MOTIF_IDS) {
      if (MOTIF_KIND[id] !== 'board') {
        expect(boardMotifSatisfied(board(start), id, 'either'), id).toBe(false);
      }
    }
  });
});
