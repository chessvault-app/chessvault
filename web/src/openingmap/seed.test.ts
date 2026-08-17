import { describe, expect, it } from 'vitest';
import { addSan, createTree, getNode } from '@shared/tree';
import { fenKey } from '@/lib/fen';
import { seedFromGames } from './seed';

/** A fake games index: SAN lines with counts, answered by position. */
const index = (games: { line: string[]; count: number }[]) => {
  const byKey = new Map<string, Map<string, number>>();
  for (const { line, count } of games) {
    let tree = createTree();
    let cursor = tree.rootId;
    for (const san of line) {
      const key = fenKey(getNode(tree, cursor).fen);
      const moves = byKey.get(key) ?? new Map<string, number>();
      moves.set(san, (moves.get(san) ?? 0) + count);
      byKey.set(key, moves);
      const added = addSan(tree, cursor, san)!;
      tree = added.tree;
      cursor = added.nodeId;
    }
  }
  return (fen: string) =>
    Promise.resolve(
      [...(byKey.get(fenKey(fen)) ?? new Map<string, number>())].map(([san, total]) => ({
        uci: san,
        san,
        total,
      })),
    );
};

describe('seedFromGames', () => {
  it('charts my most-played move and every reply worth meeting', async () => {
    const moves = index([
      { line: ['e4', 'c5', 'Nf3'], count: 30 },
      { line: ['e4', 'e5', 'Nf3'], count: 15 },
      { line: ['e4', 'g6'], count: 2 }, // below the floor
      { line: ['d4', 'd5'], count: 3 }, // my rare experiment, not my repertoire
    ]);
    const lines = await seedFromGames({ color: 'white', startPath: [], minGames: 5, moves });
    // My move: e4 alone (d4 is not what I play). Their replies: c5 and
    // e5; g6 is twice and stays off. Then my Nf3 against each.
    expect(lines).toEqual([
      ['e4'],
      ['e4', 'c5'],
      ['e4', 'e5'],
      ['e4', 'c5', 'Nf3'],
      ['e4', 'e5', 'Nf3'],
    ]);
  });

  it('grows from a mid-map node, honouring the caps', async () => {
    const moves = index([{ line: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4'], count: 20 }]);
    const lines = await seedFromGames({
      color: 'white',
      startPath: ['e4', 'c5'],
      minGames: 5,
      maxPlies: 2,
      moves,
    });
    expect(lines).toEqual([
      ['e4', 'c5', 'Nf3'],
      ['e4', 'c5', 'Nf3', 'd6'],
    ]);
  });

  it('answers empty when the games do not reach the start', async () => {
    const moves = index([{ line: ['d4', 'd5'], count: 20 }]);
    expect(
      await seedFromGames({ color: 'white', startPath: ['e4', 'c5'], minGames: 5, moves }),
    ).toEqual([]);
  });
});
