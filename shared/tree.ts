import { Chess, normalizeMove } from 'chessops/chess';
import { makeFen, parseFen, INITIAL_FEN } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { chessgroundDests } from 'chessops/compat';
import { makeUci, parseUci } from 'chessops/util';
import type { Move } from 'chessops/types';
import type { MoveNode, MoveTree, NodeId } from './types.ts';

export { INITIAL_FEN };

let counter = 0;
/** Monotonic ids; unique per process, which is all a local vault needs. */
const nextId = (): NodeId => `n${(++counter).toString(36)}`;

export function createTree(initialFen: string = INITIAL_FEN): MoveTree {
  const rootId = nextId();
  const root: MoveNode = {
    id: rootId,
    parentId: null,
    fen: initialFen,
    ply: 0,
    children: [],
    nags: [],
    shapes: [],
  };
  return { rootId, nodes: { [rootId]: root }, initialFen };
}

export function getNode(tree: MoveTree, id: NodeId): MoveNode {
  const node = tree.nodes[id];
  if (!node) throw new Error(`node ${id} not in tree`);
  return node;
}

/** Rebuild a chessops position from a node's FEN. Throws on an invalid FEN. */
export function positionAt(tree: MoveTree, id: NodeId): Chess {
  const fen = getNode(tree, id).fen;
  return parseFen(fen).chain((setup) => Chess.fromSetup(setup)).unwrap();
}

/**
 * Legal moves from a node, as a `orig -> dest[]` map for chessground.
 *
 * chessgroundDests rather than allDests, because castling has two spellings
 * and players use both: chessops encodes it as the king taking its own rook
 * (e1h1), while the square everyone actually reaches for is the one the king
 * lands on (e1g1). This offers both, and addMove settles which was meant.
 */
export function legalDests(tree: MoveTree, id: NodeId): Map<string, string[]> {
  return chessgroundDests(positionAt(tree, id));
}

export interface AddMoveResult {
  tree: MoveTree;
  nodeId: NodeId;
  /** True when the move already existed and was reused instead of branching. */
  existed: boolean;
}

/**
 * Play a move from `parentId`.
 *
 * If the move is already a child, that child is returned rather than creating a
 * duplicate branch — this is what makes replaying a known line navigate through
 * the existing tree instead of littering it with identical variations.
 */
export function addMove(tree: MoveTree, parentId: NodeId, requested: Move): AddMoveResult {
  const parent = getNode(tree, parentId);
  const pos = positionAt(tree, parentId);
  // Castling to g1 and castling to h1 are the same move; normalising here
  // means one spelling reaches the tree, so a line replays and matches
  // whichever way it was entered.
  const move = normalizeMove(pos, requested);
  const uci = makeUci(move);

  for (const childId of parent.children) {
    const child = getNode(tree, childId);
    if (child.uci === uci) return { tree, nodeId: childId, existed: true };
  }

  // Legality has to be checked up front: makeSanAndPlay plays the move
  // unconditionally and would happily corrupt the tree with an illegal one.
  if (!pos.isLegal(move)) throw new Error(`illegal move ${uci} from ${parent.fen}`);

  // makeSanAndPlay mutates `pos`, giving us SAN and the resulting FEN in one go.
  const san = makeSanAndPlay(pos, move);

  const id = nextId();
  const node: MoveNode = {
    id,
    parentId,
    san,
    uci,
    fen: makeFen(pos.toSetup()),
    ply: parent.ply + 1,
    children: [],
    nags: [],
    shapes: [],
  };

  return {
    tree: {
      ...tree,
      nodes: {
        ...tree.nodes,
        [id]: node,
        [parentId]: { ...parent, children: [...parent.children, id] },
      },
    },
    nodeId: id,
    existed: false,
  };
}

/** Play a move given in SAN. Returns `undefined` if the SAN is illegal here. */
export function addSan(
  tree: MoveTree,
  parentId: NodeId,
  san: string,
): AddMoveResult | undefined {
  const move = parseSan(positionAt(tree, parentId), san);
  return move ? addMove(tree, parentId, move) : undefined;
}

/** Play a move given in UCI. Returns `undefined` if it isn't legal here. */
export function addUci(
  tree: MoveTree,
  parentId: NodeId,
  uci: string,
): AddMoveResult | undefined {
  const move = parseUci(uci);
  if (!move) return undefined;
  const pos = positionAt(tree, parentId);
  return pos.isLegal(move) ? addMove(tree, parentId, move) : undefined;
}

