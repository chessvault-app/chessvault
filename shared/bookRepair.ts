/**
 * Fix a misread board using the book's own solution as the checksum.
 *
 * The cell classifier is right about 99.4% of the time, which sounds like
 * plenty until you count: a board is 64 cells, so only ~0.994^64 ≈ 68% of
 * boards come out perfect. Nearly all the rest are wrong in ONE cell.
 *
 * A wrong cell is usually invisible — the position looks fine, it is just
 * not the position that was printed. What gives it away is the book's own
 * line: replay the printed solution and a board with a wrong cell almost
 * never lets it through. So the search is: put the classifier's runner-up
 * labels on the cells it was least sure about, and keep a repair only when
 * EXACTLY ONE resulting position replays the whole line.
 *
 * That uniqueness gate is the entire safety argument. Anything that admits
 * two positions is left alone, because "some position that works" is not
 * evidence — only "the one position that works" is.
 */

/** What the classifier thought of one cell, beyond its top choice. */
export interface CellCandidates {
  /** Probability per label index, in the classifier's label order. */
  probs: ArrayLike<number>;
  /** The label index it chose. */
  top: number;
  /**
   * Label indexes that won when the same cell was re-read under small
   * shifts, and how many of those reads agreed — see `alternates`.
   */
  votes: Map<number, number>;
}

/** A repair that replayed: the position, who moved, and the line. */
export interface Repair {
  placement: string;
  side: 'w' | 'b';
  sans: string[];
  /** How many cells had to change. Fewer is better evidence. */
  edits: number;
}

export interface RepairOutcome {
  /** The single position that replayed, if the search found exactly one. */
  repaired: Repair | null;
  /** Several replayed and no tie-break settled it — deliberately unused. */
  ambiguous: Repair[];
}

/**
 * Replay a candidate board. Returns the side that made the line work and
 * the moves it produced, or null if no side did.
 *
 * The caller supplies this because replaying needs the book's parsed
 * mainline and its learned figurine dialect, which belong to the solve.
 */
export type ReplayCandidate = (
  labels: string[],
) => { placement: string; side: 'w' | 'b'; sans: string[] } | null;

/** Cells whose shifted re-reads disagreed most, then whose margin is thinnest. */
function shakiest(cells: CellCandidates[], take: number): number[] {
  const margin = (i: number): number => {
    const sorted = Array.from(cells[i]!.probs).sort((a, b) => b - a);
    return (sorted[0] ?? 0) - (sorted[1] ?? 0);
  };
  const disagreement = (i: number): number =>
    [...cells[i]!.votes.values()].reduce((sum, v) => sum + v, 0);
  return [...cells.keys()]
    .sort((a, b) => disagreement(b) - disagreement(a) || margin(a) - margin(b))
    .slice(0, take);
}

/**
 * Labels worth trying on one cell, best first.
 *
 * A label that WON when the board was re-read a couple of pixels over
 * outranks one that merely scored second, because a cell the classifier is
 * genuinely wrong about tends to flip under a shift while its softmax
 * margin stays confident. There is no probability floor: the uniqueness
 * gate is what stops inventions, not a threshold here.
 */
function alternates(cell: CellCandidates, take: number): number[] {
  const voted = [...cell.votes.entries()].sort((a, b) => b[1] - a[1]).map(([index]) => index);
  const byProb = [...Array(cell.probs.length).keys()]
    .filter((index) => index !== cell.top && !voted.includes(index))
    .sort((a, b) => (cell.probs[b] ?? 0) - (cell.probs[a] ?? 0));
  return [...voted, ...byProb].slice(0, take);
}

export function repairBoard(
  cells: CellCandidates[],
  labelNames: string[],
  replay: ReplayCandidate,
): RepairOutcome {
  if (cells.length !== 64) return { repaired: null, ambiguous: [] };
  const base = cells.map((cell) => labelNames[cell.top] ?? '1');
  // Keyed by position, so two different edits that land on the same board
  // count once — they are the same claim about what the page showed.
  const wins = new Map<string, Repair & { cells: [number, number][] }>();

  const attempt = (edits: [number, number][]): void => {
    const labels = base.slice();
    for (const [at, label] of edits) labels[at] = labelNames[label] ?? '1';
    const got = replay(labels);
    if (got) {
      wins.set(got.placement, { ...got, edits: edits.length, cells: edits });
    }
  };

  // One cell, anywhere. The overwhelming majority of real misreads.
  for (let at = 0; at < 64; at++) {
    for (const label of alternates(cells[at]!, 3)) attempt([[at, label]]);
  }
  // Two, and then three, only among the cells the classifier was least
  // sure of, and only when nothing simpler worked. Widening either of
  // these is how a search starts inventing positions rather than finding
  // them: more edits means more chances for a wrong board to replay.
  if (wins.size === 0) {
    const pool = shakiest(cells, 20);
    for (let a = 0; a < pool.length; a++) {
      for (let b = a + 1; b < pool.length; b++) {
        for (const labelA of alternates(cells[pool[a]!]!, 2)) {
          for (const labelB of alternates(cells[pool[b]!]!, 2)) {
            attempt([
              [pool[a]!, labelA],
              [pool[b]!, labelB],
            ]);
          }
        }
      }
    }
  }
  if (wins.size === 0) {
    const pool = shakiest(cells, 12);
    for (let a = 0; a < pool.length; a++) {
      for (let b = a + 1; b < pool.length; b++) {
        for (let c = b + 1; c < pool.length; c++) {
          for (const labelA of alternates(cells[pool[a]!]!, 2)) {
            for (const labelB of alternates(cells[pool[b]!]!, 2)) {
              for (const labelC of alternates(cells[pool[c]!]!, 2)) {
                attempt([
                  [pool[a]!, labelA],
                  [pool[b]!, labelB],
                  [pool[c]!, labelC],
                ]);
              }
            }
          }
        }
      }
    }
  }

  const found = [...wins.values()];
  if (found.length === 1) return { repaired: found[0]!, ambiguous: [] };
  if (found.length === 0) return { repaired: null, ambiguous: [] };

  // Several positions replay the line. One more piece of evidence is
  // allowed to settle it: which repair the shifted re-reads actually
  // voted for. A clear single winner is accepted; a tie is not.
  const support = (win: { cells: [number, number][] }): number =>
    win.cells.reduce((sum, [at, label]) => sum + (cells[at]!.votes.get(label) ?? 0), 0);
  const ranked = [...found].sort((a, b) => support(b) - support(a));
  if (support(ranked[0]!) > 0 && support(ranked[0]!) > support(ranked[1]!)) {
    return { repaired: ranked[0]!, ambiguous: [] };
  }
  return { repaired: null, ambiguous: ranked.slice(0, 4) };
}
