import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { addSan, createTree, getNode, INITIAL_FEN } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';

/**
 * The opening map's pure half: the stored document and the facts derived
 * from it.
 *
 * The document is the skeleton the user placed by hand — moves as nested
 * children, identified by their SAN path from the start position, with
 * studies and notes tagged on. Positions are never stored; resolveMap
 * replays the SANs through a scratch MoveTree at load, which both derives
 * every node's FEN and yields a real tree to hand to the analysis board.
 * A SAN that fails to replay (a hand-edited file, a schema from the
 * future) marks its node and subtree invalid instead of throwing: the map
 * must open so the damage can be seen and repaired.
 */

export type MapColor = 'white' | 'black';
export type TagKind = 'study' | 'note' | 'game';

export interface MapTag {
  kind: TagKind;
  /** Vault-relative document id, e.g. "Openings/Alapin". */
  id: string;
  /** Chapter name (studies only); covers its sub-chapters. */
  chapter?: string;
}

export interface MapNode {
  id: string;
  /** Absent on a root node, exactly one move everywhere else. */
  san?: string;
  /** Manual name; absent means the opening catalogue names the node. */
  name?: string;
  note?: string;
  /** Intended preparation depth, in full moves. */
  depth?: number;
  tags?: MapTag[];
  children: MapNode[];
}

export interface OpeningMap {
  id: string;
  color: MapColor;
  name?: string;
  root: MapNode;
}

export interface MapDoc {
  version: 1;
  maps: OpeningMap[];
}

export const emptyDoc = (): MapDoc => ({ version: 1, maps: [] });

/** Short random id; uniqueness only matters within one document. */
export const newId = (): string => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/** The two standing maps, created lazily the first time the view loads. */
export function ensureMaps(doc: MapDoc): MapDoc {
  const missing = (['white', 'black'] as const).filter(
    (color) => !doc.maps.some((m) => m.color === color),
  );
  if (missing.length === 0) return doc;
  return {
    ...doc,
    maps: [
      ...doc.maps,
      ...missing.map((color) => ({ id: newId(), color, root: { id: newId(), children: [] } })),
    ],
  };
}

// ---------------------------------------------------------------- resolve

export interface ResolvedNode {
  mapNode: MapNode;
  parentId: string | null;
  /** Plies from the start position; the root is 0. */
  ply: number;
  /** SANs from the start position to this node, inclusive. */
  path: string[];
  /** Position after the node's move; null when its SAN failed to replay. */
  fen: string | null;
  /** The scratch tree's node backing this map node, when valid. */
  treeId: NodeId | null;
}

export interface ResolvedMap {
  /** Derived facts per map node, keyed by node id, parent before child. */
  nodes: ReadonlyMap<string, ResolvedNode>;
  /** Scratch MoveTree mirroring the valid part of the map. */
  tree: MoveTree;
}

export function resolveMap(map: OpeningMap): ResolvedMap {
  const nodes = new Map<string, ResolvedNode>();
  let tree = createTree(INITIAL_FEN);
  nodes.set(map.root.id, {
    mapNode: map.root,
    parentId: null,
    ply: 0,
    path: [],
    fen: INITIAL_FEN,
    treeId: tree.rootId,
  });

  const walk = (parent: MapNode, parentTreeId: NodeId | null): void => {
    const parentFacts = nodes.get(parent.id)!;
    for (const child of parent.children) {
      const added =
        parentTreeId !== null && child.san ? addSan(tree, parentTreeId, child.san) : undefined;
      if (added) tree = added.tree;
      const treeId = added ? added.nodeId : null;
      nodes.set(child.id, {
        mapNode: child,
        parentId: parent.id,
        ply: parentFacts.ply + 1,
        path: child.san ? [...parentFacts.path, child.san] : parentFacts.path,
        fen: treeId ? getNode(tree, treeId).fen : null,
        treeId,
      });
      walk(child, treeId);
    }
  };
  walk(map.root, tree.rootId);
  return { nodes, tree };
}

/**
 * A typed move checked against a position: the canonical SAN when it is
 * legal there, null otherwise. Canonical, because the file stores what
 * chessops would print — "Nf3" typed as "ngf3" must not create a sibling
 * of the "Nf3" a study derives.
 */
export function normalizeSan(fen: string, input: string): string | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return null;
  const move = parseSan(pos.value, input.trim());
  return move ? makeSanAndPlay(pos.value, move) : null;
}

// ------------------------------------------------------------------ edits

