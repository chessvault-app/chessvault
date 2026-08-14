import { describe, expect, it } from 'vitest';
import { tablebaseEligible, tbVerdict, type TbResult } from './tablebase.ts';

const result = (patch: Partial<TbResult>): TbResult => ({
  category: 'draw',
  dtz: null,
  dtm: null,
  checkmate: false,
  stalemate: false,
  insufficientMaterial: false,
  moves: [],
  ...patch,
});

describe('tablebaseEligible', () => {
  it('accepts 7 men or fewer without castling rights', () => {
    expect(tablebaseEligible('4k3/8/8/8/8/8/8/4KQ2 w - - 0 1')).toBe(true);
    expect(tablebaseEligible('4k3/pp6/8/8/8/8/PP6/4K3 w - - 0 1')).toBe(true);
  });

  it('refuses full boards and castling positions', () => {
    expect(tablebaseEligible('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(false);
    // Few men but castling still possible: Syzygy has no such entry.
    expect(tablebaseEligible('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1')).toBe(false);
  });
});

describe('tbVerdict', () => {
  it('names the winner from White POV, with mate distance in moves', () => {
    // dtm is plies; 15 plies with the winner to move = mate in 8.
    expect(tbVerdict(result({ category: 'win', dtm: 15 }), 'white')).toBe(
      'Tablebase: White wins, mate in 8',
    );
    expect(tbVerdict(result({ category: 'loss' }), 'white')).toBe('Tablebase: Black wins');
    expect(tbVerdict(result({ category: 'win' }), 'black')).toBe('Tablebase: Black wins');
  });

  it('reads cursed wins and blessed losses as 50-move draws', () => {
    expect(tbVerdict(result({ category: 'cursed-win' }), 'white')).toBe(
      'Tablebase: draw (50-move rule)',
    );
    expect(tbVerdict(result({ category: 'blessed-loss' }), 'black')).toBe(
      'Tablebase: draw (50-move rule)',
    );
  });

  it('stays quiet on unknowns and terminal positions', () => {
    expect(tbVerdict(result({ category: 'unknown' }), 'white')).toBeNull();
    expect(tbVerdict(result({ category: 'win', checkmate: true }), 'white')).toBeNull();
  });
});
