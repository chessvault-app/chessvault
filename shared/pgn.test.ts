import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePgn, parseComment, walk, type PgnNodeData } from 'chessops/pgn';
import { chaptersToPgn, gameToTree, pgnToChapters, treeToPgn } from './pgn.ts';
import { addSan, collectSubtree, createTree, getNode, updateNode } from './tree.ts';
import type { MoveTree } from './types.ts';

const fixture = readFileSync(
  fileURLToPath(new URL('./__fixtures__/lichess-study-4I4GynHK.pgn', import.meta.url)),
  'utf8',
);

/**
 * Structural fingerprint of a PGN, derived independently of our own tree code so
 * a bug in `gameToTree` can't hide by corrupting both sides of the comparison.
 */
interface Fingerprint {
  moves: number;
  variations: number;
  comments: number;
  shapes: number;
  nags: number;
  evals: number;
  sans: string[];
}

function fingerprint(pgn: string): Fingerprint {
  const ctx = { clone: () => ctx };
  const fp: Fingerprint = {
    moves: 0,
    variations: 0,
    comments: 0,
    shapes: 0,
    nags: 0,
    evals: 0,
    sans: [],
  };
  for (const game of parsePgn(pgn)) {
    walk(game.moves, ctx, (_c, data: PgnNodeData) => {
      fp.moves++;
      fp.sans.push(data.san);
      fp.nags += data.nags?.length ?? 0;
      for (const raw of [...(data.comments ?? []), ...(data.startingComments ?? [])]) {
        fp.comments++;
        const parsed = parseComment(raw);
        fp.shapes += parsed.shapes.length;
        if (parsed.evaluation) fp.evals++;
      }
    });
    const countBranches = (node: { children: unknown[] }): void => {
      if (node.children.length > 1) fp.variations += node.children.length - 1;
      for (const child of node.children) countBranches(child as { children: unknown[] });
    };
    countBranches(game.moves);
  }
  fp.sans.sort();
  return fp;
}

describe('PGN codec round-trip', () => {
  it('parses the fixture into chapters with real content', () => {
    const chapters = pgnToChapters(fixture);
    expect(chapters).toHaveLength(13);
    // Every chapter should have actual moves, not just headers.
    for (const chapter of chapters) {
      expect(collectSubtree(chapter.tree, chapter.tree.rootId).length).toBeGreaterThan(1);
      expect(chapter.name).toBeTruthy();
    }
  });

  it('preserves structure through tree -> PGN -> tree', () => {
    const before = fingerprint(fixture);
    // Guard against a vacuous pass: if the fixture ever parsed to nothing, the
    // equality below would trivially hold. Thresholds sit just under the
    // measured values (419 moves / 37 variations / 36 comments).
    expect(before.moves).toBeGreaterThan(400);
    expect(before.variations).toBeGreaterThan(30);
    expect(before.comments).toBeGreaterThan(30);
    // This fixture carries no shapes, NAGs or evals — those are covered by the
    // synthetic study below, which is why both tests exist.

    const after = fingerprint(chaptersToPgn(pgnToChapters(fixture)));
    expect(after).toEqual(before);
  });

  it('is idempotent: a second save is byte-identical', () => {
    // The property that actually protects the vault — repeatedly opening and
    // saving a study must never drift.
    const once = chaptersToPgn(pgnToChapters(fixture));
    const twice = chaptersToPgn(pgnToChapters(once));
    expect(twice).toBe(once);
  });

  it('preserves arrows, circles, evals and NAGs on a synthetic study', () => {
    let tree: MoveTree = createTree();
    let cursor = tree.rootId;
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) {
      const result = addSan(tree, cursor, san);
      expect(result, `${san} should be legal`).toBeDefined();
      tree = result!.tree;
      cursor = result!.nodeId;
    }

    // Annotate the last move the way the study UI will.
    tree = updateNode(tree, cursor, {
      comment: 'Morphy Defence — the main line.',
      nags: [1],
      shapes: [
        { color: 'green', from: 33, to: 42 },
        { color: 'red', from: 27, to: 27 },
      ],
      eval: { cp: 35, depth: 24 },
    });

    // Add a variation off the previous move so branching is exercised too.
    const parentOfLast = getNode(tree, cursor).parentId!;
    const variation = addSan(tree, parentOfLast, 'Nf6');
    expect(variation).toBeDefined();
    tree = updateNode(variation!.tree, variation!.nodeId, {
      comment: 'Berlin Defence.',
      nags: [5],
    });

    const pgn = treeToPgn(tree, { Event: 'Synthetic' });

    // Assert the on-disk form is Lichess's own syntax, not a private encoding.
    expect(pgn).toContain('[%cal Gb5c6]');
    expect(pgn).toContain('[%csl Rd4]');
    expect(pgn).toContain('[%eval 0.35]');
    expect(pgn).toContain('$1');
    expect(pgn).toContain('Nf6');

    // And that it survives a reload.
    const reloaded = pgnToChapters(pgn)[0]!;
    const annotated = collectSubtree(reloaded.tree, reloaded.tree.rootId)
      .map((id) => getNode(reloaded.tree, id))
      .find((n) => n.san === 'a6');

    expect(annotated).toBeDefined();
    expect(annotated!.comment).toBe('Morphy Defence — the main line.');
    expect(annotated!.nags).toEqual([1]);
    expect(annotated!.shapes).toHaveLength(2);
    expect(annotated!.eval?.cp).toBe(35);
  });

  it('keeps a custom starting position', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1';
    let tree = createTree(fen);
    const played = addSan(tree, tree.rootId, 'Ra8');
    expect(played).toBeDefined();
    tree = played!.tree;

    const pgn = treeToPgn(tree, {});
    expect(pgn).toContain('[FEN "4k3/8/8/8/8/8/8/R3K3 w Q - 0 1"]');
    expect(pgn).toContain('[SetUp "1"]');

    const reloaded = pgnToChapters(pgn)[0]!;
    expect(reloaded.tree.initialFen).toBe(fen);
  });

  it('reads variations that begin immediately at the first move', () => {
    // A branch at ply 1 is the case my first DFS attempt silently dropped.
    const pgn = '1. e4 (1. d4 d5 2. c4) e5 2. Nf3 *';
    const tree = gameToTree(parsePgn(pgn)[0]!);
    const sans = collectSubtree(tree, tree.rootId)
      .map((id) => getNode(tree, id).san)
      .filter(Boolean);
    expect(sans).toContain('e4');
    expect(sans).toContain('d4');
    expect(sans).toContain('d5');
    expect(sans).toContain('c4');
    expect(getNode(tree, tree.rootId).children).toHaveLength(2);
  });

  it('skips an illegal move without discarding the rest of the game', () => {
    const tree = gameToTree(parsePgn('1. e4 e5 2. Qxf7 Nf6 3. Nf3 *')[0]!);
    const sans = collectSubtree(tree, tree.rootId)
      .map((id) => getNode(tree, id).san)
      .filter(Boolean);
    expect(sans).toEqual(['e4', 'e5']);
  });
});
