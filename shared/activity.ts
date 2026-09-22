/**
 * What a vault counts as a day's work, and the words the two sides use
 * for it.
 *
 * Shared because the server tallies and the browser draws, and the one
 * thing that must never drift between them is the list of kinds: a kind
 * the server writes and the page has never heard of is a day of work
 * that quietly does not count, and there is no error for that.
 *
 * WHY A LOG AT ALL. Two of these kinds were already recorded, each in
 * its own append-only history, and the home page's grid was drawn from
 * one of them - so it said "activity" and meant the puzzle trainer. The
 * other four had nowhere to be recorded. A document's file carries one
 * mtime, which is its LAST touch: a study edited every day for a month
 * is one date, and no grid can be built out of that without claiming
 * twenty-nine idle days that were not idle.
 *
 * The vault's own safety net (server/vaultBackup.ts) does hold the
 * missing days, since it has auto-committed every change since the first
 * release - but it coalesces fifteen seconds of them into one commit, so
 * it can say a day happened and never how much of it did, and it is a
 * git repo, which the in-page demo has no way to run. So: a log.
 */

/**
 * The kinds of thing a day can hold.
 *
 * Deliberately six and deliberately coarse. Every one of them is a thing
 * a person would say they did ("I did some puzzles", "I wrote up a
 * game"), which is the test for adding a seventh - not whether the app
 * has a seventh route that writes something.
 *
 * `puzzle` covers both trainers' puzzles, the Lichess pool's and a
 * book's, because a puzzle solved is a puzzle solved and which shelf it
 * came off is the puzzle pages' business, not this one's. `drill` is the
 * repertoire drill. The endgame drill is deliberately absent and records
 * nothing at all (server/endgameDrill.ts says why); if that is ever
 * reversed, it arrives here as its own kind rather than inside `drill`.
 */
export const ACTIVITY_KINDS = ['puzzle', 'drill', 'study', 'note', 'game', 'book'] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const KINDS = new Set<string>(ACTIVITY_KINDS);

export const isActivityKind = (value: unknown): value is ActivityKind =>
  typeof value === 'string' && KINDS.has(value);

/**
 * One line of the log.
 *
 * `n` is HOW MANY THINGS THE EVENT MOVED, and it is for the words only:
 * collecting a season of games off Lichess is `{ kind: 'game', n: 412 }`,
 * and the day's tip can then say 412 rather than 1. It is not what the
 * square's colour counts. The colour counts EVENTS, because the question
 * a grid of days answers is what you did, and importing an archive is
 * one thing you did however much it moved; counting the 412 would paint
 * the darkest square this grid has for a single press of a button, next
 * to a day of real work drawn paler.
 *
 * Absent means one, which is what every hand-sized event writes.
 */
export interface ActivityEvent {
  /** ISO 8601, stamped by the server at the moment it happened. */
  at: string;
  kind: ActivityKind;
  /**
   * WHICH thing, where the event is about one: a document's id, a book's
   * slug. It is there so a thing counts ONCE A DAY however often it is
   * saved.
   *
   * Saving is manual in this app, so twelve saves are twelve deliberate
   * presses - but they are one afternoon on one study, and a square that
   * called them twelve days' worth of work would read as a heavier day
   * than one spent solving twelve puzzles. What a day of documents holds
   * is how many documents it touched.
   *
   * An event with no id is one that has no such thing to be: bringing in
   * a season of games is an event, not a document, and two imports in a
   * day are two things done.
   */
  id?: string;
  n?: number;
}

/** A day's work, tallied: events per kind, plus what `n` added up to. */
export interface ActivityDayTally {
  /** The local calendar day the server counted it into, `YYYY-MM-DD`. */
  date: string;
  /** Events per kind. Absent kinds did not happen; a kind is never 0. */
  counts: Partial<Record<ActivityKind, number>>;
  /**
   * What those events moved, per kind, where it differs from `counts` -
   * the 412 above. Only the kinds whose total is larger than their event
   * count appear, so a day of ordinary work carries nothing here at all.
   */
  moved?: Partial<Record<ActivityKind, number>>;
}

/** The answer `/api/activity` gives. */
export interface ActivityReport {
  /** Oldest first, and only days that hold something.
   *
   * There is no cap and no tail. All three sources are append-only and
   * nothing prunes them, so a day missing from this list is a day that
   * held nothing, not a day nobody looked far enough back to see. The
   * grid used to draw a hollow "unknown" square for the second case,
   * which only existed because it asked for 500 attempts and got 500;
   * reading the files here instead retired both the cap and the state.
   */
  days: ActivityDayTally[];
  /**
   * The first day the LOG covers - the day this version first ran on this
   * vault, or today where it has recorded nothing yet.
   *
   * Days before it are real days holding real trainer counts, and what
   * they cannot hold is the studies, notes, games and books nothing was
   * writing down yet. The card says so once, for as long as one of them
   * is still in view, because a grid that quietly understated a month is
   * worse than one that says which month.
   */
  logSince: string;
}

/** Events in a day's tally, over every kind. */
export const dayTotal = (day: ActivityDayTally): number => {
  let total = 0;
  for (const kind of ACTIVITY_KINDS) total += day.counts[kind] ?? 0;
  return total;
};
