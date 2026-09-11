import { describe, expect, it } from 'vitest';
import {
  bandRows,
  earliestExits,
  endingShares,
  exitSplit,
  familyOf,
  monthSeries,
  moveOfPly,
  openingRows,
  scorePct,
  tallyBy,
  totals,
  type InsightsCell,
} from './aggregate';

const cell = (o: Partial<InsightsCell>): InsightsCell => ({
  side: 'white',
  speed: 'blitz',
  eco: 'C50',
  name: 'Italian Game',
  games: 0,
  w: 0,
  d: 0,
  l: 0,
  exits: 0,
  exitPlySum: 0,
  exitPlyMin: null,
  youLeft: 0,
  theyLeft: 0,
  accSum: 0,
  accN: 0,
  ...o,
});

/** The Italian twice (once per colour), a Sicilian in rapid, an unnamed
    D00, in the shape the server hands over. */
const CELLS: InsightsCell[] = [
  cell({ games: 4, w: 2, d: 1, l: 1, exits: 3, exitPlySum: 6 + 8 + 10, exitPlyMin: 6, youLeft: 2, theyLeft: 1 }),
  cell({ side: 'black', games: 2, w: 1, l: 1, exits: 2, exitPlySum: 7 + 9, exitPlyMin: 7, youLeft: 1, theyLeft: 1 }),
  cell({ speed: 'rapid', eco: 'B90', name: 'Sicilian Defense: Najdorf', games: 3, w: 1, d: 2, exits: 1, exitPlySum: 14, exitPlyMin: 14, theyLeft: 1 }),
  cell({ eco: 'B22', name: 'Sicilian Defense: Alapin Variation', games: 2, w: 2, accSum: 170, accN: 2 }),
  cell({ speed: 'unknown', eco: 'D00', name: null, games: 1, l: 1 }),
];

describe('insights arithmetic', () => {
  it('scores wins plus half the draws', () => {
    expect(scorePct({ games: 4, w: 2, d: 1, l: 1, accSum: 0, accN: 0 })).toBe(62.5);
    expect(scorePct({ games: 0, w: 0, d: 0, l: 0, accSum: 0, accN: 0 })).toBeNull();
  });

  it('sums every cell, and by colour and time control', () => {
    expect(totals(CELLS)).toEqual({ games: 12, w: 6, d: 3, l: 3, accSum: 170, accN: 2 });
    expect(tallyBy(CELLS, 'side')).toEqual([
      { key: 'white', tally: { games: 10, w: 5, d: 3, l: 2, accSum: 170, accN: 2 } },
      { key: 'black', tally: { games: 2, w: 1, d: 0, l: 1, accSum: 0, accN: 0 } },
    ]);
    expect(tallyBy(CELLS, 'speed').map((r) => r.key)).toEqual(['blitz', 'rapid', 'unknown']);
  });

  it('names the family a catalogue line belongs to', () => {
    expect(familyOf('Sicilian Defense: Najdorf Variation, English Attack')).toBe('Sicilian Defense');
    expect(familyOf("King's Gambit")).toBe("King's Gambit");
  });

  it('gathers a family across colours and lines, and keeps the earliest exit', () => {
    const rows = openingRows(CELLS);
    expect(rows.map((r) => r.name)).toEqual(['Italian Game', 'Sicilian Defense', null]);
    // One line, its code; two Sicilian lines, the range they span; the
    // nameless row keeps its header ECO.
    expect(rows.map((r) => r.eco)).toEqual(['C50', 'B22\u2013B90', 'D00']);
    expect(rows[1]!.games).toBe(5);
    // Accuracy averages over the analysed games alone.
    expect(rows[1]!.accuracy).toBe(85);
    expect(rows[0]!.accuracy).toBeNull();
    const italian = rows[0]!;
    expect(italian.games).toBe(6);
    expect(italian.exits).toBe(5);
    expect(italian.meanExitPly).toBe(8);
    expect(italian.earliestExitPly).toBe(6);
    expect([italian.youLeft, italian.theyLeft]).toEqual([3, 2]);
    // Never left book in the index, so no mean to report.
    expect(rows[2]!.meanExitPly).toBeNull();
  });

  it('ranks where my own moves leave the catalogue soonest', () => {
    const rows = earliestExits(openingRows(CELLS));
    // The Najdorf's only exit was the opponent's; the unnamed row never left.
    expect(rows.map((r) => r.name)).toEqual(['Italian Game']);
  });

  it('drops one-game rows only when there are enough rows to spare', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      cell({ eco: `A0${i}`, name: `Line ${i}`, games: 1, w: 1, exits: 1, exitPlySum: i, exitPlyMin: i, youLeft: 1 }),
    );
    const solid = cell({ eco: 'B20', name: 'Solid', games: 5, w: 5, exits: 4, exitPlySum: 40, exitPlyMin: 8, youLeft: 4 });
    expect(earliestExits(openingRows([...many, solid])).map((r) => r.name)).toEqual(['Solid']);
    expect(earliestExits(openingRows(many.slice(0, 3))).length).toBe(3);
  });

  it('splits the exits between me and them', () => {
    expect(exitSplit(CELLS)).toEqual({ exits: 6, youLeft: 3, meanPly: 9 });
    expect(exitSplit([])).toEqual({ exits: 0, youLeft: 0, meanPly: null });
  });

  it('fills the empty months between the first and the last', () => {
    const series = monthSeries([
      { month: '2025-11', w: 1, d: 0, l: 0 },
      { month: '2026-02', w: 0, d: 0, l: 2 },
    ]);
    expect(series.map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(series.map((m) => m.games)).toEqual([1, 0, 0, 2]);
    expect(monthSeries([])).toEqual([]);
    // Capped to the most recent months.
    expect(monthSeries([{ month: '2020-01' }, { month: '2026-01' }], 12).length).toBe(12);
  });

  it('shares each outcome out among its endings', () => {
    const shares = endingShares(
      [
        { ending: 'mate', w: 3, d: 0, l: 1 },
        { ending: 'resignation', w: 1, d: 0, l: 0 },
        { ending: 'agreement', w: 0, d: 2, l: 0 },
      ],
      'w',
    );
    expect(shares.map((s) => [s.ending, s.games, s.share])).toEqual([
      ['mate', 3, 75],
      ['resignation', 1, 25],
    ]);
    expect(endingShares([], 'd')).toEqual([]);
  });

  it('turns a band list into tally rows', () => {
    expect(bandRows([{ band: 1600, w: 1, l: 1 }])).toEqual([
      { band: 1600, tally: { games: 2, w: 1, d: 0, l: 1, accSum: 0, accN: 0 } },
    ]);
  });

  it('turns a ply into its move number', () => {
    expect(moveOfPly(0)).toBe(1);
    expect(moveOfPly(6)).toBe(4);
    expect(moveOfPly(7)).toBe(4.5);
  });
});
