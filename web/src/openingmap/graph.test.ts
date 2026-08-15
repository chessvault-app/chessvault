import { describe, expect, it } from 'vitest';
import { createLayout, layoutGraph } from './graph';
import type { MapNode } from './model';

const leaf = (id: string): MapNode => ({ id, san: 'x', children: [] });

const sample = (): MapNode => ({
  id: 'root',
  children: [
    {
      id: 'e4',
      san: 'e4',
      children: [leaf('c5'), leaf('e5'), { id: 'e6', san: 'e6', children: [leaf('d4')] }],
    },
    { id: 'd4r', san: 'd4', children: [leaf('d5'), leaf('nf6')] },
  ],
});

describe('layoutGraph', () => {
  it('settles every node at a finite place', () => {
    const { nodes, minX, maxX, minY, maxY } = layoutGraph(sample());
    expect(nodes).toHaveLength(9);
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.r).toBeGreaterThan(0);
    }
    expect(maxX).toBeGreaterThan(minX);
    expect(maxY).toBeGreaterThan(minY);
  });

  it('is deterministic: the same map settles into the same shape', () => {
    expect(layoutGraph(sample())).toEqual(layoutGraph(sample()));
  });

  it('keeps connected nodes closer than the crowd at large', () => {
    const graph = layoutGraph(sample());
    const at = new Map(graph.nodes.map((n) => [n.id, n]));
    const dist = (a: string, b: string): number =>
      Math.hypot(at.get(a)!.x - at.get(b)!.x, at.get(a)!.y - at.get(b)!.y);
    const edgeAvg =
      graph.edges.reduce((sum, e) => sum + dist(e.from, e.to), 0) / graph.edges.length;
    let sum = 0;
    let count = 0;
    for (const a of graph.nodes) {
      for (const b of graph.nodes) {
        if (a.id < b.id) {
          sum += Math.hypot(a.x - b.x, a.y - b.y);
          count += 1;
        }
      }
    }
    expect(edgeAvg).toBeLessThan(sum / count);
  });

  it('sizes a hub above a leaf', () => {
    const graph = layoutGraph(sample());
    const at = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(at.get('root')!.r).toBeGreaterThan(at.get('c5')!.r);
    expect(at.get('e4')!.r).toBeGreaterThan(at.get('e5')!.r);
  });

  it('stepping in chunks lands exactly where one big step lands', () => {
    const sim = createLayout(sample());
    while (!sim.done()) sim.step(7);
    expect(sim.snapshot()).toEqual(layoutGraph(sample()));
  });

  it('lays out a single-node map without dividing by zero', () => {
    const { nodes } = layoutGraph({ id: 'root', children: [] });
    expect(nodes).toHaveLength(1);
    expect(Number.isFinite(nodes[0]!.x)).toBe(true);
  });
});
