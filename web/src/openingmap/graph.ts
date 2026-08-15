import type { MapNode } from './model';

/**
 * The map as a constellation — the graph-view look the vault's Obsidian
 * ancestry promises: circles sized by what hangs beneath them, springs
 * along the edges, everything else pushing apart.
 *
 * Force-directed but deterministic: nodes are seeded on a radial fan
 * (depth = ring, siblings share their parent's angular sector in
 * proportion to their leaf counts) and then relaxed with plain
 * Fruchterman–Reingold forces under a cooling step. No randomness
 * anywhere, so the same map always settles into the same shape and a
 * one-node edit nudges the picture instead of reshuffling it.
 */

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  /** Circle radius, from the subtree's weight. */
  r: number;
}

export interface MapGraph {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
  /** Content bounds, radii and label room included. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const RING = 120;
const ITERATIONS = 220;

/**
 * The simulation behind layoutGraph, exposed a step at a time so the
 * canvas can PLAY the settling as its load animation — the constellation
 * blooming out of the radial seed is the layout being computed, not a
 * transition drawn over it. Stepping in chunks reaches exactly the state
 * one big step reaches (there is no randomness to diverge).
 */
export interface LayoutSim {
  /** Advance up to `iterations`; no-ops once settled. */
  step: (iterations: number) => void;
  done: () => boolean;
  snapshot: () => MapGraph;
}

export function createLayout(root: MapNode): LayoutSim {
  interface Body {
    id: string;
    x: number;
    y: number;
    r: number;
    parent: number | null;
  }
  const bodies: Body[] = [];
  const leaves = new Map<MapNode, number>();
  const countLeaves = (node: MapNode): number => {
    const n =
      node.children.length === 0
        ? 1
        : node.children.reduce((sum, child) => sum + countLeaves(child), 0);
    leaves.set(node, n);
    return n;
  };
  countLeaves(root);
  const descendants = (node: MapNode): number =>
    node.children.reduce((sum, child) => sum + 1 + descendants(child), 0);

  // Radial seed: each node gets a slice of its parent's sector, wide in
  // proportion to the leaves it must eventually fan out into.
  const seed = (node: MapNode, depth: number, from: number, to: number, parent: number | null): void => {
    const angle = (from + to) / 2;
    const at = bodies.length;
    bodies.push({
      id: node.id,
      x: depth === 0 ? 0 : Math.cos(angle) * depth * RING,
      y: depth === 0 ? 0 : Math.sin(angle) * depth * RING,
      r: 5 + 2.5 * Math.sqrt(descendants(node) + 1),
      parent,
    });
    let cursor = from;
    for (const child of node.children) {
      const width = ((to - from) * leaves.get(child)!) / leaves.get(node)!;
      seed(child, depth + 1, cursor, cursor + width, at);
      cursor += width;
    }
  };
  // A root with one child would collapse its sector to a line pointing
  // right every time — fine; the fan is for breadth, not for style.
  seed(root, 0, -Math.PI / 2, (3 * Math.PI) / 2, null);

  // Relax. Repulsion between NEARBY pairs, springs along the edges, and
  // a whisper of gravity so a lone branch cannot drift away forever.
  // The cutoff is what keeps a big map legible: global repulsion scales
  // with n and lets far branches shove each other across the picture
  // until the radial seed's order is gone — measured as a 71-node
  // hairball. Local repulsion resolves spacing where dots actually
  // crowd and leaves the seed's geography standing.
  const k = 90;
  const CUTOFF2 = (3 * k) * (3 * k);
  let at0 = 0;
  const relax = (): void => {
    const heat = (1 - at0 / ITERATIONS) * 10 + 2;
    const fx = new Array<number>(bodies.length).fill(0);
    const fy = new Array<number>(bodies.length).fill(0);
    for (let a = 0; a < bodies.length; a += 1) {
      for (let b = a + 1; b < bodies.length; b += 1) {
        let dx = bodies[a]!.x - bodies[b]!.x;
        let dy = bodies[a]!.y - bodies[b]!.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > CUTOFF2) continue;
        if (d2 < 0.01) {
          // Coincident points push apart along a deterministic direction.
          dx = 0.1 * (a - b);
          dy = 0.05;
          d2 = dx * dx + dy * dy;
        }
        const push = (k * k) / d2;
        fx[a]! += dx * push;
        fy[a]! += dy * push;
        fx[b]! -= dx * push;
        fy[b]! -= dy * push;
      }
    }
    for (let at = 0; at < bodies.length; at += 1) {
      const parent = bodies[at]!.parent;
      if (parent === null) continue;
      const dx = bodies[at]!.x - bodies[parent]!.x;
      const dy = bodies[at]!.y - bodies[parent]!.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const rest = bodies[at]!.r + bodies[parent]!.r + 58;
      const pull = (1.6 * (dist - rest)) / dist;
      fx[at]! -= dx * pull;
      fy[at]! -= dy * pull;
      fx[parent]! += dx * pull;
      fy[parent]! += dy * pull;
    }
    for (let at = 0; at < bodies.length; at += 1) {
      fx[at]! -= bodies[at]!.x * 0.02;
      fy[at]! -= bodies[at]!.y * 0.02;
      const size = Math.sqrt(fx[at]! * fx[at]! + fy[at]! * fy[at]!) || 1;
      const stepSize = Math.min(size, heat);
      bodies[at]!.x += (fx[at]! / size) * stepSize;
      bodies[at]!.y += (fy[at]! / size) * stepSize;
    }
  };

