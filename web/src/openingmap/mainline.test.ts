import { describe, expect, it } from 'vitest';
import type { FieldMove } from '@/repertoire/field';
import { chaseFrontier, favouriteChild } from './mainline';
import type { MapNode, ResolvedNode } from './model';

/** A node whose children are named by their SAN, which is all the rule reads. */
const node = (id: string, children: MapNode[] = [], san?: string): MapNode => ({
  id,
  ...(san ? { san } : {}),
  children,
});

const move = (san: string, total: number): FieldMove => ({ uci: san, san, total });

/** Resolved facts for a tree, keyed by id, with a stand-in for each FEN —
    the chase only ever passes a position through to the caller's cache. */
function resolve(root: MapNode): Map<string, ResolvedNode> {
  const nodes = new Map<string, ResolvedNode>();
  const walk = (n: MapNode, parentId: string | null, ply: number): void => {
    nodes.set(n.id, { mapNode: n, parentId, ply, path: [], fen: `fen:${n.id}`, treeId: null });
    for (const child of n.children) walk(child, n.id, ply + 1);
  };
  walk(root, null, 0);
  return nodes;
}

describe('favouriteChild', () => {
  it('takes the most-played child', () => {
    const children = [node('a', [], 'e4'), node('b', [], 'd4')];
    expect(favouriteChild(children, (id) => (id === 'b' ? 0.6 : 0.4))).toBe('b');
  });

  it('takes nothing where nothing is played', () => {
    expect(favouriteChild([node('a', [], 'e4')], () => 0)).toBeNull();
    expect(favouriteChild([], () => 1)).toBeNull();
  });
});

describe('chaseFrontier', () => {
  const tree = node('root', [
    node('a', [node('a1', [node('a1x', [], 'Nf3')], 'c5'), node('a2', [], 'e5')], 'e4'),
    node('b', [], 'd4'),
  ]);
  const nodes = resolve(tree);
  const never = (): boolean => false;

  it('asks about the focus itself while its position is unanswered', () => {
    expect(chaseFrontier(nodes, ['a'], () => undefined, never)).toEqual([{ id: 'a', fen: 'fen:a' }]);
  });

  it('walks past what is answered to the first position that is not', () => {
    const known = new Map([['fen:a', [move('c5', 70), move('e5', 30)]]]);
    expect(chaseFrontier(nodes, ['a'], (fen) => known.get(fen), never)).toEqual([
      { id: 'a1', fen: 'fen:a1' },
    ]);
  });

  it('stops where the line stops, with nothing left to ask', () => {
    const known = new Map([
      ['fen:a', [move('c5', 70)]],
      ['fen:a1', [move('Nf3', 50)]],
      ['fen:a1x', []],
    ]);
    expect(chaseFrontier(nodes, ['a'], (fen) => known.get(fen), never)).toEqual([]);
  });

  it('moves on to the next line rather than asking twice for one position', () => {
    const busy = (fen: string): boolean => fen === 'fen:a';
    expect(chaseFrontier(nodes, ['a', 'b'], () => undefined, busy)).toEqual([
      { id: 'b', fen: 'fen:b' },
    ]);
  });

  it('leaves a stretch one line has already claimed to that line', () => {
    const known = new Map([['fen:a', [move('c5', 70)]]]);
    // 'a1' is on a's line, so focusing both asks for it once.
    expect(chaseFrontier(nodes, ['a', 'a1'], (fen) => known.get(fen), never)).toEqual([
      { id: 'a1', fen: 'fen:a1' },
    ]);
  });
});

/**
 * What the ordering is worth, in round trips.
 *
 * Against the online source a position costs one Lichess request — the
 * public explorer answers one at a time — and the sweep runs two lanes,
 * so a round trip is the unit that matters. Measured here on a
 * repertoire-shaped map of 400 positions: our move, three replies, our
 * move, and so on down.
 *
 * The chase is the real code; the ply-ordered baseline is the queue the
 * sweep still works through when nothing has the focus. Both are driven
 * by the same two-lane loop, so the only difference is which position
 * goes next.
 */
describe('the lit line, in round trips', () => {
  /** Repertoire-shaped: one move of ours, three of theirs, breadth first. */
  function buildMap(size: number): MapNode {
    const root = node('n0');
    const all = [root];
    const queue = [{ n: root, ply: 0 }];
    let next = 1;
    while (all.length < size && queue.length > 0) {
      const { n, ply } = queue.shift()!;
      const width = ply % 2 === 0 ? 1 : 3;
      for (let i = 0; i < width && all.length < size; i += 1) {
        const child = node(`n${next}`, [], `m${next}`);
        next += 1;
        n.children.push(child);
        all.push(child);
        queue.push({ n: child, ply: ply + 1 });
      }
    }
    return root;
  }

  const root = buildMap(400);
  const nodes = resolve(root);
  /** Every position answers; which child leads is fixed and arbitrary. */
  const fieldAt = (fen: string): FieldMove[] => {
    const id = fen.slice(4);
    const children = nodes.get(id)!.mapNode.children;
    return children.map((c, at) => move(c.san!, 100 - at * 10));
  };

  /** The positions the line's edges are drawn from, in the order the
      chase can possibly learn them — each one names the next. */
  const lineOf = (start: string): string[] => {
    const out: string[] = [];
    let cursor: string | null = start;
    while (cursor) {
      const facts = nodes.get(cursor)!;
      out.push(facts.fen!);
      const moves = fieldAt(facts.fen!);
      cursor = favouriteChild(facts.mapNode.children, (id) => {
        const san = facts.mapNode.children.find((c) => c.id === id)?.san;
        return moves.find((m) => m.san === san)?.total ?? 0;
      });
    }
    return out;
  };

  /** Two lanes, one round trip a round; returns the round the last of
      `needed` was answered in. */
  function rounds(order: () => string[], needed: string[]): number {
    const answered = new Set<string>();
    for (let round = 1; round <= 1000; round += 1) {
      for (const fen of order().slice(0, 2)) answered.add(fen);
      if (needed.every((fen) => answered.has(fen))) return round;
    }
    throw new Error('never finished');
  }

  // A node four plies in, which is where a repertoire question gets asked.
  const picked = 'n5';
  const line = lineOf(picked);
  // Its last position has no continuation to reveal, so nothing waits on it.
  const needed = line.slice(0, -1);

  it('costs one round trip an edge when the sweep chases it', () => {
    const answered = new Set<string>();
    const took = rounds(
      () =>
        chaseFrontier(
          nodes,
          [picked],
          (fen) => (answered.has(fen) ? fieldAt(fen) : undefined),
          (fen) => answered.has(fen),
        ).map((target) => {
          answered.add(target.fen);
          return target.fen;
        }),
      needed,
    );
    // Seven edges, seven round trips. The chain cannot be shortened —
    // a position names the next one — but nothing else is in front of
    // it, so at the third of a second a Lichess request measured out at
    // this is about two and a half seconds.
    expect(needed.length).toBe(7);
    expect(took).toBe(needed.length);
  });

  it('waited on most of the map in plain depth order', () => {
    const byPly = [...nodes.values()]
      .filter((facts) => facts.fen)
      .sort((a, b) => a.ply - b.ply)
      .map((facts) => facts.fen!);
    let at = 0;
    const took = rounds(() => byPly.slice(at, (at += 2)), needed);
    // 81 rounds against 7, because the line's positions sit a whole
    // ply-level of the map apart in this queue and the deepest of them
    // is answered two thirds of the way through the sweep: about half a
    // minute of an edge appearing every few seconds, which is the
    // complaint this ordering exists to answer.
    expect(took).toBe(81);
  });
});
