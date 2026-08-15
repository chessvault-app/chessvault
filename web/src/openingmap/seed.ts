import { addSan, createTree, getNode } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { fenKey } from '@/repertoire/drill';
import type { FieldMove } from '@/repertoire/field';

/**
 * A starting repertoire read out of the games you already played.
 *
 * The walk asks, position by position, what your games hold: on your
 * turn it charts the move you actually play most (one move — that IS
 * your repertoire, and the alternatives are noise); on the opponent's
 * turn it charts every reply you meet often enough to deserve a node.
 * Depth, breadth and a games floor keep it a skeleton rather than a
 * transcript — the point is a map you then hang studies on, not a copy
 * of your archive.
 */

export interface SeedOptions {
  color: 'white' | 'black';
  /** SANs from the start position to the node to grow from. */
  startPath: string[];
  /** A move (yours or theirs) needs this many games to be charted. */
  minGames: number;
  /** How deep beyond the start node the walk may go, in plies. */
  maxPlies?: number;
  /** Ceiling on charted moves, a skeleton guard. */
  maxMoves?: number;
  /** An opponent reply also needs this share of the games here. */
  minShare?: number;
  /** The games index, injected so the walk is testable. */
  moves: (fen: string) => Promise<FieldMove[]>;
}

/** Full SAN lines from the start position, ready for chartLine. */
export async function seedFromGames(opts: SeedOptions): Promise<string[][]> {
  const maxPlies = opts.maxPlies ?? 12;
  const maxMoves = opts.maxMoves ?? 60;
  const minShare = opts.minShare ?? 0.08;

  let tree: MoveTree = createTree();
  let start: NodeId = tree.rootId;
  for (const san of opts.startPath) {
    const added = addSan(tree, start, san);
    if (!added) return [];
    tree = added.tree;
    start = added.nodeId;
  }

  const lines: string[][] = [];
  let charted = 0;
  const visited = new Set<string>([fenKey(getNode(tree, start).fen)]);
  const queue: { id: NodeId; path: string[]; ply: number }[] = [
    { id: start, path: opts.startPath, ply: 0 },
  ];

  while (queue.length > 0 && charted < maxMoves) {
    const { id, path, ply } = queue.shift()!;
    if (ply >= maxPlies) continue;
    const fen = getNode(tree, id).fen;
    const field = await opts.moves(fen);
    const games = field.reduce((sum, m) => sum + m.total, 0);
    if (games === 0) continue;
    const mine = (fen.split(' ')[1] === 'w' ? 'white' : 'black') === opts.color;
    const keep = mine
      ? field
          .filter((m) => m.total >= opts.minGames)
          .sort((a, b) => b.total - a.total)
          .slice(0, 1)
      : field.filter((m) => m.total >= opts.minGames && m.total / games >= minShare);
    for (const move of keep) {
      if (charted >= maxMoves) break;
      const added = addSan(tree, id, move.san);
      if (!added) continue;
      tree = added.tree;
      const line = [...path, move.san];
      lines.push(line);
      charted += 1;
      const key = fenKey(getNode(tree, added.nodeId).fen);
      // A transposition back into charted ground gets its move charted
      // (the map is about YOUR move orders) but is not walked again.
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ id: added.nodeId, path: line, ply: ply + 1 });
      }
    }
  }
  return lines;
}