  const edges: MapGraph['edges'] = [];
  for (const body of bodies) {
    if (body.parent !== null) edges.push({ from: bodies[body.parent]!.id, to: body.id });
  }
  const PAD = 40;

  return {
    step: (iterations: number) => {
      for (let n = 0; n < iterations && at0 < ITERATIONS; n += 1) {
        relax();
        at0 += 1;
      }
    },
    done: () => at0 >= ITERATIONS,
    snapshot: () => ({
      nodes: bodies.map(({ id, x, y, r }) => ({ id, x, y, r })),
      edges: [...edges],
      minX: Math.min(...bodies.map((b) => b.x - b.r)) - PAD,
      minY: Math.min(...bodies.map((b) => b.y - b.r)) - PAD,
      maxX: Math.max(...bodies.map((b) => b.x + b.r)) + PAD,
      maxY: Math.max(...bodies.map((b) => b.y + b.r)) + PAD,
    }),
  };
}

export function layoutGraph(root: MapNode): MapGraph {
  const sim = createLayout(root);
  sim.step(ITERATIONS);
  return sim.snapshot();
}

/**
 * The live simulation a DRAG runs on, which is a different animal from
 * the layout above.
 *
 * `createLayout` answers "where does this map belong", deterministically,
 * from a radial seed. This one answers "what happens if I pick that dot
 * up" — it starts from wherever the dots currently are, holds the held
 * one under the finger, and lets the rest respond. Held nodes tow their
 * children, the children tow theirs, and crowding pushes back, so a drag
 * reads as pulling on a web rather than sliding one bead along a wire.
 *
 * Velocity with damping rather than direct force-to-position, because the
 * feel is the feature: momentum is what makes the neighbours lag behind
 * the hand and coast to a stop after it lets go. The same springs and
 * repulsion as the layout, so a dragged map relaxes into the same kind of
 * spacing the settled one has.
 *
 * There is no pull toward the layout's home positions. A weak one was the
 * first thing tried and it reads as the map undoing your work: you drag a
 * branch clear to see under it, let go, and it creeps back. Where you put
 * things is where they stay. Only a whisper of centring gravity survives,
 * and only so a branch flung hard cannot sail off to infinity.
 */
export interface LiveSim {
  /** Hold a node at a world position; null lets go of it. */
  pin: (id: string, at: { x: number; y: number } | null) => void;
  /** Advance one frame. False once nothing is meaningfully moving. */
  step: () => boolean;
  positions: () => Map<string, { x: number; y: number }>;
}

const DAMPING = 0.82;
const SPRING = 0.09;
/** Below this top speed the constellation has stopped, in world units. */
const ASLEEP = 0.35;

