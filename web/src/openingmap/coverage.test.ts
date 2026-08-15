import { describe, expect, it } from 'vitest';
import { addSan, createTree } from '@shared/tree';
import type { Chapter } from '@shared/types';
import { collectStudyTags, computeCoverage, scopedChapters } from './coverage';
import { resolveMap, type OpeningMap } from './model';

/** A chapter holding the given lines, shared prefixes merged. */
const chapterOf = (name: string, lines: string[][]): Chapter => {
  let tree = createTree();
  for (const line of lines) {
    let cursor = tree.rootId;
    for (const san of line) {
      const added = addSan(tree, cursor, san);
      if (!added) throw new Error(`bad test SAN ${san}`);
      tree = added.tree;
      cursor = added.nodeId;
    }
  }
  return { id: name, name, tree, headers: {} };
};

const mapWith = (rootChildren: OpeningMap['root']['children']): OpeningMap => ({
  id: 'w1',
  color: 'white',
  root: { id: 'root', children: rootChildren },
});

describe('collectStudyTags', () => {
  it('collects study tags across the tree, dedupes, ignores notes', () => {
    const map = mapWith([
      {
        id: 'e4',
        san: 'e4',
        tags: [
          { kind: 'study', id: 'A' },
          { kind: 'note', id: 'ideas/e4' },
        ],
        children: [
          {
            id: 'c5',
            san: 'c5',
            tags: [
              { kind: 'study', id: 'A' },
              { kind: 'study', id: 'A', chapter: 'Main' },
            ],
            children: [],
          },
        ],
      },
    ]);
    expect(collectStudyTags(map)).toEqual([
      { kind: 'study', id: 'A' },
      { kind: 'study', id: 'A', chapter: 'Main' },
    ]);
  });
});

describe('scopedChapters', () => {
  it('a chapter tag covers the chapter and its sub-chapters, once', () => {
    const chapters = [
      chapterOf('Main', [['e4']]),
      chapterOf('Main/Deep', [['e4']]),
      chapterOf('Anti', [['d4']]),
    ];
    const studies = new Map([['S', chapters]]);
    const scoped = scopedChapters([{ kind: 'study', id: 'S', chapter: 'Main' }], studies);
    expect(scoped.map((c) => c.name)).toEqual(['Main', 'Main/Deep']);
    // the whole study plus one chapter reaches every chapter exactly once
    const both = scopedChapters(
      [
        { kind: 'study', id: 'S' },
        { kind: 'study', id: 'S', chapter: 'Main' },
      ],
      studies,
    );
    expect(both.map((c) => c.name)).toEqual(['Main', 'Main/Deep', 'Anti']);
    // a vanished study contributes nothing
    expect(scopedChapters([{ kind: 'study', id: 'gone' }], studies)).toEqual([]);
  });
});

describe('computeCoverage', () => {
  it('merges several studies tagged on one node into a union', () => {
    const map = mapWith([
      {
        id: 'e4',
        san: 'e4',
        children: [
          {
            id: 'c5',
            san: 'c5',
            tags: [
              { kind: 'study', id: 'A' },
              { kind: 'study', id: 'B' },
            ],
            children: [],
          },
        ],
      },
    ]);
    const studies = new Map([
      ['A', [chapterOf('A', [['e4', 'c5', 'Nf3', 'd6']])]],
      ['B', [chapterOf('B', [['e4', 'c5', 'c3', 'Nf6']])]],
    ]);
    const chapters = scopedChapters(collectStudyTags(map), studies);
    const cov = computeCoverage(resolveMap(map), chapters);

    const c5 = cov.get('c5')!;
    expect(c5.covered).toBe(true);
    expect(c5.preparedMoves).toEqual(['Nf3', 'c3']);
    expect(c5.preparedPlies).toBe(2);
    expect(c5.lineCount).toBe(2);
    // a parent's numbers include everything beneath it
    const e4 = cov.get('e4')!;
    expect(e4.preparedMoves).toEqual(['c5']);
    expect(e4.preparedPlies).toBe(3);
    expect(e4.lineCount).toBe(2);
  });

  it('a transposition counts one line, not a loop', () => {
    // Two move orders into the same position: 1.d4 first or 1.c4 first.
    const map = mapWith([]);
    const chapters = [
      chapterOf('Indian', [
        ['d4', 'Nf6', 'c4', 'e6', 'Nc3'],
        ['c4', 'Nf6', 'd4', 'e6', 'Nc3'],
      ]),
    ];
    const cov = computeCoverage(resolveMap(map), chapters);
    const root = cov.get('root')!;
    expect(root.preparedPlies).toBe(5);
    expect(root.lineCount).toBe(1);
  });

  it('an untagged map has no coverage anywhere', () => {
    const map = mapWith([
      { id: 'e4', san: 'e4', tags: [{ kind: 'note', id: 'ideas/e4' }], children: [] },
    ]);
    const cov = computeCoverage(resolveMap(map), scopedChapters(collectStudyTags(map), new Map()));
    expect(cov.get('e4')).toEqual({
      covered: false,
      preparedMoves: [],
      preparedPlies: 0,
      lineCount: 0,
      reviewCount: 0,
      gapCount: 0,
    });
  });

  it('drill marks are counted over the same walk, parents including children', () => {
    const map = mapWith([
      { id: 'e4', san: 'e4', tags: [{ kind: 'study', id: 'A' }], children: [] },
    ]);
    const chapters = [chapterOf('A', [['e4', 'c5', 'Nf3', 'd6']])];
    // Mark the position after 2.Nf3 as fumbled and after 1...c5 as a gap,
    // keyed the drill's way.
    let tree = createTree();
    let cursor = tree.rootId;
    const keys: string[] = [];
    for (const san of ['e4', 'c5', 'Nf3']) {
      const added = addSan(tree, cursor, san)!;
      tree = added.tree;
      cursor = added.nodeId;
      keys.push(tree.nodes[cursor]!.fen.split(' ').slice(0, 4).join(' '));
    }
    const marks = { review: new Set([keys[2]!]), gaps: new Set([keys[1]!]) };
    const cov = computeCoverage(resolveMap(map), chapters, marks);
    const e4 = cov.get('e4')!;
    expect(e4.reviewCount).toBe(1);
    expect(e4.gapCount).toBe(1);
    // The root's numbers include everything beneath it.
    expect(cov.get('root')!.reviewCount).toBe(1);
  });

  it('a node off the studies\' paths is uncovered while its siblings are not', () => {
    const map = mapWith([
      { id: 'e4', san: 'e4', tags: [{ kind: 'study', id: 'A' }], children: [] },
      { id: 'd4', san: 'd4', children: [] },
    ]);
    const studies = new Map([['A', [chapterOf('A', [['e4', 'e5']])]]]);
    const cov = computeCoverage(resolveMap(map), scopedChapters(collectStudyTags(map), studies));
    expect(cov.get('e4')!.covered).toBe(true);
    expect(cov.get('d4')!.covered).toBe(false);
  });
});
