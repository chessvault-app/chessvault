import type { ApiPuzzle } from './puzzle';

/**
 * The puzzle the hub already has in hand, for the trainer about to open.
 *
 * The hub shows the next puzzle on a board and invites you to solve it —
 * and `/api/puzzles/next` picks at RANDOM, so a trainer left to fetch its
 * own would serve a different position than the one that was pointed at.
 * The board would be an advertisement for a puzzle you never get.
 *
 * So the hub hands over the puzzle it drew. This is the app's handoff
 * pattern (see `studies/jumpTarget.ts`, and the analysis store's
 * `handoff` before it): a module-level note set just before navigate(),
 * consumed once by the trainer's boot, gone the moment it is read. A
 * plain open — reload, bookmark, the sidebar — sees nothing and fetches
 * as it always has.
 *
 * It carries its `mode` because the hub draws two of these, and a puzzle
 * drawn from the review pool must not be able to start a counted session
 * (or the other way round). A note that does not match the trainer that
 * mounted is discarded, not used.
 *
 * Free side effect, and the honest reason to prefer this over a seeded
 * route: the trainer opens on a board instead of a spinner, because the
 * fetch already happened while the hub was being looked at.
 */
export type HandoffMode = 'fresh' | 'failed';

interface Pending {
  mode: HandoffMode;
  puzzle: ApiPuzzle;
}

let pending: Pending | null = null;

export const setPendingPuzzle = (mode: HandoffMode, puzzle: ApiPuzzle): void => {
  pending = { mode, puzzle };
};

/** The handed-over puzzle if one was left for THIS mode; null otherwise.
    Clears either way — a note read by the wrong trainer is stale, and
    leaving it would let it surface a navigation later. */
export function consumePendingPuzzle(mode: HandoffMode): ApiPuzzle | null {
  const note = pending;
  pending = null;
  return note && note.mode === mode ? note.puzzle : null;
}
