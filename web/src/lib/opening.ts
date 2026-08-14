import { useEffect, useMemo, useState } from 'react';
import type { MoveTree, NodeId } from '@shared/types';

/**
 * The name of the opening a line has reached.
 *
 * Looked up BY POSITION, not by move order, so transpositions name
 * themselves correctly: the server keys its catalogue on a Zobrist hash of
 * the position, so 1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 arrives at the Nimzo-Indian
 * whichever order the moves were played in.
 *
 * Named positions run out after a handful of moves — nothing in the
 * catalogue describes move 30 — so the answer is the DEEPEST named
 * position on the way here, and it stays put once the book has nothing
 * more to say. That is also what a player means by "which opening is
 * this": the last thing it was still called.
 */

/** Shared across every panel that asks; a position's name never changes. */
const known = new Map<string, string | null>();
const inFlight = new Map<string, Promise<void>>();

function lookup(fen: string): Promise<void> {
  if (known.has(fen)) return Promise.resolve();
  // One request per position even when callers race — and every caller's
  // await resolves only once the answer is actually in `known`, which the
  // review's sequential book walk depends on.
  const pending = inFlight.get(fen);
  if (pending) return pending;
  const request = (async () => {
    try {
      const res = await fetch(`/api/opening?fen=${encodeURIComponent(fen)}`);
      const body = (await res.json()) as { opening?: { eco: string; name: string } | null };
      // The ECO code rides with the name — "B90 Sicilian, Najdorf" says more
      // than either half, and it is what every book and database prints.
      known.set(
        fen,
        body.opening ? [body.opening.eco, body.opening.name].filter(Boolean).join(' ') : null,
      );
    } catch {
      // A name is decoration; a failed lookup must not break the panel.
      known.set(fen, null);
    } finally {
      inFlight.delete(fen);
    }
  })();
  inFlight.set(fen, request);
  return request;
}

/**
 * Whether a position is in the opening catalogue at all — the membership
 * test behind "book move": a move whose resulting position is named is
 * theory, whatever the engine thinks of it. Same cache as the names.
 */
export async function isNamedPosition(fen: string): Promise<boolean> {
  await lookup(fen);
  return (known.get(fen) ?? null) !== null;
}

/**
 * One pass of book classification over what the cache already knows.
 *
 * The rule is path-gated and position-based, on EVERY branch of the tree,
 * not just the mainline: a move is book when the position it reaches is in
 * the catalogue AND its parent was book. So a variation that branches
 * within theory — or transposes into it move by move — is tagged, while
 * "once out of book, never back in" still holds along any single path,
 * which is the same rule the review's judgment suppression applies to the
 * played moves. The root opens the gate without a lookup of its own: the
 * starting position has no catalogue row, and a custom root's children
 * simply miss.
 *
 * A position the cache has not answered yet is returned in `unresolved`
 * rather than guessed at, and its subtree is not descended — the caller
 * looks those up and classifies again; each round settles one ply deeper,
 * and NAMED_PLIES bounds the whole affair.
 */
function classifyBook(tree: MoveTree): { book: Set<NodeId>; unresolved: string[] } {
  const book = new Set<NodeId>();
  const unresolved: string[] = [];
  const frontier: NodeId[] = [tree.rootId];
  while (frontier.length > 0) {
    const node = tree.nodes[frontier.pop()!];
    if (!node) continue;
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (!child || child.ply > NAMED_PLIES) continue;
      const name = known.get(child.fen);
      if (name === undefined) unresolved.push(child.fen);
      else if (name !== null) {
        book.add(childId);
        frontier.push(childId);
      }
    }
  }
  return { book, unresolved };
}

/**
 * The tree's book moves, live: classification re-runs as lookups land and
 * whenever the tree changes, so a variation played just now tags itself.
 * Costs nothing per render — the walk is memoized on the tree, and every
 * position asked about lands in the same cache the opening names use.
 */
export function useBookTags(tree: MoveTree): Set<NodeId> {
  const [version, setVersion] = useState(0);
  // `version` only exists to re-run the walk once lookups resolve.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { book, unresolved } = useMemo(() => classifyBook(tree), [tree, version]);
  useEffect(() => {
    if (unresolved.length === 0) return;
    let live = true;
    void Promise.all(unresolved.map(lookup)).then(() => {
      if (live) setVersion((v) => v + 1);
    });
    return () => {
      live = false;
    };
  }, [unresolved]);
  return book;
}

/**
 * @param fens every position from the start of the line to the cursor, in
 *   order. Positions already looked up cost nothing.
 */
/**
 * How deep to bother asking. The catalogue runs out long before this; a
 * line is not going to acquire a name at move forty.
 */
export const NAMED_PLIES = 30;

export function useOpeningName(fens: string[]): string | null {
  const [, bump] = useState(0);
  const current = fens[fens.length - 1];

  useEffect(() => {
    if (!current) return;
    let live = true;
    // The whole line, not just the position being looked at. Asking only
    // about the current one meant the answer depended on HOW you got here:
    // stepping forward move by move looked up each position on the way,
    // but opening a game — or handing a repertoire line to the board —
    // lands on the last move with nothing behind it ever asked about, so
    // the line came out unnamed or wearing whatever shallow name happened
    // to be cached.
    const wanted = fens.slice(0, NAMED_PLIES + 1).filter((fen) => !known.has(fen));
    if (wanted.length === 0) return;
    void Promise.all(wanted.map(lookup)).then(() => {
      if (live) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
    // Keyed on the position: a different cursor means a different line to
    // name, and the array identity changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  for (let at = Math.min(fens.length, NAMED_PLIES + 1) - 1; at >= 0; at--) {
    const name = known.get(fens[at]!);
    if (name) return name;
  }
  return null;
}
