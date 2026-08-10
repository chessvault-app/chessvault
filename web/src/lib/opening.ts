import { useEffect, useState } from 'react';

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
const inFlight = new Set<string>();

async function lookup(fen: string): Promise<void> {
  if (known.has(fen) || inFlight.has(fen)) return;
  inFlight.add(fen);
  try {
    const res = await fetch(`/api/opening?fen=${encodeURIComponent(fen)}`);
    const body = (await res.json()) as { opening?: { eco: string; name: string } | null };
    known.set(fen, body.opening ? body.opening.name : null);
  } catch {
    // A name is decoration; a failed lookup must not break the panel.
    known.set(fen, null);
  } finally {
    inFlight.delete(fen);
  }
}

/**
 * @param fens every position from the start of the line to the cursor, in
 *   order. Positions already looked up cost nothing.
 */
export function useOpeningName(fens: string[]): string | null {
  const [, bump] = useState(0);
  const current = fens[fens.length - 1];

  useEffect(() => {
    if (!current) return;
    let live = true;
    // Only the position being looked at is fetched. Walking back through
    // the line uses what earlier positions already taught us, so stepping
    // through a game costs one request per new position and none at all
    // for one already visited.
    if (!known.has(current)) {
      void lookup(current).then(() => {
        if (live) bump((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
  }, [current]);

  for (let at = fens.length - 1; at >= 0; at--) {
    const name = known.get(fens[at]!);
    if (name) return name;
  }
  return null;
}
