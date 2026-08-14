/**
 * Parser for Stockfish's NNUE `eval` trace.
 *
 * The trace is prose for humans — an ASCII board where every piece shows
 * what the network thinks it is worth (computed by removing the piece and
 * re-running the eval), then a bucket table and a "Final evaluation"
 * line. This reads the board back out of the prose. Values are White-POV
 * pawns; kings carry no value (removing a king is not a position).
 *
 * The fixture in evalTrace.test.ts is the verbatim output of the build
 * the app ships, so a stockfish upgrade that reshapes the trace fails a
 * test instead of silently blanking the heat map.
 */

export interface TracePiece {
  /** White-POV value in pawns. */
  value: number;
  /** FEN-style letter, case carrying the colour (N white, n black). */
  piece: string;
}

export interface EvalTrace {
  /** Square name → piece value; kings and empty squares absent. */
  pieces: Record<string, TracePiece>;
  /** "Final evaluation" in pawns, White POV; absent when in check. */
  finalPawns?: number;
}

const FILES = 'abcdefgh';

/**
 * Returns null when the lines contain no recognisable trace at all — the
 * mark of an engine built without `eval`. A trace with no piece grid
 * (e.g. side to move in check) still returns, with `pieces` empty.
 */
export function parseEvalTrace(lines: string[]): EvalTrace | null {
  const headerAt = lines.findIndex((l) => l.includes('NNUE derived piece values'));
  const finalLine = lines.find((l) => l.trimStart().startsWith('Final evaluation'));
  const anyTrace = headerAt >= 0 || finalLine !== undefined || lines.some((l) => l.includes('NNUE evaluation'));
  if (!anyTrace) return null;

  const pieces: Record<string, TracePiece> = {};

  if (headerAt >= 0) {
    // Collect the grid's cell rows: lines starting with `|`, in pairs —
    // first the piece letters, then the values. Top row is rank 8.
    const cellRows: string[][] = [];
    for (let i = headerAt + 1; i < lines.length && cellRows.length < 16; i++) {
      const line = lines[i]!.trim();
      if (line.startsWith('|')) {
        cellRows.push(line.split('|').slice(1, -1));
      } else if (!line.startsWith('+') && line !== '') {
        break; // the grid is over
      }
    }
    for (let pair = 0; pair * 2 + 1 < cellRows.length && pair < 8; pair++) {
      const letters = cellRows[pair * 2]!;
      const values = cellRows[pair * 2 + 1]!;
      const rank = 8 - pair;
      for (let file = 0; file < 8 && file < letters.length; file++) {
        const piece = letters[file]!.trim();
        const value = Number.parseFloat(values[file]?.trim() ?? '');
        if (/^[pnbrq]$/i.test(piece) && Number.isFinite(value)) {
          pieces[`${FILES[file]}${rank}`] = { value, piece };
        }
      }
    }
  }

  const final = finalLine?.match(/Final evaluation\s+([+-]?\d+(?:\.\d+)?)/);
  return {
    pieces,
    ...(final ? { finalPawns: Number.parseFloat(final[1]!) } : {}),
  };
}