/** Ids from the root down to `id`, inclusive. */
export function pathTo(tree: MoveTree, id: NodeId): NodeId[] {
  const path: NodeId[] = [];
  let cursor: NodeId | null = id;
  while (cursor) {
    path.push(cursor);
    cursor = getNode(tree, cursor).parentId;
  }
  return path.reverse();
}

/** The mainline from a node forward, following `children[0]` each time. */
export function mainlineFrom(tree: MoveTree, id: NodeId): NodeId[] {
  const line: NodeId[] = [];
  let cursor = getNode(tree, id);
  while (cursor.children.length > 0) {
    const nextId = cursor.children[0]!;
    line.push(nextId);
    cursor = getNode(tree, nextId);
  }
  return line;
}

/** Every id in the subtree rooted at `id`, depth-first, `id` included. */
export function collectSubtree(tree: MoveTree, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack: NodeId[] = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    out.push(current);
    // Reversed so the mainline is visited first.
    stack.push(...[...getNode(tree, current).children].reverse());
  }
  return out;
}

/** Delete a node and everything under it. The root cannot be deleted. */
export function deleteSubtree(tree: MoveTree, id: NodeId): MoveTree {
  const node = getNode(tree, id);
  if (node.parentId === null) throw new Error('cannot delete the root node');

  const doomed = new Set(collectSubtree(tree, id));
  const nodes: Record<NodeId, MoveNode> = {};
  for (const [key, value] of Object.entries(tree.nodes)) {
    if (!doomed.has(key)) nodes[key] = value;
  }
  const parent = nodes[node.parentId]!;
  nodes[node.parentId] = {
    ...parent,
    children: parent.children.filter((c) => c !== id),
  };
  return { ...tree, nodes };
}

/** Make `id` the first child of its parent, i.e. the mainline continuation. */
export function promoteToMainline(tree: MoveTree, id: NodeId): MoveTree {
  const nodes = { ...tree.nodes };
  let cursor = getNode(tree, id);

  // Walk to the root, hoisting at every level. Promoting a deep variation has
  // to lift each ancestor too, or the line still wouldn't be the mainline.
  while (cursor.parentId !== null) {
    const parent = nodes[cursor.parentId]!;
    if (parent.children[0] !== cursor.id) {
      nodes[parent.id] = {
        ...parent,
        children: [cursor.id, ...parent.children.filter((c) => c !== cursor.id)],
      };
    }
    cursor = nodes[parent.id]!;
  }
  return { ...tree, nodes };
}

/** Move `id` one place earlier among its siblings. */
export function promoteVariation(tree: MoveTree, id: NodeId): MoveTree {
  const node = getNode(tree, id);
  if (node.parentId === null) return tree;
  const parent = getNode(tree, node.parentId);
  const index = parent.children.indexOf(id);
  if (index <= 0) return tree;
  const children = [...parent.children];
  children[index - 1] = id;
  children[index] = parent.children[index - 1]!;
  return {
    ...tree,
    nodes: { ...tree.nodes, [parent.id]: { ...parent, children } },
  };
}

/** Shallow-merge changes into one node. */
export function updateNode(
  tree: MoveTree,
  id: NodeId,
  patch: Partial<Omit<MoveNode, 'id' | 'parentId' | 'children' | 'fen' | 'ply'>>,
): MoveTree {
  const node = getNode(tree, id);
  return { ...tree, nodes: { ...tree.nodes, [id]: { ...node, ...patch } } };
}

/** Standard chess move-number label, e.g. ply 1 -> `1.`, ply 2 -> `1...`. */
export function moveNumberLabel(ply: number, blackFirst = false): string {
  const effective = ply + (blackFirst ? 1 : 0);
  const moveNumber = Math.ceil(effective / 2);
  return effective % 2 === 1 ? `${moveNumber}.` : `${moveNumber}...`;
}

/**
 * True when the root position has Black to move — every ply-parity
 * computation (move numbers, White/Black table columns) must shift by one
 * for such trees, or Black's moves land in White's column.
 */
export function blackToMoveAtRoot(tree: MoveTree): boolean {
  return getNode(tree, tree.rootId).fen.split(' ')[1] === 'b';
}

/** True when `id` is on the mainline all the way back to the root. */
export function isOnMainline(tree: MoveTree, id: NodeId): boolean {
  let cursor = getNode(tree, id);
  while (cursor.parentId !== null) {
    const parent = getNode(tree, cursor.parentId);
    if (parent.children[0] !== cursor.id) return false;
    cursor = parent;
  }
  return true;
}
