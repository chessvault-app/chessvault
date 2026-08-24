/**
 * When a fumbled puzzle comes back: the review ladder, and the cycle
 * window the book trainer's repetition passes are measured in.
 *
 * Both trainers already remember what was missed — the lichess trainer's
 * failed pool and a book's progress file both keep "latest attempt lost" —
 * but neither knew about TIME: a failed puzzle sat reviewable for ever,
 * and a puzzle scraped through once was done for good. The ladder adds the
 * third state, "solved, but due again later", and it is shared because the
 * server (pool counts, the next-due queue) and the client (a book's due
 * list, the cycle grid) must agree on the arithmetic to the millisecond.
 *
 * A LADDER, not SM-2. Anki-style ease factors are tuned for facts and
 * graded by the solver's own "hard/good/easy", which is a verdict this app
 * does not ask for. Tactics give an objective signal — solved cleanly or
 * not — so the schedule is a fixed ladder keyed to consecutive clean
 * solves since the last fail, with nothing to configure and nothing to
 * explain: fail → due in a day, then 3, 7 and 21 days out, and after a
 * clean solve at every step the puzzle graduates out of rotation.
 *
 * Timestamps are ISO-8601 in UTC throughout the vault, so string order is
 * time order and callers compare due dates with `<=`.
 */

/** One recorded attempt, as both trainers' histories already store it.
    `at` is optional because lichess history lines predate the field;
    an undated attempt is treated as infinitely old — due immediately —
    which is exactly what the old failed pool did with it. */
export interface ReviewAttempt {
  win: boolean;
  at?: string;
}

/** Days until the next look, indexed by clean solves since the last fail. */
export const REVIEW_LADDER_DAYS = [1, 3, 7, 21] as const;

const DAY_MS = 86_400_000;

/** The epoch, the "due immediately" answer for attempts with no date. */
const ALWAYS_DUE = new Date(0).toISOString();

/**
 * When this puzzle is next due, from its attempts in the order they
 * happened. `null` means it is not in rotation at all: never failed
 * (repetition is for what was fumbled, not for everything ever solved),
 * or graduated — a clean solve at every step of the ladder.
 */
export function reviewDueAt(attempts: readonly ReviewAttempt[]): string | null {
  let lastLoss = -1;
  for (let i = 0; i < attempts.length; i++) {
    if (!attempts[i]!.win) lastLoss = i;
  }
  if (lastLoss === -1) return null;
  const winsSince = attempts.length - 1 - lastLoss;
  if (winsSince >= REVIEW_LADDER_DAYS.length) return null;
  const at = attempts[attempts.length - 1]!.at;
  if (!at) return ALWAYS_DUE;
  const base = Date.parse(at);
  if (Number.isNaN(base)) return ALWAYS_DUE;
  return new Date(base + REVIEW_LADDER_DAYS[winsSince]! * DAY_MS).toISOString();
}

/**
 * One Woodpecker pass over a book: attempts inside the window belong to
 * the cycle, and the FIRST of them is the one the pass is scored by —
 * a retry after seeing the answer is practice, not a better score.
 * `finishedAt` unset means the cycle is still open.
 */
export interface CycleWindow {
  startedAt: string;
  finishedAt?: string;
}

/** This puzzle's scoring attempt within the cycle, or null if the cycle
    has not reached it. Undated attempts predate cycles entirely and are
    never inside one. */
export function cycleAttempt(
  attempts: readonly ReviewAttempt[],
  cycle: CycleWindow,
): ReviewAttempt | null {
  for (const attempt of attempts) {
    if (!attempt.at || attempt.at < cycle.startedAt) continue;
    if (cycle.finishedAt !== undefined && attempt.at > cycle.finishedAt) continue;
    return attempt;
  }
  return null;
}