export function createLiveSim(
  nodes: readonly GraphNode[],
  edges: readonly { from: string; to: string }[],
  start: ReadonlyMap<string, { x: number; y: number }>,
): LiveSim {
  interface Live {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    pinned: { x: number; y: number } | null;
  }
  const bodies: Live[] = nodes.map((n) => {
    const from = start.get(n.id);
    return { id: n.id, x: from?.x ?? n.x, y: from?.y ?? n.y, vx: 0, vy: 0, r: n.r, pinned: null };
  });
  const index = new Map(bodies.map((b, at) => [b.id, at]));
  const links = edges
    .map((e) => ({ a: index.get(e.from), b: index.get(e.to) }))
    .filter((l): l is { a: number; b: number } => l.a !== undefined && l.b !== undefined);

  const CUTOFF2 = (3 * 90) * (3 * 90);

  return {
    pin: (id, at) => {
      const body = bodies[index.get(id) ?? -1];
      if (!body) return;
      body.pinned = at;
      if (at) {
        // Placed NOW, not at the next frame. The held dot must be under
        // the finger the instant the finger moves, and a flick that
        // presses, drags and releases between two frames would otherwise
        // pin and unpin without a single step ever running — leaving the
        // node exactly where it started and the drag doing nothing.
        body.x = at.x;
        body.y = at.y;
        body.vx = 0;
        body.vy = 0;
      }
    },
    step: () => {
      const fx = new Array<number>(bodies.length).fill(0);
      const fy = new Array<number>(bodies.length).fill(0);

      for (let a = 0; a < bodies.length; a += 1) {
        for (let b = a + 1; b < bodies.length; b += 1) {
          let dx = bodies[a]!.x - bodies[b]!.x;
          let dy = bodies[a]!.y - bodies[b]!.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > CUTOFF2) continue;
          if (d2 < 0.01) {
            dx = 0.1 * (a - b);
            dy = 0.05;
            d2 = dx * dx + dy * dy;
          }
          // Capped: two dots that end up almost coincident would other-
          // wise trade an impulse big enough to throw both off-screen.
          const push = Math.min(40, (90 * 90) / d2);
          const d = Math.sqrt(d2);
          fx[a]! += (dx / d) * push;
          fy[a]! += (dy / d) * push;
          fx[b]! -= (dx / d) * push;
          fy[b]! -= (dy / d) * push;
        }
      }

      for (const { a, b } of links) {
        const dx = bodies[b]!.x - bodies[a]!.x;
        const dy = bodies[b]!.y - bodies[a]!.y;
        const dist = Math.hypot(dx, dy) || 0.1;
        const rest = bodies[a]!.r + bodies[b]!.r + 58;
        const pull = (SPRING * (dist - rest)) / dist;
        fx[a]! += dx * pull;
        fy[a]! += dy * pull;
        fx[b]! -= dx * pull;
        fy[b]! -= dy * pull;
      }

      let cx = 0;
      let cy = 0;
      for (const body of bodies) {
        cx += body.x;
        cy += body.y;
      }
      cx /= bodies.length || 1;
      cy /= bodies.length || 1;

      let fastest = 0;
      for (let at = 0; at < bodies.length; at += 1) {
        const body = bodies[at]!;
        if (body.pinned) {
          body.x = body.pinned.x;
          body.y = body.pinned.y;
          body.vx = 0;
          body.vy = 0;
          // A held node still counts as motion, or the loop would fall
          // asleep under a finger that is moving slowly.
          fastest = Math.max(fastest, ASLEEP + 1);
          continue;
        }
        fx[at]! -= (body.x - cx) * 0.0016;
        fy[at]! -= (body.y - cy) * 0.0016;
        body.vx = (body.vx + fx[at]! * 0.06) * DAMPING;
        body.vy = (body.vy + fy[at]! * 0.06) * DAMPING;
        // Terminal velocity: a spring that has been stretched across the
        // whole map must not teleport its node through everything else.
        const speed = Math.hypot(body.vx, body.vy);
        if (speed > 30) {
          body.vx = (body.vx / speed) * 30;
          body.vy = (body.vy / speed) * 30;
        }
        body.x += body.vx;
        body.y += body.vy;
        fastest = Math.max(fastest, Math.hypot(body.vx, body.vy));
      }
      return fastest > ASLEEP;
    },
    positions: () => new Map(bodies.map((b) => [b.id, { x: b.x, y: b.y }])),
  };
}
