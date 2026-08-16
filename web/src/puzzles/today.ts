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

/** Clean, counted solves recorded today — or null if the server did not
    answer, which is the caller's cue to leave the line as it was rather
    than show a nought that is really an error. */
export async function fetchSolvedToday(): Promise<number | null> {
  try {
    const res = await fetch('/api/puzzles/history?limit=200');
    if (!res.ok) return null;
    const { attempts } = (await res.json()) as {
      attempts: { win: boolean; counted?: boolean; at: string }[];
    };
    const today = new Date().toDateString();
    return attempts.filter(
      (h) => h.win && h.counted !== false && new Date(h.at).toDateString() === today,
    ).length;
  } catch {
    return null;
  }
}
