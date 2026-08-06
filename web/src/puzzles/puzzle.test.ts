import { describe, expect, it } from 'vitest';
import { judgeMove, positionAt, solutionSan, solverColor, type ApiPuzzle } from './puzzle';

// Real puzzle from the Lichess dump (id 00008): Black just has to take
// back, then deliver the fork. FEN is before White's setup move f3g3.
const p = (over: Partial<ApiPuzzle> = {}): ApiPuzzle => ({
  id: '00008',
  fen: 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24',
  moves: 'f2g3 e6e7 b2b1 b3c1 b1c1 h6c1',
  rating: 1939,
  popularity: 88,
  plays: 100,
  themes: 'crushing hangingPiece long middlegame',
  game_url: null,
  opening_tags: null,
  ...over,
});

describe('puzzle mechanics', () => {
  it('solver plays the side NOT to move in the raw FEN', () => {
    // FEN says black to move (the setup move is black's here).
    expect(solverColor(p())).toBe('white');
  });

  it('replays positions ply by ply', () => {
    const start = positionAt(p(), 0);
    expect(start.turn).toBe('black');
    expect(start.lastMove).toBeUndefined();

    const afterSetup = positionAt(p(), 1);
    expect(afterSetup.turn).toBe('white');
    expect(afterSetup.lastMove).toEqual(['f2', 'g3']);
    expect(afterSetup.dests.size).toBeGreaterThan(0);
  });

  it('accepts the scripted move and reports continuation', () => {
    expect(judgeMove(p(), 1, 'e6e7')).toBe('correct');
  });

  it('rejects an off-script non-mating move', () => {
    expect(judgeMove(p(), 1, 'e6e1')).toBe('wrong');
  });

  it('flags the last scripted move as complete', () => {
    expect(judgeMove(p(), 5, 'h6c1')).toBe('complete');
  });

  it('accepts an off-script checkmate as complete', () => {
    // Two rooks, two back-rank mates: the script says Ra8#, the solver
    // plays Rb8# instead — lichess accepts any mate, so do we.
    const mate: ApiPuzzle = p({
      fen: '7k/5ppp/8/8/8/8/RR6/6K1 w - - 0 1',
      moves: 'g1f1 h8g8 a2a8',
    });
    expect(judgeMove(mate, 2, 'a2a8')).toBe('complete'); // scripted
    expect(judgeMove(mate, 2, 'b2b8')).toBe('complete'); // off-script mate
    expect(judgeMove(mate, 2, 'a2a7')).toBe('wrong'); // off-script, no mate
  });

  it('renders solution SAN', () => {
    expect(solutionSan(p(), 1)).toBe('Rxe7');
  });
});
