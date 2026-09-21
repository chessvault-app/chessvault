/**
 * How much has been solved today.
 *
 * One number, read from the same history file the dashboard aggregates,
 * counted by the same rule in both places that show it — the trainer's
 * session line and the hub's. It lived inside the trainer while the
 * trainer was the only page that wanted it; copying it to the second one
 * is how two counts of the same thing start disagreeing.
 *
 * "Counted" attempts only, matching the dashboard: a review or a replay
 * is training, but it is not progress through unseen puzzles, and it
 * would let the same puzzle raise the number twice.
 */

import { api } from '@/lib/api';

/** One attempt, as the history route writes it — the three fields anybody
    counting them reads. */
export interface Attempt {
  win: boolean;
  counted?: boolean;
  at: string;
}

/**
 * The tail of the history, or null if the server did not answer.
 *
 * Split out from the count below because home now wants the same tail for
 * two questions — today's number and the activity grid's half year — and
 * asking the same route twice on the one page that is a launch was the
 * obvious way to pay for it twice. The route's own cap is 500
 * (server/puzzles.ts); a caller asking for more gets 500.
 */
export async function fetchAttempts(limit: number): Promise<Attempt[] | null> {
  try {
    const { attempts } = await api<{ attempts: Attempt[] }>(
      `/api/puzzles/history?limit=${limit}`,
    );
    return Array.isArray(attempts) ? attempts : [];
  } catch {
    return null;
  }
}

/** Clean, counted solves recorded today, out of a tail already in hand. */
export function solvedToday(attempts: readonly Attempt[]): number {
  const today = new Date().toDateString();
  return attempts.filter(
    (h) => h.win && h.counted !== false && new Date(h.at).toDateString() === today,
  ).length;
}

/** Clean, counted solves recorded today — or null if the server did not
    answer, which is the caller's cue to leave the line as it was rather
    than show a nought that is really an error. */
export async function fetchSolvedToday(): Promise<number | null> {
  const attempts = await fetchAttempts(200);
  return attempts === null ? null : solvedToday(attempts);
}
