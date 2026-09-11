import type { Speed } from '@shared/gameIndex';

/**
 * The insights page's arithmetic over the server's cells, kept apart from
 * the page so it can be tested in node.
 *
 * The server answers one cell per (colour, time control, opening) under
 * the filters, already summed. Everything the page shows is a regrouping
 * of those cells: by colour, by time control, by opening, and the book
 * exits by opening. Regrouping in the client rather than asking the
 * server four times keeps the four tables answering the same question
 * from the same numbers, and a filter change costs one request.
 */

/** One cell of /api/mygames/insights. See server/myGames.ts InsightsCell. */
export interface InsightsCell {
  side: 'white' | 'black';
  speed: Speed | 'unknown';
  eco: string | null;
  name: string | null;
  games: number;
  w: number;
  d: number;
  l: number;
  exits: number;
  exitPlySum: number;
  exitPlyMin: number | null;
  youLeft: number;
  theyLeft: number;
}

export interface Tally {
  games: number;
  w: number;
  d: number;
  l: number;
}

/** Wins plus half the draws, as a percentage of the games; null with none. */
export function scorePct(t: Tally): number | null {
  return t.games === 0 ? null : (100 * (t.w + t.d / 2)) / t.games;
}

const EMPTY: Tally = { games: 0, w: 0, d: 0, l: 0 };

function add(into: Tally, cell: Tally): Tally {
  return { games: into.games + cell.games, w: into.w + cell.w, d: into.d + cell.d, l: into.l + cell.l };
}

export function totals(cells: readonly InsightsCell[]): Tally {
  return cells.reduce<Tally>(add, EMPTY);
}

/** Cells summed by one of their keys, in descending games. */
export function tallyBy<K extends 'side' | 'speed'>(
  cells: readonly InsightsCell[],
  key: K,
): { key: InsightsCell[K]; tally: Tally }[] {
  const out = new Map<InsightsCell[K], Tally>();
  for (const cell of cells) out.set(cell[key], add(out.get(cell[key]) ?? EMPTY, cell));
  return [...out].map(([k, tally]) => ({ key: k, tally })).sort((a, b) => b.tally.games - a.tally.games);
}

export interface OpeningRow extends Tally {
  eco: string | null;
  name: string | null;
  /** Games whose indexed prefix left the catalogue. */
  exits: number;
  /** Mean ply of the leaving move over those games, or null with none. */
  meanExitPly: number | null;
  earliestExitPly: number | null;
  youLeft: number;
  theyLeft: number;
}

/**
 * Cells summed by opening across colour and time control, most played
 * first. Two openings are the same row when their ECO and name agree;
 * a game that reached no named position keeps its header ECO and a null
 * name, so those gather under the ECO alone.
 */
export function openingRows(cells: readonly InsightsCell[]): OpeningRow[] {
  const out = new Map<string, OpeningRow & { exitPlySum: number }>();
  for (const cell of cells) {
    const id = `${cell.eco ?? ''}\t${cell.name ?? ''}`;
    const row = out.get(id) ?? {
      eco: cell.eco,
      name: cell.name,
      games: 0,
      w: 0,
      d: 0,
      l: 0,
      exits: 0,
      exitPlySum: 0,
      meanExitPly: null,
      earliestExitPly: null,
      youLeft: 0,
      theyLeft: 0,
    };
    row.games += cell.games;
    row.w += cell.w;
    row.d += cell.d;
    row.l += cell.l;
    row.exits += cell.exits;
    row.exitPlySum += cell.exitPlySum;
    row.youLeft += cell.youLeft;
    row.theyLeft += cell.theyLeft;
    if (cell.exitPlyMin !== null) {
      row.earliestExitPly =
        row.earliestExitPly === null ? cell.exitPlyMin : Math.min(row.earliestExitPly, cell.exitPlyMin);
    }
    out.set(id, row);
  }
  return [...out.values()]
    .map(({ exitPlySum, ...row }) => ({
      ...row,
      meanExitPly: row.exits === 0 ? null : exitPlySum / row.exits,
    }))
    .sort((a, b) => b.games - a.games || (a.eco ?? '').localeCompare(b.eco ?? ''));
}

/**
 * The openings where the owner's own moves leave the catalogue soonest:
 * rows with at least one exit that was theirs, earliest mean first. A
 * single game is a thin basis, so rows with fewer than `min` exits are
 * dropped when there are enough rows to be choosy about; with fewer rows
 * than that, everything shows, which is what a small vault wants.
 */
export function earliestExits(rows: readonly OpeningRow[], min = 2): OpeningRow[] {
  const withExits = rows.filter((r) => r.exits > 0 && r.youLeft > 0);
  const chosen = withExits.length >= 8 ? withExits.filter((r) => r.exits >= min) : withExits;
  return [...chosen].sort(
    (a, b) => (a.meanExitPly ?? Infinity) - (b.meanExitPly ?? Infinity) || b.games - a.games,
  );
}

/** How the owner's exits split against the opponent's, over every row. */
export function exitSplit(cells: readonly InsightsCell[]): {
  exits: number;
  youLeft: number;
  meanPly: number | null;
} {
  let exits = 0;
  let you = 0;
  let sum = 0;
  for (const cell of cells) {
    exits += cell.exits;
    you += cell.youLeft;
    sum += cell.exitPlySum;
  }
  return { exits, youLeft: you, meanPly: exits === 0 ? null : sum / exits };
}

/** A ply as the move number it belongs to: ply 0 is move 1, ply 7 is
    move 4. Fractional for a mean, so "move 6.5" reads as between two. */
export function moveOfPly(ply: number): number {
  return ply / 2 + 1;
}
