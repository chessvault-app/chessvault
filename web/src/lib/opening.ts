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

/** What one lookup answers: the position's name, if any row ends there,
    and whether it lies anywhere along the catalogue's lines. `book` can be
    true with a null name — a waypoint inside theory. */
interface KnownOpening {
  name: string | null;
  book: boolean;
}

/** Shared across every panel that asks; a position's answer never changes. */
const known = new Map<string, KnownOpening>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Everything not yet known, asked for in one request.
 *
 * Each answer is a hash-map lookup on the server, but the opening map
 * labels hundreds of nodes at once and used to ask one round trip per
 * position — measured from the server's own log, thousands of /api/opening
 * requests crowding the same six connections the map's coverage and field
 * answers were waiting on. One position is never asked twice even when
 * callers race: a position already in flight is awaited, not re-sent, and
 * every caller's await resolves only once the answer is actually in
 * `known`, which the review's sequential book walk depends on.
 */
function lookupMany(fens: string[]): Promise<void> {
  const waits: Promise<void>[] = [];
  const fresh: string[] = [];
  const queued = new Set<string>();
  for (const fen of fens) {
    if (known.has(fen) || queued.has(fen)) continue;
    const pending = inFlight.get(fen);
    if (pending) {
      waits.push(pending);
      continue;
    }
    queued.add(fen);
    fresh.push(fen);
  }
  // Chunked well under the server's ceiling, so one degenerate caller
  // cannot build a request the server refuses whole.
  for (let at = 0; at < fresh.length; at += 500) {
    const chunk = fresh.slice(at, at + 500);
    const request = (async () => {
      try {
        const res = await fetch('/api/opening/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fens: chunk }),
        });
        const body = (await res.json()) as {
          positions?: { fen: string; opening?: { eco: string; name: string } | null; book?: boolean }[];
        };
        if (!res.ok || !body?.positions) throw new Error('opening lookup failed');
        const answered = new Map(body.positions.map((p) => [p.fen, p]));
        for (const fen of chunk) {
          const hit = answered.get(fen);
          // The ECO code rides with the name — "B90 Sicilian, Najdorf" says
          // more than either half, and it is what every book and database
          // prints.
          const name = hit?.opening
            ? [hit.opening.eco, hit.opening.name].filter(Boolean).join(' ')
            : null;
          // A server from before membership existed sends no `book`; a name
          // is then the best available proxy.
          known.set(fen, { name, book: hit?.book ?? name !== null });
        }
      } catch {
        // A name is decoration; a failed lookup must not break the panel.
        for (const fen of chunk) known.set(fen, { name: null, book: false });
      } finally {
        for (const fen of chunk) inFlight.delete(fen);
      }
    })();
    for (const fen of chunk) inFlight.set(fen, request);
    waits.push(request);
  }
  return Promise.all(waits).then(() => undefined);
}

function lookup(fen: string): Promise<void> {
  return lookupMany([fen]);
}

/**
 * Whether a position lies anywhere along the opening catalogue's lines —
 * the membership test behind "book move": a move that keeps the game
 * inside known theory is book, whatever the engine thinks of it and
 * whether or not a row happens to end (and so put a name) exactly there.
 * Same cache as the names.
 */
export async function isBookPosition(fen: string): Promise<boolean> {
  await lookup(fen);
  return known.get(fen)?.book ?? false;
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
      const entry = known.get(child.fen);
      if (entry === undefined) unresolved.push(child.fen);
      else if (entry.book) {
        book.add(childId);
        frontier.push(childId);
      }
    }
  }
  return { book, unresolved };
}

const NO_TAGS: Set<NodeId> = new Set();
const NOTHING_UNRESOLVED: string[] = [];

/**
 * The tree's book moves, live: classification re-runs as lookups land and
 * whenever the tree changes, so a variation played just now tags itself.
 * Costs nothing per render — the walk is memoized on the tree, and every
 * position asked about lands in the same cache the opening names use.
 *
 * `enabled: false` returns the empty set AND fires no lookups — the
 * analysis views defer the tags (and their traffic) until a review has
 * run, lanph3re's call: before that the icons are ink, not information.
 */
export function useBookTags(tree: MoveTree, enabled = true): Set<NodeId> {
  const [version, setVersion] = useState(0);
  // `version` only exists to re-run the walk once lookups resolve.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { book, unresolved } = useMemo(
    () =>
      enabled ? classifyBook(tree) : { book: NO_TAGS, unresolved: NOTHING_UNRESOLVED },
    [tree, enabled, version],
  );
  useEffect(() => {
    if (unresolved.length === 0) return;
    let live = true;
    void lookupMany(unresolved).then(() => {
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
    void lookupMany(wanted).then(() => {
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
    const name = known.get(fens[at]!)?.name;
    if (name) return name;
  }
  return null;
}

/**
 * Names for many unrelated positions at once — the opening map's canvas,
 * which labels every node with one hook rather than a hook per node.
 * Unlike useOpeningName this does NOT walk back along a line: each
 * position answers for itself, and one without a catalogue row of its
 * own maps to null. Same shared cache, so nothing is asked twice.
 */
export function useOpeningLabels(fens: string[]): ReadonlyMap<string, string | null> {
  const [version, bump] = useState(0);
  const key = fens.join('\n');

  useEffect(() => {
    const wanted = fens.filter((fen) => !known.has(fen));
    if (wanted.length === 0) return;
    let live = true;
    void lookupMany(wanted).then(() => {
      if (live) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
    // Keyed on the joined positions: the array identity changes per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(
    () => new Map(fens.map((fen) => [fen, known.get(fen)?.name ?? null])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, version],
  );
}
