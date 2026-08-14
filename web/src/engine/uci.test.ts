import { describe, expect, it } from 'vitest';
import {
  formatScore,
  formatWdl,
  parseBestMove,
  parseInfo,
  toWhitePov,
  wdlToWhitePov,
  winningChances,
} from './uci.ts';

describe('parseInfo', () => {
  it('parses a full info line', () => {
    const line =
      'info depth 20 seldepth 28 multipv 1 score cp 34 nodes 1234567 nps 987654 time 1250 pv e2e4 e7e5 g1f3 b8c6';
    const info = parseInfo(line);
    expect(info).toBeDefined();
    expect(info!.depth).toBe(20);
    expect(info!.selDepth).toBe(28);
    expect(info!.multipv).toBe(1);
    expect(info!.cp).toBe(34);
    expect(info!.nodes).toBe(1234567);
    expect(info!.nps).toBe(987654);
    expect(info!.timeMs).toBe(1250);
    expect(info!.moves).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
  });

  it('parses a mate score, including negatives', () => {
    expect(parseInfo('info depth 12 score mate 3 pv d1h5 g7g6')!.mate).toBe(3);
    expect(parseInfo('info depth 12 score mate -2 pv h4h2')!.mate).toBe(-2);
  });

  it('flags bound scores so provisional evals can be ignored', () => {
    expect(parseInfo('info depth 18 score cp 120 lowerbound pv e2e4')!.bound).toBe('lower');
    expect(parseInfo('info depth 18 score cp -80 upperbound pv e2e4')!.bound).toBe('upper');
    expect(parseInfo('info depth 18 score cp 20 pv e2e4')!.bound).toBeUndefined();
  });

  it('defaults multipv to 1 when absent', () => {
    expect(parseInfo('info depth 5 score cp 10 pv e2e4')!.multipv).toBe(1);
  });

  it('ignores lines with no PV or no score', () => {
    // Progress chatter the engine emits while searching.
    expect(parseInfo('info depth 1 currmove e2e4 currmovenumber 1')).toBeUndefined();
    expect(parseInfo('info string NNUE evaluation using nn-9067e33176e')).toBeUndefined();
    expect(parseInfo('info depth 4 score cp 12')).toBeUndefined();
    expect(parseInfo('bestmove e2e4')).toBeUndefined();
    expect(parseInfo('')).toBeUndefined();
  });

  it('keeps the whole PV even when it contains promotions', () => {
    const info = parseInfo('info depth 30 score mate 1 multipv 2 pv a7a8q b8a8');
    expect(info!.moves).toEqual(['a7a8q', 'b8a8']);
    expect(info!.multipv).toBe(2);
  });

  it('parses wdl alongside the score', () => {
    const info = parseInfo(
      'info depth 20 seldepth 30 multipv 1 score cp 35 wdl 340 610 50 nodes 1000 nps 100 time 10 pv e2e4 e7e5',
    );
    expect(info!.wdl).toEqual([340, 610, 50]);
    expect(info!.cp).toBe(35);
    expect(info!.moves).toEqual(['e2e4', 'e7e5']);
    // And its absence stays absent, not [NaN, NaN, NaN].
    expect(parseInfo('info depth 5 score cp 10 pv e2e4')!.wdl).toBeUndefined();
  });
});

describe('parseBestMove', () => {
  it('reads the move', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
    expect(parseBestMove('bestmove a7a8q')).toBe('a7a8q');
  });

  it('returns undefined when there is no move', () => {
    // Emitted in a mated or stalemated position.
    expect(parseBestMove('bestmove (none)')).toBeUndefined();
    expect(parseBestMove('info depth 3')).toBeUndefined();
  });
});

describe('toWhitePov', () => {
  it('leaves White-to-move scores alone', () => {
    expect(toWhitePov({ cp: 50 }, 'white')).toEqual({ cp: 50 });
    expect(toWhitePov({ mate: 3 }, 'white')).toEqual({ mate: 3 });
  });

  it('flips Black-to-move scores', () => {
    // The engine says "+2 for me"; with Black to move that is -2 for White.
    expect(toWhitePov({ cp: 200 }, 'black')).toEqual({ cp: -200 });
    expect(toWhitePov({ mate: 2 }, 'black')).toEqual({ mate: -2 });
    expect(toWhitePov({ mate: -2 }, 'black')).toEqual({ mate: 2 });
  });
});

describe('wdl helpers', () => {
  it('swaps win and loss for Black to move', () => {
    expect(wdlToWhitePov([340, 610, 50], 'black')).toEqual([50, 610, 340]);
    expect(wdlToWhitePov([340, 610, 50], 'white')).toEqual([340, 610, 50]);
  });

  it('formats per mille as per cent', () => {
    expect(formatWdl([340, 610, 50])).toBe('34·61·5');
  });
});

describe('formatScore', () => {
  it('formats centipawns with a sign', () => {
    expect(formatScore({ cp: 124 })).toBe('+1.24');
    expect(formatScore({ cp: -35 })).toBe('-0.35');
    expect(formatScore({ cp: 0 })).toBe('+0.00');
  });

  it('formats mates', () => {
    expect(formatScore({ mate: 4 })).toBe('#4');
    expect(formatScore({ mate: -2 })).toBe('-#2');
  });

  it('handles a missing score', () => {
    expect(formatScore({})).toBe('—');
  });
});

describe('winningChances', () => {
  it('is even at 0.00', () => {
    expect(winningChances({ cp: 0 })).toBeCloseTo(0.5, 5);
  });

  it('is monotonic and bounded', () => {
    const points = [-2000, -500, -100, 0, 100, 500, 2000].map((cp) => winningChances({ cp }));
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!).toBeGreaterThan(points[i - 1]!);
    }
    for (const value of points) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('saturates on mate', () => {
    expect(winningChances({ mate: 1 })).toBe(1);
    expect(winningChances({ mate: -1 })).toBe(0);
  });

  it('compresses large advantages more than small ones', () => {
    // The point of the curve: +1 -> +2 should move the bar more than +8 -> +9.
    const small = winningChances({ cp: 200 }) - winningChances({ cp: 100 });
    const large = winningChances({ cp: 900 }) - winningChances({ cp: 800 });
    expect(small).toBeGreaterThan(large);
  });
});
