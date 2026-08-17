import type { FieldMove } from '@/repertoire/field';
import type { MapNode, ResolvedNode } from './model';

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

/** A position the lit line is waiting on: its node, and what to ask. */
export interface ChaseTarget {
  id: string;
  fen: string;
}

/**
 * The positions the lit line cannot be drawn without, nearest first.
 *
 * The line runs from the focus down through most-played children, so
 * every edge of it needs the field AT the node above it — and the node
 * after that cannot even be named until the one before it has answered.
 * A line is therefore a chain of round trips, and the only thing that
 * decides how fast it appears is whether those round trips are taken
 * next or somewhere behind the rest of the map.
 *
 * One target per focused line: the first node on it whose position is
 * unanswered. `busy` covers a position already being fetched — its line
 * is moving, so the answer here is the NEXT line rather than a second
 * request for the same thing.
 *
 * The walk stops where the canvas stops: at a node with no most-played
 * child, and at one another focused line has already claimed (the
 * canvas draws the shared stretch once, so it is asked for once).
 */
export function chaseFrontier(
  nodes: ReadonlyMap<string, ResolvedNode>,
  focus: readonly string[],
  fieldAt: (fen: string) => FieldMove[] | undefined,
  busy: (fen: string) => boolean,
): ChaseTarget[] {
  const out: ChaseTarget[] = [];
  const walked = new Set<string>();
  for (const start of focus) {
    let cursor: string | null = start;
    while (cursor && !walked.has(cursor)) {
      walked.add(cursor);
      const facts: ResolvedNode | undefined = nodes.get(cursor);
      if (!facts?.fen) break;
      const moves = fieldAt(facts.fen);
      if (!moves) {
        if (!busy(facts.fen)) out.push({ id: cursor, fen: facts.fen });
        break;
      }
      // The same share the canvas sizes and walks by — a move's count
      // over the position's — read straight off the answer. Dividing by
      // the total would rank the children identically, so it is left
      // out rather than computed and thrown away.
      const played = new Map<string, number>();
      for (const child of facts.mapNode.children) {
        if (child.san) played.set(child.id, moves.find((m) => m.san === child.san)?.total ?? 0);
      }
      cursor = favouriteChild(facts.mapNode.children, (id) => played.get(id) ?? 0);
    }
  }
  return out;
}
