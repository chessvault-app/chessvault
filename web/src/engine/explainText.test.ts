import { describe, expect, it } from 'vitest';
import { tagLine } from '@shared/explain';
import { motifChips } from './explainText.ts';
import { formatPv } from './pv.ts';

/**
 * The chips carry the ply the tactic lands on so the line can mark that
 * move. That only works while the tagger's ply and the rendered line's
 * index mean the same thing — these pin the two together, since nothing
 * else would notice one of them shifting by one.
 */
describe('motifChips plies', () => {
  it('points at the move the motif happens on', () => {
    // Qxe8 Rxe8 Rxe8#: the sacrifice is the first move, the back-rank
    // mate the third.
    const fen = '4rrk1/5ppp/8/4Q3/8/8/8/4R1K1 w - - 0 1';
    const moves = ['e5e8', 'f8e8', 'e1e8'];
    const chips = motifChips(tagLine(fen, moves));
    const plies = formatPv(fen, moves).plies;

    const mate = chips.find((c) => c.label === 'Back-rank mate');
    const sacrifice = chips.find((c) => c.label === 'Temporary sacrifice');
    expect(plies[mate!.ply]?.san).toBe('Rxe8#');
    expect(plies[sacrifice!.ply]?.san).toBe('Qxe8');
  });

  it('points at the forking move inside a longer line', () => {
    // Two quiet moves, then Nd5–c7 forking king and rook, then the cash
    // that proves the claim.
    const fen = 'r3k3/8/8/3N4/8/8/6P1/6K1 w - - 0 1';
    const moves = ['g2g3', 'e8f8', 'g1g2', 'f8e8', 'd5c7', 'e8d7', 'c7a8', 'd7c8'];
    const chips = motifChips(tagLine(fen, moves));
    const plies = formatPv(fen, moves).plies;

    expect(chips.map((c) => c.label)).toContain('Fork');
    expect(plies[chips[0]!.ply]?.san).toBe('Nc7+');
  });
});
