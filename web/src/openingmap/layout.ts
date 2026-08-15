import type { MapNode } from './model';

/**
 * Left-to-right tree layout, the leaf-row variant: a post-order walk
 * hands each leaf the next row, a parent sits at the mean of its
 * children, and depth is the column. For an opening map's branching this
 * is indistinguishable from a full tidy-tree algorithm and stays a
 * screenful of code; coordinates are in pixels so the view draws a
 * content-sized SVG and lets the container scroll.
 */

export const COL_W = 170;
export const ROW_H = 56;
export const NODE_W = 150;
export const NODE_H = 40;
const PAD = 16;

export interface PlacedNode {
  id: string;
  /** Top-left corner of the node's box. */
  x: number;
  y: number;
}

export interface MapLayout {
  /** Parent before child, the walk's order. */
  nodes: PlacedNode[];
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

export function layoutMap(root: MapNode): MapLayout {
  const nodes: PlacedNode[] = [];
  const edges: MapLayout['edges'] = [];
  let nextRow = 0;
  let maxDepth = 0;

  const place = (node: MapNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const row =
      node.children.length === 0
        ? nextRow++
        : node.children.map((c) => place(c, depth + 1)).reduce((a, b) => a + b, 0) /
          node.children.length;
    nodes.push({ id: node.id, x: PAD + depth * COL_W, y: PAD + row * ROW_H });
    for (const child of node.children) edges.push({ from: node.id, to: child.id });
    return row;
  };
  place(root, 0);
  // Children were pushed before their parents; the view wants parents
  // underneath (drawn first) and callers get the documented order.
  nodes.reverse();
  edges.reverse();

  return {
    nodes,
    edges,
    width: PAD * 2 + maxDepth * COL_W + NODE_W,
    height: PAD * 2 + Math.max(0, nextRow - 1) * ROW_H + NODE_H,
  };
}
