import { create } from 'zustand';
import { parseSquare } from 'chessops/util';
import { squareRank } from 'chessops/util';
import type { Color, Role } from 'chessops/types';
import {
  addMove,
  addSan,
  addUci,
  createTree,
  deleteSubtree,
  getNode,
  INITIAL_FEN,
  isOnMainline,
  legalDests,
  mainlineFrom,
  pathTo,
  positionAt,
  promoteToMainline,
  promoteVariation,
  updateNode,
} from '@shared/tree';
import { pgnToChapters, treeToPgn } from '@shared/pgn';
import type { CommentShape, MoveNode, MoveTree, NodeEval, NodeId } from '@shared/types';

/** A move awaiting the user's choice of promotion piece. */
export interface PendingPromotion {
  orig: string;
  dest: string;
  color: Color;
}

interface AnalysisState {
  tree: MoveTree;
  cursorId: NodeId;
  orientation: Color;
  pendingPromotion: PendingPromotion | null;
  /** Set when a load fails, so the UI can explain rather than silently no-op. */
  loadError: string | null;

  // -- derived helpers (recomputed on read; the tree is small) --
  current: () => MoveNode;
  dests: () => Map<string, string[]>;
  isCheck: () => boolean;
  mainlinePath: () => NodeId[];

  // -- navigation --
  setCursor: (id: NodeId) => void;
  goBack: () => void;
  goForward: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  // -- mutation --
  playMove: (orig: string, dest: string) => void;
  completePromotion: (role: Role) => void;
  cancelPromotion: () => void;
  playSan: (san: string) => boolean;
  playUci: (uci: string) => boolean;
  deleteNode: (id: NodeId) => void;
  promoteNode: (id: NodeId, toMainline: boolean) => void;
  setComment: (id: NodeId, comment: string) => void;
  setNags: (id: NodeId, nags: number[]) => void;
  setShapes: (id: NodeId, shapes: CommentShape[]) => void;
  setEval: (id: NodeId, evaluation: NodeEval) => void;

  // -- io --
  reset: (fen?: string) => void;
  loadFen: (fen: string) => boolean;
  loadPgn: (pgn: string) => boolean;
  exportPgn: () => string;
  flip: () => void;
}

const roleChar: Record<Role, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

