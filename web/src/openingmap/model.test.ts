import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from '@shared/tree';
import {
  addChild,
  addTag,
  chartLine,
  deleteNode,
  emptyDoc,
  lineOnly,
  type MapNode,
  ensureMaps,
  normalizeSan,
  removeTag,
  resolveMap,
  updateFields,
  type MapDoc,
  type OpeningMap,
} from './model';

const sample = (): MapDoc => ({
  version: 1,
  maps: [
    {
      id: 'w1',
      color: 'white',
      root: {
        id: 'root',
        children: [
          {
            id: 'e4',
            san: 'e4',
            children: [
              { id: 'c5', san: 'c5', children: [] },
              { id: 'e5', san: 'e5', children: [] },
            ],
          },
        ],
      },
    },
  ],
});

describe('ensureMaps', () => {
  it('creates the two standing maps once and never again', () => {
    const once = ensureMaps(emptyDoc());
    expect(once.maps.map((m) => m.color)).toEqual(['white', 'black']);
    const twice = ensureMaps(once);
    expect(twice).toBe(once);
  });
});

describe('resolveMap', () => {
  it('derives ply, path and FEN by replaying SANs', () => {
    const { nodes } = resolveMap(sample().maps[0]!);
    expect(nodes.get('root')!.fen).toBe(INITIAL_FEN);
    const e4 = nodes.get('e4')!;
    expect(e4.ply).toBe(1);
    expect(e4.path).toEqual(['e4']);
    expect(e4.fen).toContain('4P3');
    const c5 = nodes.get('c5')!;
    expect(c5.parentId).toBe('e4');
    expect(c5.path).toEqual(['e4', 'c5']);
    expect(c5.fen!.split(' ')[1]).toBe('w');
  });

  it('flags an illegal SAN and its subtree instead of throwing', () => {
    const map: OpeningMap = {
      id: 'w1',
      color: 'white',
      root: {
        id: 'root',
        children: [
          {
            id: 'bad',
            san: 'Ke2',
            children: [{ id: 'under', san: 'e5', children: [] }],
          },
          { id: 'ok', san: 'd4', children: [] },
        ],
      },
    };
    const { nodes } = resolveMap(map);
    expect(nodes.get('bad')!.fen).toBeNull();
    expect(nodes.get('under')!.fen).toBeNull();
    expect(nodes.get('ok')!.fen).not.toBeNull();
  });

  it('mirrors the valid part into a real MoveTree', () => {
    const { nodes, tree } = resolveMap(sample().maps[0]!);
    const c5 = nodes.get('c5')!;
    expect(c5.treeId).not.toBeNull();
    expect(tree.nodes[c5.treeId!]!.san).toBe('c5');
  });
});

describe('normalizeSan', () => {
  it('canonicalises what the user typed', () => {
    expect(normalizeSan(INITIAL_FEN, 'Nf3')).toBe('Nf3');
    expect(normalizeSan(INITIAL_FEN, ' e4 ')).toBe('e4');
    expect(normalizeSan(INITIAL_FEN, 'Ke2')).toBeNull();
    expect(normalizeSan(INITIAL_FEN, 'nonsense')).toBeNull();
    expect(normalizeSan('not a fen', 'e4')).toBeNull();
  });
});

