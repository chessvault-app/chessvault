/**
 * UCI info-line parsing.
 *
 * Kept free of DOM and worker concerns so it can be unit-tested directly — the
 * parsing is where the subtle bugs live, not the message plumbing.
 */

export interface PvLine {
  /** 1-based multipv index. */
  multipv: number;
  depth: number;
  selDepth?: number;
  /** Centipawns from the engine's point of view (side to move). */
  cp?: number;
  /** Mate in N from the engine's point of view. */
  mate?: number;
  /** Principal variation in UCI moves. */
  moves: string[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
  /** True when the score is a lower/upper bound rather than exact. */
  bound?: 'lower' | 'upper';
}

/**
 * Parse one `info` line. Returns undefined for lines without a PV or score,
 * such as the `info depth 1 currmove ...` progress chatter.
 */
export function parseInfo(line: string): PvLine | undefined {
  if (!line.startsWith('info ')) return undefined;

  const tokens = line.slice(5).split(/\s+/);
  const result: Partial<PvLine> & { moves: string[] } = { moves: [] };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token) {
      case 'depth':
        result.depth = Number(tokens[++i]);
        break;
      case 'seldepth':
        result.selDepth = Number(tokens[++i]);
        break;
      case 'multipv':
        result.multipv = Number(tokens[++i]);
        break;
      case 'nodes':
        result.nodes = Number(tokens[++i]);
        break;
      case 'nps':
        result.nps = Number(tokens[++i]);
        break;
      case 'time':
        result.timeMs = Number(tokens[++i]);
        break;
      case 'score': {
        const kind = tokens[++i];
        const value = Number(tokens[++i]);
        if (kind === 'cp') result.cp = value;
        else if (kind === 'mate') result.mate = value;
        // `lowerbound`/`upperbound` may follow the value.
        if (tokens[i + 1] === 'lowerbound') {
          result.bound = 'lower';
          i++;
        } else if (tokens[i + 1] === 'upperbound') {
          result.bound = 'upper';
          i++;
        }
        break;
      }
      case 'pv':
        // `pv` is always last: everything after it is the variation.
        result.moves = tokens.slice(i + 1).filter(Boolean);
        i = tokens.length;
        break;
      default:
        break;
    }
  }

  if (result.depth === undefined) return undefined;
  if (result.cp === undefined && result.mate === undefined) return undefined;
  if (result.moves.length === 0) return undefined;

  return {
    multipv: result.multipv ?? 1,
    depth: result.depth,
    ...(result.selDepth !== undefined ? { selDepth: result.selDepth } : {}),
    ...(result.cp !== undefined ? { cp: result.cp } : {}),
    ...(result.mate !== undefined ? { mate: result.mate } : {}),
    moves: result.moves,
    ...(result.nodes !== undefined ? { nodes: result.nodes } : {}),
    ...(result.nps !== undefined ? { nps: result.nps } : {}),
    ...(result.timeMs !== undefined ? { timeMs: result.timeMs } : {}),
    ...(result.bound ? { bound: result.bound } : {}),
  };
}

/** Extract the move from a `bestmove` line. */
export function parseBestMove(line: string): string | undefined {
  if (!line.startsWith('bestmove')) return undefined;
  const move = line.split(/\s+/)[1];
  return move && move !== '(none)' ? move : undefined;
}

/**
 * Convert an engine score to White's point of view.
 *
 * UCI reports relative to the side to move, but an evaluation bar and stored
 * annotations both need an absolute sign, or the same position would display
 * differently depending on whose turn it is.
 */
export function toWhitePov(
  score: { cp?: number; mate?: number },
  turn: 'white' | 'black',
): { cp?: number; mate?: number } {
  const sign = turn === 'white' ? 1 : -1;
  return {
    ...(score.cp !== undefined ? { cp: score.cp * sign } : {}),
    ...(score.mate !== undefined ? { mate: score.mate * sign } : {}),
  };
}

/** Human-readable score, e.g. `+1.24`, `-0.35`, `#4`, `-#2`. */
export function formatScore(score: { cp?: number; mate?: number }): string {
  if (score.mate !== undefined) {
    return `${score.mate < 0 ? '-' : ''}#${Math.abs(score.mate)}`;
  }
  if (score.cp === undefined) return '—';
  const pawns = score.cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

/**
 * Map a score to a 0..1 White-advantage fraction for the eval bar.
 *
 * Uses a logistic curve rather than a linear clamp: the difference between +1
 * and +2 matters far more to a human reader than between +8 and +9.
 */
export function winningChances(score: { cp?: number; mate?: number }): number {
  if (score.mate !== undefined) return score.mate > 0 ? 1 : 0;
  if (score.cp === undefined) return 0.5;
  // Same shape Lichess uses for its eval gauge.
  const MULTIPLIER = -0.00368208;
  const chances = 2 / (1 + Math.exp(MULTIPLIER * score.cp)) - 1;
  return (chances + 1) / 2;
}
