import { describe, expect, it } from 'vitest';
import { COL_W, layoutMap, NODE_H, NODE_W, ROW_H } from './layout';
import type { MapNode } from './model';

const leaf = (id: string): MapNode => ({ id, san: 'x', children: [] });

describe('layoutMap', () => {
  it('lays a single line on one row', () => {
    const root: MapNode = {
      id: 'root',
      children: [{ id: 'a', san: 'e4', children: [leaf('b')] }],
    };
    const { nodes, width, height } = layoutMap(root);
    const ys = new Set(nodes.map((n) => n.y));
    expect(ys.size).toBe(1);
    expect(nodes.map((n) => n.x)).toEqual([16, 16 + COL_W, 16 + 2 * COL_W]);
    expect(width).toBe(32 + 2 * COL_W + NODE_W);
    expect(height).toBe(32 + NODE_H);
  });

  it('gives leaves successive rows and parents the mean of their children', () => {
    const root: MapNode = {
      id: 'root',
      children: [leaf('a'), { id: 'b', san: 'd4', children: [leaf('c'), leaf('d')] }],
    };
    const { nodes, edges, height } = layoutMap(root);
    const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect([at.a!.y, at.c!.y, at.d!.y]).toEqual([16, 16 + ROW_H, 16 + 2 * ROW_H]);
    expect(at.b!.y).toBe((at.c!.y + at.d!.y) / 2);
    expect(at.root!.y).toBe((at.a!.y + at.b!.y) / 2);
    expect(height).toBe(32 + 2 * ROW_H + NODE_H);
    expect(edges).toContainEqual({ from: 'b', to: 'c' });
    expect(edges).toHaveLength(4);
  });

  it('lists every parent before any of its children', () => {
    const root: MapNode = {
      id: 'root',
      children: [{ id: 'a', san: 'e4', children: [leaf('b'), leaf('c')] }, leaf('d')],
    };
    const order = layoutMap(root).nodes.map((n) => n.id);
    expect(order.indexOf('root')).toBe(0);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
  });

  it('handles an empty map', () => {
    const { nodes, edges, height } = layoutMap({ id: 'root', children: [] });
    expect(nodes).toEqual([{ id: 'root', x: 16, y: 16 }]);
    expect(edges).toEqual([]);
    expect(height).toBe(32 + NODE_H);
  });
});