/** Replace the node with `id` inside `root` via `fn`; null when absent. */
const editNode = (root: MapNode, id: string, fn: (n: MapNode) => MapNode): MapNode | null => {
  if (root.id === id) return fn(root);
  for (let i = 0; i < root.children.length; i += 1) {
    const replaced = editNode(root.children[i]!, id, fn);
    if (replaced) {
      // A no-op edit must not rebuild the spine: reference equality is how
      // callers (and the store's dirty check) see that nothing changed.
      if (replaced === root.children[i]) return root;
      const children = [...root.children];
      children[i] = replaced;
      return { ...root, children };
    }
  }
  return null;
};

const editMap = (doc: MapDoc, mapId: string, fn: (root: MapNode) => MapNode | null): MapDoc => {
  const map = doc.maps.find((m) => m.id === mapId);
  if (!map) return doc;
  const root = fn(map.root);
  if (!root || root === map.root) return doc;
  return { ...doc, maps: doc.maps.map((m) => (m.id === mapId ? { ...m, root } : m)) };
};

/**
 * Add a move under a node. The SAN must already be validated (legal from
 * the parent's position) by the caller; the model only keeps siblings
 * unique, returning the document unchanged when the move is already there.
 */
export function addChild(doc: MapDoc, mapId: string, parentId: string, san: string): MapDoc {
  return editMap(doc, mapId, (root) =>
    editNode(root, parentId, (parent) =>
      parent.children.some((c) => c.san === san)
        ? parent
        : { ...parent, children: [...parent.children, { id: newId(), san, children: [] }] },
    ),
  );
}

/**
 * Ensure a whole line of SANs from the root exists, creating what is
 * missing and reusing what is there — how a seeded repertoire folds into
 * a map that may already chart part of it. SANs must be canonical (they
 * come from replay, never from typing).
 */
export function chartLine(doc: MapDoc, mapId: string, sans: string[]): MapDoc {
  return editMap(doc, mapId, (root) => {
    const grow = (node: MapNode, at: number): MapNode => {
      if (at >= sans.length) return node;
      const existing = node.children.find((c) => c.san === sans[at]);
      if (existing) {
        const grown = grow(existing, at + 1);
        if (grown === existing) return node;
        return { ...node, children: node.children.map((c) => (c === existing ? grown : c)) };
      }
      let tail: MapNode | null = null;
      for (let k = sans.length - 1; k >= at; k -= 1) {
        tail = { id: newId(), san: sans[k]!, children: tail ? [tail] : [] };
      }
      return { ...node, children: [...node.children, tail!] };
    };
    return grow(root, 0);
  });
}

/** Set or clear (via undefined) a node's name, note, or depth. */
export function updateFields(
  doc: MapDoc,
  mapId: string,
  nodeId: string,
  patch: Partial<Pick<MapNode, 'name' | 'note' | 'depth'>>,
): MapDoc {
  return editMap(doc, mapId, (root) =>
    editNode(root, nodeId, (node) => {
      const next = { ...node, ...patch };
      for (const key of ['name', 'note', 'depth'] as const) {
        if (next[key] === undefined) delete next[key];
      }
      return next;
    }),
  );
}

const sameTag = (a: MapTag, b: MapTag): boolean =>
  a.kind === b.kind && a.id === b.id && (a.chapter ?? '') === (b.chapter ?? '');

export function addTag(doc: MapDoc, mapId: string, nodeId: string, tag: MapTag): MapDoc {
  return editMap(doc, mapId, (root) =>
    editNode(root, nodeId, (node) =>
      (node.tags ?? []).some((t) => sameTag(t, tag))
        ? node
        : { ...node, tags: [...(node.tags ?? []), tag] },
    ),
  );
}

export function removeTag(doc: MapDoc, mapId: string, nodeId: string, tag: MapTag): MapDoc {
  return editMap(doc, mapId, (root) =>
    editNode(root, nodeId, (node) => {
      const tags = (node.tags ?? []).filter((t) => !sameTag(t, tag));
      const next = { ...node };
      if (tags.length > 0) next.tags = tags;
      else delete next.tags;
      return next;
    }),
  );
}

/** Delete a node and everything under it. The root cannot be deleted. */
export function deleteNode(doc: MapDoc, mapId: string, nodeId: string): MapDoc {
  return editMap(doc, mapId, (root) => {
    if (root.id === nodeId) return root;
    const prune = (node: MapNode): MapNode => {
      if (!node.children.some((c) => c.id === nodeId)) {
        const children = node.children.map(prune);
        return children.every((c, i) => c === node.children[i]) ? node : { ...node, children };
      }
      return { ...node, children: node.children.filter((c) => c.id !== nodeId) };
    };
    return prune(root);
  });
}
