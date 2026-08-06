import type { CommentShape } from 'chessops/pgn';

export type { CommentShape };

/** Engine evaluation attached to a node. `cp` and `mate` are mutually exclusive. */
export interface NodeEval {
  /** Centipawns, always from White's point of view. */
  cp?: number;
  /** Mate distance in moves; negative means the side to move is being mated. */
  mate?: number;
  depth: number;
  /** Principal variation as UCI moves. */
  pv?: string[];
}

/**
 * One position in a game tree.
 *
 * Nodes are stored flat in a `Record<NodeId, MoveNode>` (see `MoveTree`) rather
 * than nested, so that updating a deep node doesn't require cloning the whole
 * spine — which matters because zustand compares by reference.
 */
export interface MoveNode {
  id: NodeId;
  parentId: NodeId | null;
  /** The move that produced this position. Absent only on the root. */
  san?: string;
  uci?: string;
  /** FEN of the position *after* `san` was played. */
  fen: string;
  /** Half-moves from the start of the game. Root is 0. */
  ply: number;
  /** Child ids in order; `children[0]` is the mainline continuation. */
  children: NodeId[];
  /** Free-text annotation, with shapes/eval already split out. */
  comment?: string;
  /** Comment that belongs before the move rather than after it. */
  startingComment?: string;
  /** Numeric Annotation Glyphs: 1 = `!`, 2 = `?`, 4 = `??`, etc. */
  nags: number[];
  /** Arrows and circles, round-tripped through PGN as `[%cal]`/`[%csl]`. */
  shapes: CommentShape[];
  /** Evaluation stored in the file as `[%eval]`, or filled in by the engine. */
  eval?: NodeEval;
  /** Seconds left on the mover's clock, round-tripped as `[%clk]`. */
  clock?: number;
}

export type NodeId = string;

export interface MoveTree {
  rootId: NodeId;
  nodes: Record<NodeId, MoveNode>;
  /** Starting FEN; differs from the standard one for custom positions. */
  initialFen: string;
}

/** PGN header pairs, preserved verbatim so round-trips don't lose metadata. */
export type Headers = Record<string, string>;

/** One chapter of a study — a tree plus its headers. */
export interface Chapter {
  id: string;
  name: string;
  tree: MoveTree;
  headers: Headers;
}
