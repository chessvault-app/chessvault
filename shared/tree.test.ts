import { describe, expect, it } from 'vitest';
import {
  addMove,
  addSan,
  addUci,
  collectSubtree,
  createTree,
  deleteSubtree,
  getNode,
  isOnMainline,
  legalDests,
  mainlineFrom,
  moveNumberLabel,
  pathTo,
  promoteToMainline,
  promoteVariation,
} from './tree.ts';
import type { MoveTree } from './types.ts';

/** Play a sequence of SAN moves down the mainline, asserting each is legal. */
function line(tree: MoveTree, sans: string[]): { tree: MoveTree; last: string } {
  let cursor = tree.rootId;
  let current = tree;
  for (const san of sans) {
    const result = addSan(current, cursor, san);
    expect(result, `${san} should be legal`).toBeDefined();
    current = result!.tree;
    cursor = result!.nodeId;
  }
  return { tree: current, last: cursor };
}

describe('move tree', () => {
  it('records SAN, UCI, FEN and ply when playing a move', () => {
    const { tree, last } = line(createTree(), ['e4']);
    const node = getNode(tree, last);
    expect(node.san).toBe('e4');
    expect(node.uci).toBe('e2e4');
    expect(node.ply).toBe(1);
    expect(node.fen).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b');
  });

  it('reuses an existing child instead of branching on a repeated move', () => {
    const { tree, last } = line(createTree(), ['e4']);
    const again = addSan(tree, tree.rootId, 'e4');
    expect(again!.existed).toBe(true);
    expect(again!.nodeId).toBe(last);
    expect(getNode(again!.tree, tree.rootId).children).toHaveLength(1);
  });

  it('branches on a genuinely different move', () => {
    const { tree } = line(createTree(), ['e4']);
    const other = addSan(tree, tree.rootId, 'd4')!;
    expect(other.existed).toBe(false);
    expect(getNode(other.tree, other.tree.rootId).children).toHaveLength(2);
  });

  it('rejects illegal moves rather than corrupting the tree', () => {
    const tree = createTree();
    // Legal-looking SAN that isn't available in this position.
    expect(addSan(tree, tree.rootId, 'Qxf7')).toBeUndefined();
    expect(addSan(tree, tree.rootId, 'e5')).toBeUndefined();
    // Well-formed UCI for a move that isn't legal here.
    expect(addUci(tree, tree.rootId, 'e2e5')).toBeUndefined();
    expect(addUci(tree, tree.rootId, 'garbage')).toBeUndefined();
    expect(getNode(tree, tree.rootId).children).toHaveLength(0);
  });

  it('handles promotion via UCI', () => {
    // Black king on e5, off every line from a8, so the SAN carries no suffix.
    const tree = createTree('8/P7/8/4k3/8/8/8/K7 w - - 0 1');
    const promoted = addUci(tree, tree.rootId, 'a7a8q');
    expect(promoted).toBeDefined();
    expect(getNode(promoted!.tree, promoted!.nodeId).san).toBe('a8=Q');
    expect(getNode(promoted!.tree, promoted!.nodeId).uci).toBe('a7a8q');

    // Promoting to a knight must be distinguishable from promoting to a queen.
    const knight = addUci(promoted!.tree, tree.rootId, 'a7a8n');
    expect(getNode(knight!.tree, knight!.nodeId).san).toBe('a8=N');
  });

  it('appends check and mate suffixes to SAN', () => {
    // Same promotion, but now the king sits on the a8-h1 diagonal.
    const checking = createTree('8/P7/8/8/8/8/8/K6k w - - 0 1');
    const withCheck = addUci(checking, checking.rootId, 'a7a8q')!;
    expect(getNode(withCheck.tree, withCheck.nodeId).san).toBe('a8=Q+');

    // Back-rank mate delivered from a distance: the rook lands on a8, out of
    // reach of the g8 king, which is otherwise walled in by its own pawns.
    const mating = createTree('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
    const mate = addSan(mating, mating.rootId, 'Ra8');
    expect(mate, 'Ra8 should be legal').toBeDefined();
    // The '#' is appended by the codec, not supplied by us.
    expect(getNode(mate!.tree, mate!.nodeId).san).toBe('Ra8#');
  });

  it('builds a path from root to node and reports the mainline', () => {
    const { tree, last } = line(createTree(), ['e4', 'e5', 'Nf3']);
    expect(pathTo(tree, last)).toHaveLength(4); // root + 3 moves
    expect(mainlineFrom(tree, tree.rootId).map((id) => getNode(tree, id).san)).toEqual([
      'e4',
      'e5',
      'Nf3',
    ]);
  });

  it('deletes a subtree and detaches it from its parent', () => {
    const built = line(createTree(), ['e4', 'e5']);
    const branch = addSan(built.tree, getNode(built.tree, built.last).parentId!, 'c5')!;
    const beforeCount = collectSubtree(branch.tree, branch.tree.rootId).length;

    const pruned = deleteSubtree(branch.tree, branch.nodeId);
    expect(collectSubtree(pruned, pruned.rootId)).toHaveLength(beforeCount - 1);
    expect(pruned.nodes[branch.nodeId]).toBeUndefined();
    const parent = getNode(pruned, getNode(branch.tree, branch.nodeId).parentId!);
    expect(parent.children).not.toContain(branch.nodeId);
  });

  it('refuses to delete the root', () => {
    const tree = createTree();
    expect(() => deleteSubtree(tree, tree.rootId)).toThrow(/root/);
  });

  it('promotes a nested variation all the way to the mainline', () => {
    // Mainline 1.e4 e5 2.Nf3; variation 2.Bc4 with its own reply.
    const built = line(createTree(), ['e4', 'e5', 'Nf3']);
    const afterE5 = getNode(built.tree, built.last).parentId!;
    const bc4 = addSan(built.tree, afterE5, 'Bc4')!;
    const deep = addSan(bc4.tree, bc4.nodeId, 'Nf6')!;

    expect(isOnMainline(deep.tree, deep.nodeId)).toBe(false);
    const promoted = promoteToMainline(deep.tree, deep.nodeId);
    expect(isOnMainline(promoted, deep.nodeId)).toBe(true);
    // The old mainline move must still exist, just demoted.
    expect(getNode(promoted, afterE5).children).toHaveLength(2);
    expect(getNode(promoted, afterE5).children[0]).toBe(bc4.nodeId);
  });

  it('moves a variation up one slot among its siblings', () => {
    const tree = createTree();
    const first = addSan(tree, tree.rootId, 'e4')!;
    const second = addSan(first.tree, tree.rootId, 'd4')!;
    const third = addSan(second.tree, tree.rootId, 'c4')!;

    const moved = promoteVariation(third.tree, third.nodeId);
    expect(getNode(moved, moved.rootId).children).toEqual([
      first.nodeId,
      third.nodeId,
      second.nodeId,
    ]);
    // Already-first child is a no-op rather than an error.
    expect(getNode(promoteVariation(moved, first.nodeId), moved.rootId).children[0]).toBe(
      first.nodeId,
    );
  });

  it('exposes legal destinations in chessground form', () => {
    const tree = createTree();
    const dests = legalDests(tree, tree.rootId);
    expect(dests.get('e2')).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(dests.get('g1')).toEqual(expect.arrayContaining(['f3', 'h3']));
    // 20 legal first moves come from 10 distinct origin squares.
    expect(dests.size).toBe(10);
  });

  it('labels move numbers for both colours', () => {
    expect(moveNumberLabel(1)).toBe('1.');
    expect(moveNumberLabel(2)).toBe('1...');
    expect(moveNumberLabel(3)).toBe('2.');
    expect(moveNumberLabel(20)).toBe('10...');
  });
});

describe('castling by either square', () => {
  /** Kings and rooks home, everything else swept away. */
  const ready = (): MoveTree =>
    createTree('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');

  it('offers the king its landing square as well as its rook', () => {
    const tree = ready();
    const dests = legalDests(tree, tree.rootId).get('e1') ?? [];
    // h1 is how chessops spells it; g1 is where a player aims.
    expect(dests).toContain('h1');
    expect(dests).toContain('g1');
    expect(dests).toContain('a1');
    expect(dests).toContain('c1');
  });

  it('plays the same move whichever square was clicked', () => {
    const base = ready();
    const viaRook = addMove(base, base.rootId, { from: 4, to: 7 });
    const viaKing = addMove(base, base.rootId, { from: 4, to: 6 });
    const rookNode = getNode(viaRook.tree, viaRook.nodeId);
    const kingNode = getNode(viaKing.tree, viaKing.nodeId);
    expect(rookNode.san).toBe('O-O');
    expect(kingNode.san).toBe('O-O');
    // One spelling reaches the tree, so a line replays either way.
    expect(kingNode.uci).toBe(rookNode.uci);
    expect(kingNode.fen).toBe(rookNode.fen);
  });

  it('does not branch when the same castle is entered both ways', () => {
    const base = ready();
    const first = addMove(base, base.rootId, { from: 4, to: 6 });
    const again = addMove(first.tree, base.rootId, { from: 4, to: 7 });
    expect(again.existed).toBe(true);
    expect(again.nodeId).toBe(first.nodeId);
  });

  it('queenside too, from the c-file', () => {
    const base = ready();
    const out = addMove(base, base.rootId, { from: 4, to: 2 });
    expect(getNode(out.tree, out.nodeId).san).toBe('O-O-O');
  });
});
