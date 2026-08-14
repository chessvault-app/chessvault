import { describe, expect, it } from 'vitest';
import { addSan, createTree, getNode } from '@shared/tree';
import type { Chapter, MoveTree, NodeId } from '@shared/types';
import { advanceCands, buildPosIndex, expectedSans, fenKey, openingFamily, trunkOf, type DrillCand } from './drill';

/** A chapter whose mainline is the given SANs. */
function chapterOf(name: string, sans: string[]): Chapter {
  let tree = createTree();
  let id = tree.rootId;
  for (const san of sans) {
    const added = addSan(tree, id, san);
    if (!added) throw new Error(`illegal fixture move: ${san}`);
    tree = added.tree;
    id = added.nodeId;
  }
  return { id: name, name, tree, headers: {} };
}

/** Walk a game line through the drill the way the view does. */
function drillThrough(
  chapters: Chapter[],
  sans: string[],
): { cands: DrillCand[]; game: MoveTree; tip: NodeId } {
  const posIndex = buildPosIndex(chapters);
  let game = createTree();
  let tip = game.rootId;
  let cands = posIndex.get(fenKey(getNode(game, tip).fen)) ?? [];
  for (const san of sans) {
    const added = addSan(game, tip, san);
    if (!added) throw new Error(`illegal game move: ${san}`);
    game = added.tree;
    tip = added.nodeId;
    cands = advanceCands(chapters, posIndex, cands, san, fenKey(getNode(game, tip).fen));
  }
  return { cands, game, tip };
}

describe('repertoire drill candidates', () => {
  it('seeds every chapter root sharing the start position', () => {
    const chapters = [chapterOf('A', ['e4']), chapterOf('B', ['d4'])];
    const posIndex = buildPosIndex(chapters);
    const roots = posIndex.get(fenKey(getNode(chapters[0]!.tree, chapters[0]!.tree.rootId).fen))!;
    expect(roots.map((c) => c.ci).sort()).toEqual([0, 1]);
    // The expected first moves are the union of both chapters.
    expect(expectedSans(chapters, roots)).toEqual(['e4', 'd4']);
  });

  it('a move only one chapter prepares keeps the drill alive there', () => {
    const chapters = [
      chapterOf('Italian', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']),
      chapterOf('Spanish', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']),
    ];
    const spanish = drillThrough(chapters, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    // Only the Spanish chapter survives Bb5, and its reply is expected.
    expect(spanish.cands).toHaveLength(1);
    expect(spanish.cands[0]!.ci).toBe(1);
    expect(expectedSans(chapters, spanish.cands)).toEqual(['a6']);
    // At the branch point both chapters were still candidates.
    const branch = drillThrough(chapters, ['e4', 'e5', 'Nf3', 'Nc6']);
    expect(expectedSans(chapters, branch.cands)).toEqual(['Bc4', 'Bb5']);
  });

  it('a move no chapter prepares empties the candidates — a miss or a gap', () => {
    const chapters = [chapterOf('A', ['e4', 'e5'])];
    const { cands } = drillThrough(chapters, ['d4']);
    expect(cands).toEqual([]);
  });

  it('an exhausted line reports no expected moves — the line ending', () => {
    const chapters = [chapterOf('A', ['e4', 'e5'])];
    const { cands } = drillThrough(chapters, ['e4', 'e5']);
    expect(cands).toHaveLength(1);
    expect(expectedSans(chapters, cands)).toEqual([]);
  });

  it('recognises a transposition into another chapter mid-drill', () => {
    // Two move orders into the same position; only the QGD chapter knows
    // what comes next. Drilling along the English order must pick the
    // QGD chapter up at the merge and keep its continuation expected.
    const chapters = [
      chapterOf('QGD', ['d4', 'd5', 'c4', 'e6', 'Nc3']),
      chapterOf('English', ['c4', 'e6', 'd4', 'd5']),
    ];
    const merged = drillThrough(chapters, ['c4', 'e6', 'd4', 'd5']);
    // Both chapters hold the merged position…
    expect(merged.cands.map((c) => c.ci).sort()).toEqual([0, 1]);
    // …so the QGD's next move is expected even though the English
    // chapter ends here.
    expect(expectedSans(chapters, merged.cands)).toEqual(['Nc3']);
  });

  it('recognises a transposition within a single chapter', () => {
    // The chapter is written 1.d4 d5 2.c4; the game arrives via 1.c4 d5
    // 2.d4. The first two game moves are out of book (the chapter never
    // plays 1.c4), but the merged position after 2.d4 is in the index —
    // candidates resume there.
    const chapters = [chapterOf('QG', ['d4', 'd5', 'c4', 'e6'])];
    const posIndex = buildPosIndex(chapters);
    let game = createTree();
    let tip = game.rootId;
    let cands = posIndex.get(fenKey(getNode(game, tip).fen)) ?? [];
    for (const san of ['c4', 'd5', 'd4']) {
      const added = addSan(game, tip, san)!;
      game = added.tree;
      tip = added.nodeId;
      cands = advanceCands(chapters, posIndex, cands, san, fenKey(getNode(game, tip).fen));
    }
    expect(cands).toHaveLength(1);
    expect(expectedSans(chapters, cands)).toEqual(['e6']);
  });
});

describe('gap relevance helpers', () => {
  const seedOf = (chapters: Parameters<typeof buildPosIndex>[0]) => {
    const posIndex = buildPosIndex(chapters);
    const rootFen = getNode(chapters[0]!.tree, chapters[0]!.tree.rootId).fen;
    return { posIndex, rootFen, seed: posIndex.get(fenKey(rootFen))! };
  };

  it('finds the trunk of a study that branches late', () => {
    // Every line shares five plies before Black's answers diverge.
    const chapters = [
      chapterOf('Cozio', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nge7']),
      chapterOf('Berlin', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6']),
    ];
    const { posIndex, rootFen, seed } = seedOf(chapters);
    const trunk = trunkOf(chapters, posIndex, seed, rootFen);
    expect(trunk.ply).toBe(5);
    // 1...c5 deviates at ply 1 — before the trunk end, so its relevance
    // falls to the opening-family comparison, which the view resolves.
    expect(1).toBeLessThan(trunk.ply);
    // 3...a6 deviates at ply 5 — study territory, always relevant.
    expect(5).toBeGreaterThanOrEqual(trunk.ply);
  });

  it('a repertoire that branches at once has no trunk to hide behind', () => {
    const chapters = [chapterOf('Open', ['e4', 'e5']), chapterOf('Sicilian', ['e4', 'c5'])];
    const { posIndex, rootFen, seed } = seedOf(chapters);
    // The trunk is just 1.e4: every reply deviation is at or past it.
    expect(trunkOf(chapters, posIndex, seed, rootFen).ply).toBe(1);
  });

  it('splits an opening name into its family', () => {
    expect(openingFamily('Ruy Lopez: Berlin Defense')).toBe('Ruy Lopez');
    expect(openingFamily('Sicilian Defense')).toBe('Sicilian Defense');
    expect(openingFamily(null)).toBe(null);
    expect(openingFamily('')).toBe(null);
  });
});
