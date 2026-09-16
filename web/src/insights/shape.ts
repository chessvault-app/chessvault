/**
 * What this device's Insights page looked like last visit, so the outline
 * it draws while the report is fetched is this vault's outline rather
 * than a guess.
 *
 * Its own module because two components write it. The page writes
 * everything the report decides; CompareCard writes the one fact the
 * report cannot answer, which is whether that card stands at all — it
 * depends on `/api/refgames`, a request the page does not make. Kept in
 * InsightsPage, the card would have had to import the page that renders
 * it, and a cycle between two modules in one chunk is how a route came
 * to read `undefined` at module load once before (see the chunking note
 * in vite.config).
 *
 * Every write MERGES, because the two writers land in either order and
 * neither knows the other's fields.
 */

const SHAPE_KEY = 'vault:insights-shape';

export interface Shape {
  openings: number;
  book: number;
  summary: boolean;
  /** Whether the pass had judged anything, so the Move quality card and
      the Results footnote stood. */
  quality: boolean;
  /** Rows in Move quality's by-move-number table. */
  moveBands: number;
  /** Rows in the Results card's by-time-control table. */
  speeds: number;
  /** Rows in Activity's weekday table and in Game length's. */
  weekdays: number;
  lengths: number;
  /** The longest of the three ending legends. */
  endings: number;
  /**
   * Whether the Compare card stood.
   *
   * It draws nothing without a reference database to compare against
   * (CompareCard returns null on an empty list, and on the demo), and it
   * sits in the MIDDLE of the stack, between Leaving book and Activity —
   * so an outline that does not know about it pushes the three cards
   * below it down by its whole height when the report lands. False by
   * default: a device that has never seen this page reserves nothing
   * rather than reserving a card most vaults do not draw.
   */
  compare: boolean;
  /**
   * Whether the analysis pass had got anywhere, which is what decides
   * the filter row above the cards.
   *
   * That row rides the pass STATUS, a different request from the report,
   * so while the status is out the row is not drawn and the outline has
   * to know whether one is coming: a vault with nothing analysed settles
   * without it, and reserving it there would be the jump the other way.
   *
   * False covers BOTH the states that draw no row — this vault has
   * nothing analysed, and this device has not looked — so the field
   * needs no third value and the outline never guesses. A device with no
   * memory reserves nothing, which is the rule every other reservation
   * on this page and on home takes.
   */
  analysed: boolean;
  /**
   * The two figures in the Results card's footnote, so the sentence laid
   * out invisible to set that box is the length it will really be.
   *
   * The idiom handles language and width; it cannot handle digits. With
   * `000` standing in for both, a vault of 31 games reserved a line more
   * than it settled at (measured on the demo at 390: the footnote 76px
   * against 56). Zero means this device has not seen the page and the
   * stand-in digits are used.
   */
  games: number;
  accGames: number;
}

export const DEFAULT_SHAPE: Shape = {
  openings: 8,
  book: 4,
  summary: false,
  quality: true,
  moveBands: 6,
  speeds: 3,
  weekdays: 7,
  lengths: 6,
  endings: 4,
  compare: false,
  analysed: false,
  games: 0,
  accGames: 0,
};

/** The fold the openings table takes, which also caps what is stored. */
export const OPENING_FOLD = 20;

export function readShape(): Shape {
  try {
    const raw = localStorage.getItem(SHAPE_KEY);
    if (!raw) return DEFAULT_SHAPE;
    const p = JSON.parse(raw) as Partial<Shape>;
    return {
      openings: Math.min(OPENING_FOLD, Math.max(0, Number(p.openings) || 0)),
      book: Math.max(0, Number(p.book) || 0),
      summary: p.summary === true,
      quality: p.quality === true,
      moveBands: Math.max(0, Number(p.moveBands) || 0),
      speeds: Math.max(0, Number(p.speeds) || 0),
      weekdays: Math.max(0, Number(p.weekdays) || 0),
      lengths: Math.max(0, Number(p.lengths) || 0),
      endings: Math.max(0, Number(p.endings) || 0),
      compare: p.compare === true,
      // An absent field reads false, so a shape stored before this field
      // existed reserves nothing until the next visit records it.
      analysed: p.analysed === true,
      games: Math.max(0, Number(p.games) || 0),
      accGames: Math.max(0, Number(p.accGames) || 0),
    };
  } catch {
    return DEFAULT_SHAPE;
  }
}

/** Remember some of what this visit drew. Merges, never replaces. */
export function writeShape(patch: Partial<Shape>): void {
  try {
    localStorage.setItem(SHAPE_KEY, JSON.stringify({ ...readShape(), ...patch }));
  } catch {
    // Nothing to reserve next time; the default outline serves.
  }
}
