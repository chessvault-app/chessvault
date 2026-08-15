import { describe, expect, it } from 'vitest';
import { createLayout, createLiveSim, layoutGraph } from './graph';
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

describe('createLiveSim', () => {
  /** The settled layout, as the canvas hands it to a drag. */
  const settled = () => {
    const graph = layoutGraph(sample());
    const start = new Map(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    return { graph, start };
  };

  const haul = (id: string, by: { x: number; y: number }, frames: number) => {
    const { graph, start } = settled();
    const sim = createLiveSim(graph.nodes, graph.edges, start);
    const from = start.get(id)!;
    const to = { x: from.x + by.x, y: from.y + by.y };
    sim.pin(id, to);
    for (let n = 0; n < frames; n += 1) sim.step();
    return { start, end: sim.positions(), sim };
  };

  it('places a held node immediately, before any frame runs', () => {
    // A flick that presses, moves and releases inside one frame must
    // still move the dot: pinning has to place it, not merely mark it.
    const { graph, start } = settled();
    const sim = createLiveSim(graph.nodes, graph.edges, start);
    const from = start.get('e4')!;
    sim.pin('e4', { x: from.x + 250, y: from.y - 90 });
    sim.pin('e4', null);
    const at = sim.positions().get('e4')!;
    expect(at.x).toBeCloseTo(from.x + 250, 6);
    expect(at.y).toBeCloseTo(from.y - 90, 6);
  });

  it('holds the dragged node exactly where the hand put it', () => {
    const { start, end } = haul('e4', { x: 400, y: 0 }, 40);
    expect(end.get('e4')!.x).toBeCloseTo(start.get('e4')!.x + 400, 6);
    expect(end.get('e4')!.y).toBeCloseTo(start.get('e4')!.y, 6);
  });

  it('drags the held node’s children along with it', () => {
    // The whole point: e4's children must follow it across the map
    // rather than staying put while one bead slides along a wire.
    const { start, end } = haul('e4', { x: 400, y: 0 }, 60);
    for (const child of ['c5', 'e5', 'e6']) {
      const moved = end.get(child)!.x - start.get(child)!.x;
      expect(moved).toBeGreaterThan(60);
    }
  });

  it('pulls a near branch harder than a far one', () => {
    const { start, end } = haul('e4', { x: 400, y: 0 }, 60);
    const travelled = (id: string): number =>
      Math.hypot(end.get(id)!.x - start.get(id)!.x, end.get(id)!.y - start.get(id)!.y);
    // e6 hangs off e4; d4 hangs off e6, one spring further away.
    expect(travelled('e6')).toBeGreaterThan(travelled('d4'));
    // And the other half of the tree barely notices.
    expect(travelled('e6')).toBeGreaterThan(travelled('d5'));
  });

  it('coasts to a stop once the hand lets go', () => {
    const { sim } = haul('e4', { x: 400, y: 0 }, 30);
    sim.pin('e4', null);
    let frames = 0;
    while (sim.step() && frames < 4000) frames += 1;
    expect(frames).toBeLessThan(4000);
    for (const at of sim.positions().values()) {
      expect(Number.isFinite(at.x)).toBe(true);
      expect(Number.isFinite(at.y)).toBe(true);
    }
  });

  it('never reports itself asleep while a node is still held', () => {
    const { graph, start } = settled();
    const sim = createLiveSim(graph.nodes, graph.edges, start);
    sim.pin('e4', start.get('e4')!);
    // Even with nothing moving, a held node keeps the loop alive — a
    // finger that pauses mid-drag must not end the simulation under it.
    for (let n = 0; n < 500; n += 1) expect(sim.step()).toBe(true);
  });

  it('survives a yank far outside the map without flinging anything to infinity', () => {
    const { start, end } = haul('c5', { x: 90_000, y: -90_000 }, 200);
    for (const [id, at] of end) {
      expect(Number.isFinite(at.x)).toBe(true);
      expect(Number.isFinite(at.y)).toBe(true);
      if (id === 'c5') continue;
      // Everything not being held stays within a sane orbit of where it
      // began — the springs stretch, they do not teleport.
      expect(Math.hypot(at.x - start.get(id)!.x, at.y - start.get(id)!.y)).toBeLessThan(90_000);
    }
  });

  it('leaves a map nobody has touched exactly where it was', () => {
    const { graph, start } = settled();
    const sim = createLiveSim(graph.nodes, graph.edges, start);
    sim.step();
    for (const [id, at] of sim.positions()) {
      // The settled layout is already at rest, so one idle frame must not
      // shuffle it: a drag is what moves the map, not the mere act of
      // starting a simulation over it.
      expect(Math.hypot(at.x - start.get(id)!.x, at.y - start.get(id)!.y)).toBeLessThan(3);
    }
  });
});
