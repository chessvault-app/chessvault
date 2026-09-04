import { describe, expect, it } from 'vitest';
import { parseFen } from 'chessops/fen';
import { canonicalMotif, iqpSatisfied, motifIdOf, parseMotifSpec } from './scanMotif.ts';

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
    expect(parseMotifSpec('{"id":"greek-gift"}')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","side":"both"}')).toBeNull();
    expect(parseMotifSpec('{"id":"iqp","side":1}')).toBeNull();
    // Opposite castling is symmetric: a side on it is a request the
    // predicate cannot honour.
    expect(parseMotifSpec('{"id":"opposite-castling","side":"white"}')).toBeNull();
    expect(parseMotifSpec('{"id":"opposite-castling","side":"either"}')).not.toBeNull();
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
    expect(motifIdOf('{"id":"greek-gift"}')).toBe('greek-gift');
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