describe('edits', () => {
  it('addChild appends a move and keeps siblings unique', () => {
    const doc = sample();
    const added = addChild(doc, 'w1', 'e4', 'c6');
    expect(added).not.toBe(doc);
    const e4 = added.maps[0]!.root.children[0]!;
    expect(e4.children.map((c) => c.san)).toEqual(['c5', 'e5', 'c6']);
    // the original document is untouched
    expect(doc.maps[0]!.root.children[0]!.children).toHaveLength(2);
    // a duplicate is a no-op returning the same reference
    expect(addChild(added, 'w1', 'e4', 'c6')).toBe(added);
  });

  it('updateFields sets and clears', () => {
    let doc = updateFields(sample(), 'w1', 'c5', { name: 'Sicilian', depth: 10 });
    let c5 = doc.maps[0]!.root.children[0]!.children[0]!;
    expect(c5.name).toBe('Sicilian');
    expect(c5.depth).toBe(10);
    doc = updateFields(doc, 'w1', 'c5', { name: undefined });
    c5 = doc.maps[0]!.root.children[0]!.children[0]!;
    expect('name' in c5).toBe(false);
    expect(c5.depth).toBe(10);
  });

  it('addTag dedupes, removeTag drops the tags array when empty', () => {
    const tag = { kind: 'study' as const, id: 'Openings/Alapin' };
    let doc = addTag(sample(), 'w1', 'c5', tag);
    doc = addTag(doc, 'w1', 'c5', tag);
    let c5 = doc.maps[0]!.root.children[0]!.children[0]!;
    expect(c5.tags).toHaveLength(1);
    // the same study scoped to a chapter is a different tag
    doc = addTag(doc, 'w1', 'c5', { ...tag, chapter: 'Main line' });
    c5 = doc.maps[0]!.root.children[0]!.children[0]!;
    expect(c5.tags).toHaveLength(2);
    doc = removeTag(doc, 'w1', 'c5', { ...tag, chapter: 'Main line' });
    doc = removeTag(doc, 'w1', 'c5', tag);
    c5 = doc.maps[0]!.root.children[0]!.children[0]!;
    expect('tags' in c5).toBe(false);
  });

  it('chartLine reuses what exists and builds only the missing tail', () => {
    let doc = chartLine(sample(), 'w1', ['e4', 'c5', 'Nf3', 'd6']);
    const e4 = doc.maps[0]!.root.children[0]!;
    // e4 and c5 were already charted — reused, not duplicated.
    expect(doc.maps[0]!.root.children).toHaveLength(1);
    expect(e4.children.map((c) => c.san)).toEqual(['c5', 'e5']);
    const c5 = e4.children[0]!;
    expect(c5.children.map((c) => c.san)).toEqual(['Nf3']);
    expect(c5.children[0]!.children.map((c) => c.san)).toEqual(['d6']);
    // A fully charted line is a no-op returning the same reference.
    expect(chartLine(doc, 'w1', ['e4', 'c5'])).toBe(doc);
    // A new first move grows beside the old one.
    doc = chartLine(doc, 'w1', ['d4', 'd5']);
    expect(doc.maps[0]!.root.children.map((c) => c.san)).toEqual(['e4', 'd4']);
  });

  it('deleteNode removes a subtree but never the root', () => {
    const doc = deleteNode(sample(), 'w1', 'e4');
    expect(doc.maps[0]!.root.children).toEqual([]);
    expect(deleteNode(doc, 'w1', 'root')).toBe(doc);
  });

  it('edits aimed at a missing map or node change nothing', () => {
    const doc = sample();
    expect(addChild(doc, 'nope', 'e4', 'c6')).toBe(doc);
    expect(updateFields(doc, 'w1', 'nope', { name: 'x' })).toBe(doc);
  });
});

describe('lineOnly', () => {
  const tree = (): MapNode => ({
    id: 'root',
    children: [
      {
        id: 'e4',
        san: 'e4',
        children: [
          { id: 'c5', san: 'c5', children: [{ id: 'nf3', san: 'Nf3', children: [] }] },
          { id: 'e5', san: 'e5', children: [] },
        ],
      },
      { id: 'd4', san: 'd4', children: [] },
    ],
  });

  const ids = (node: MapNode): string[] => [
    node.id,
    ...node.children.flatMap((child) => ids(child)),
  ];

  it('keeps the moves that lead there and everything after', () => {
    // The line to c5, its continuation, and neither sibling on the way.
    expect(ids(lineOnly(tree(), 'c5'))).toEqual(['root', 'e4', 'c5', 'nf3']);
  });

  it('keeps the whole map when the line is the root', () => {
    expect(ids(lineOnly(tree(), 'root'))).toEqual(ids(tree()));
  });

  it('gives the map back when it does not hold that node', () => {
    // A node can be deleted while its line is the one on screen.
    expect(ids(lineOnly(tree(), 'nope'))).toEqual(ids(tree()));
  });

  it('leaves the map it was given alone', () => {
    const original = tree();
    const before = ids(original);
    lineOnly(original, 'c5');
    expect(ids(original)).toEqual(before);
    expect(original.children).toHaveLength(2);
  });
});
