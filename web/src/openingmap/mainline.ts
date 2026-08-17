import type { MapNode } from './model';

/**
 * The rule the lit line walks on, in one place.
 *
 * Two things follow it and they must never disagree: the canvas, which
 * draws the accent down from whatever has the focus, and the field
 * sweep, which decides what to ASK the field about first so that line
 * can be drawn at all. When they disagreed the sweep fetched positions
 * the canvas was not waiting on, which is a bug with no symptom except
 * slowness.
 */

/**
 * The most-played child, or null where nothing is played — an unanswered
 * position, a position no game reached, or a leaf. Never a child with no
 * games: a zero share is not a continuation.
 */
export function favouriteChild(
  children: readonly MapNode[],
  shareOf: (id: string) => number,
): string | null {
  let best: string | null = null;
  let bestShare = 0;
  for (const child of children) {
    const share = shareOf(child.id);
    if (share > bestShare) {
      bestShare = share;
      best = child.id;
    }
  }
  return best;
}
