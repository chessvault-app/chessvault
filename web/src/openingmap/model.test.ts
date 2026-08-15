import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from '@shared/tree';
import {
  addChild,
  addTag,
  deleteNode,
  emptyDoc,
  ensureMaps,
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