export const useAnalysis = create<AnalysisState>()((set, get) => {
  const initial = createTree(INITIAL_FEN);

  return {
    tree: initial,
    cursorId: initial.rootId,
    orientation: 'white',
    pendingPromotion: null,
    loadError: null,

    current: () => getNode(get().tree, get().cursorId),
    dests: () => legalDests(get().tree, get().cursorId),
    isCheck: () => positionAt(get().tree, get().cursorId).isCheck(),
    mainlinePath: () => {
      const { tree } = get();
      return mainlineFrom(tree, tree.rootId);
    },

    setCursor: (id) => set({ cursorId: id }),

    goBack: () => {
      const { tree, cursorId } = get();
      const parentId = getNode(tree, cursorId).parentId;
      if (parentId) set({ cursorId: parentId });
    },

    goForward: () => {
      const { tree, cursorId } = get();
      // Follow the mainline child, which is what arrow-right should mean even
      // when the current node has several variations.
      const next = getNode(tree, cursorId).children[0];
      if (next) set({ cursorId: next });
    },

    goToStart: () => set({ cursorId: get().tree.rootId }),

    goToEnd: () => {
      const { tree, cursorId } = get();
      const line = mainlineFrom(tree, cursorId);
      set({ cursorId: line.at(-1) ?? cursorId });
    },

    playMove: (orig, dest) => {
      const { tree, cursorId } = get();
      const pos = positionAt(tree, cursorId);
      const from = parseSquare(orig);
      const to = parseSquare(dest);
      if (from === undefined || to === undefined) return;

      const piece = pos.board.get(from);
      if (!piece) return;

      // chessground reports only orig/dest, so promotion has to be detected here
      // and the piece choice collected from the user before the move can exist.
      const lastRank = piece.color === 'white' ? 7 : 0;
      if (piece.role === 'pawn' && squareRank(to) === lastRank) {
        set({ pendingPromotion: { orig, dest, color: piece.color } });
        return;
      }

      const result = addMove(tree, cursorId, { from, to });
      set({ tree: result.tree, cursorId: result.nodeId });
    },

    completePromotion: (role) => {
      const { tree, cursorId, pendingPromotion } = get();
      if (!pendingPromotion) return;
      const from = parseSquare(pendingPromotion.orig);
      const to = parseSquare(pendingPromotion.dest);
      if (from === undefined || to === undefined) {
        set({ pendingPromotion: null });
        return;
      }
      const result = addMove(tree, cursorId, { from, to, promotion: role });
      set({ tree: result.tree, cursorId: result.nodeId, pendingPromotion: null });
    },

    cancelPromotion: () => set({ pendingPromotion: null }),

    playSan: (san) => {
      const { tree, cursorId } = get();
      const result = addSan(tree, cursorId, san);
      if (!result) return false;
      set({ tree: result.tree, cursorId: result.nodeId });
      return true;
    },

    playUci: (uci) => {
      const { tree, cursorId } = get();
      const result = addUci(tree, cursorId, uci);
      if (!result) return false;
      set({ tree: result.tree, cursorId: result.nodeId });
      return true;
    },

    deleteNode: (id) => {
      const { tree, cursorId } = get();
      const node = getNode(tree, id);
      if (!node.parentId) return;
      // If the cursor is inside the doomed subtree, retreat to the parent first.
      const cursorInside = pathTo(tree, cursorId).includes(id);
      set({
        tree: deleteSubtree(tree, id),
        cursorId: cursorInside ? node.parentId : cursorId,
      });
    },

    promoteNode: (id, toMainline) =>
      set({
        tree: toMainline
          ? promoteToMainline(get().tree, id)
          : promoteVariation(get().tree, id),
      }),

    setComment: (id, comment) =>
      set({ tree: updateNode(get().tree, id, { comment: comment || undefined }) }),

    setNags: (id, nags) => set({ tree: updateNode(get().tree, id, { nags }) }),

    setShapes: (id, shapes) => set({ tree: updateNode(get().tree, id, { shapes }) }),

    setEval: (id, evaluation) => set({ tree: updateNode(get().tree, id, { eval: evaluation }) }),

    reset: (fen = INITIAL_FEN) => {
      const tree = createTree(fen);
      set({ tree, cursorId: tree.rootId, pendingPromotion: null, loadError: null });
    },

    loadFen: (fen) => {
      const trimmed = fen.trim();
      try {
        // Round-trip through the tree so an invalid FEN is rejected here rather
        // than throwing later from inside a render.
        const tree = createTree(trimmed);
        positionAt(tree, tree.rootId);
        set({ tree, cursorId: tree.rootId, pendingPromotion: null, loadError: null });
        return true;
      } catch (error) {
        set({ loadError: `Invalid FEN: ${(error as Error).message}` });
        return false;
      }
    },

    loadPgn: (pgn) => {
      try {
        const chapters = pgnToChapters(pgn);
        const first = chapters[0];
        if (!first) {
          set({ loadError: 'No games found in that PGN.' });
          return false;
        }
        set({
          tree: first.tree,
          cursorId: first.tree.rootId,
          pendingPromotion: null,
          loadError: null,
        });
        return true;
      } catch (error) {
        set({ loadError: `Could not read PGN: ${(error as Error).message}` });
        return false;
      }
    },

    exportPgn: () => treeToPgn(get().tree, {}),

    flip: () => set({ orientation: get().orientation === 'white' ? 'black' : 'white' }),
  };
});

/** UCI string for a promotion choice, for engine and book lookups. */
export function promotionUci(orig: string, dest: string, role: Role): string {
  return `${orig}${dest}${roleChar[role]}`;
}

/** Convenience selector: is the cursor node off the mainline? */
export function useIsVariation(): boolean {
  return useAnalysis((s) => !isOnMainline(s.tree, s.cursorId));
}
