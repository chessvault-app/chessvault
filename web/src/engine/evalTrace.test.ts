import { describe, expect, it } from 'vitest';
import { parseEvalTrace } from './evalTrace.ts';

/**
 * Verbatim output of the shipped stockfish-18-lite build for
 * r1bq1rk1/pp2ppbp/2np1np1/8/2PNP3/2N1B3/PP2BPPP/R2Q1RK1 w - - 0 9,
 * captured by running the engine under Node. If an engine upgrade
 * reshapes the trace, this fails instead of the heat map silently
 * blanking.
 */
const TRACE = `
 NNUE derived piece values:
+-------+-------+-------+-------+-------+-------+-------+-------+
|   r   |       |   b   |   q   |       |   r   |   k   |       |
| -4.42 |       | -3.96 | -5.82 |       | -4.49 |       |       |
+-------+-------+-------+-------+-------+-------+-------+-------+
|   p   |   p   |       |       |   p   |   p   |   b   |   p   |
| -0.62 | -0.80 |       |       | -1.11 | -1.12 | -4.85 | -0.86 |
+-------+-------+-------+-------+-------+-------+-------+-------+
|       |       |   n   |   p   |       |   n   |   p   |       |
|       |       | -4.59 | -0.56 |       | -3.72 | -1.42 |       |
+-------+-------+-------+-------+-------+-------+-------+-------+
|       |       |       |       |       |       |       |       |
|       |       |       |       |       |       |       |       |
+-------+-------+-------+-------+-------+-------+-------+-------+
|       |       |   P   |   N   |   P   |       |       |       |
|       |       | +0.88 | +3.47 | +1.06 |       |       |       |
+-------+-------+-------+-------+-------+-------+-------+-------+
|       |       |   N   |       |   B   |       |       |       |
|       |       | +3.79 |       | +4.24 |       |       |       |
+-------+-------+-------+-------+-------+-------+-------+-------+
|   P   |   P   |       |       |   B   |   P   |   P   |   P   |
| +0.60 | +0.96 |       |       | +3.71 | +1.26 | +1.61 | +0.92 |
+-------+-------+-------+-------+-------+-------+-------+-------+
|   R   |       |       |   Q   |       |   R   |   K   |       |
| +3.86 |       |       | +5.10 |       | +3.90 |       |       |
+-------+-------+-------+-------+-------+-------+-------+-------+

 NNUE network contributions (White to move)
+------------+------------+------------+------------+
|   Bucket   |  Material  | Positional |   Total    |
+------------+------------+------------+------------+
|  7         |  +  0.41   |  +  0.01   |  +  0.42   | <-- this bucket is used
+------------+------------+------------+------------+

NNUE evaluation        +0.42 (white side)
Final evaluation       +0.53 (white side) [with scaled NNUE, ...]
`.split('\n');

describe('parseEvalTrace', () => {
  it('reads the piece grid with squares, signs and colours', () => {
    const trace = parseEvalTrace(TRACE);
    expect(trace).not.toBeNull();
    // Black's fianchetto bishop carries the position; White's d4 knight too.
    expect(trace!.pieces['g7']).toEqual({ value: -4.85, piece: 'b' });
    expect(trace!.pieces['d4']).toEqual({ value: 3.47, piece: 'N' });
    expect(trace!.pieces['a8']).toEqual({ value: -4.42, piece: 'r' });
    expect(trace!.pieces['d1']).toEqual({ value: 5.1, piece: 'Q' });
    // Kings carry no value and must not appear: 30 men, 2 kings, 28 rows.
    expect(trace!.pieces['g8']).toBeUndefined();
    expect(trace!.pieces['g1']).toBeUndefined();
    expect(Object.keys(trace!.pieces)).toHaveLength(28);
  });

  it('reads the final evaluation', () => {
    expect(parseEvalTrace(TRACE)!.finalPawns).toBe(0.53);
  });

  it('returns null when the engine printed no trace at all', () => {
    expect(parseEvalTrace([])).toBeNull();
    expect(parseEvalTrace(['info string something else'])).toBeNull();
  });

  it('keeps an empty grid distinct from an unsupported engine', () => {
    // In check the grid may be absent while the trace itself exists.
    const trace = parseEvalTrace(['Final evaluation: none (in check)']);
    expect(trace).not.toBeNull();
    expect(trace!.pieces).toEqual({});
    expect(trace!.finalPawns).toBeUndefined();
  });
});
