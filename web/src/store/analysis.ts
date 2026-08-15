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
  mainlineFrom,
  pathTo,
  positionAt,
  promoteToMainline,
  promoteVariation,
  updateNode,
} from '@shared/tree';
import { pgnToChapters, treeToPgn } from '@shared/pgn';
import type { CommentShape, Headers, MoveTree, NodeEval, NodeId } from '@shared/types';

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
  /**
   * Set by views that hand a position to the analysis page (editor, games,
   * puzzles) right before navigating. The analysis view consumes it on
   * mount: present → keep the handed-off position; absent → fresh board.
   */
  handoff: boolean;
  /**
   * Headers of the loaded game (players, ratings, …), kept so the board can
   * show name plates. Null for scratch analysis / FEN loads.
   */
  gameHeaders: Headers | null;
  /**
   * Move list reading mode: show only the line the cursor is on.
   *
   * Here rather than inside the list because the control that flips it
   * lives in the panel's HEADER, which is a sibling — and because a
   * chapter with a side line at every other move is unreadable end to
   * end, which is a property of the study, not of one component.
   *
   * Ephemeral on purpose: this store is not persisted, so it starts off
   * on every load. A list still hiding moves from yesterday's session
   * looks like a study that has lost them.
   */
  currentLineOnly: boolean;

  // -- navigation --
  setCursor: (id: NodeId) => void;
  toggleCurrentLineOnly: () => void;
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
  clearMoves: () => void;
  loadFen: (fen: string) => boolean;
  loadPgn: (pgn: string) => boolean;
  exportPgn: () => string;
  flip: () => void;
}

export const useAnalysis = create<AnalysisState>()((set, get) => {
  const initial = createTree(INITIAL_FEN);

  return {
    tree: initial,
    cursorId: initial.rootId,
    orientation: 'white',
    handoff: false,
    pendingPromotion: null,
    loadError: null,
    gameHeaders: null,
    currentLineOnly: false,

    setCursor: (id) => set({ cursorId: id }),
    toggleCurrentLineOnly: () => set({ currentLineOnly: !get().currentLineOnly }),

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
      set({
        tree,
        cursorId: tree.rootId,
        pendingPromotion: null,
        loadError: null,
        gameHeaders: null,
        orientation: 'white',
      });
    },

    /**
     * Every move gone, everything around them kept.
     *
     * `reset` throws the whole board away — back to the standard starting
     * position, game headers, board side and all. That is right for the
     * Board and wrong for a study, where the chapter's own starting
     * position, its introduction and its headers ARE the document and
     * only the moves are being taken back. So this deletes the root's
     * subtrees and touches nothing else.
     */
    clearMoves: () => {
      const { tree } = get();
      const root = getNode(tree, tree.rootId);
      if (root.children.length === 0) return;
      let next = tree;
      for (const child of root.children) next = deleteSubtree(next, child);
      set({ tree: next, cursorId: next.rootId, pendingPromotion: null });
    },

    loadFen: (fen) => {
      const trimmed = fen.trim();
      try {
        // Round-trip through the tree so an invalid FEN is rejected here rather
        // than throwing later from inside a render.
        const tree = createTree(trimmed);
        positionAt(tree, tree.rootId);
        set({ tree, cursorId: tree.rootId, pendingPromotion: null, loadError: null, gameHeaders: null });
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
        // Name plates only make sense for a real game, not pasted analysis.
        const hasPlayers =
          (first.headers['White'] ?? '?') !== '?' || (first.headers['Black'] ?? '?') !== '?';
        // Land on the LAST mainline move: pasting a game means "show me this
        // game", not "show me the starting position with moves off-screen".
        let cursorId = first.tree.rootId;
        while (getNode(first.tree, cursorId).children[0] !== undefined) {
          cursorId = getNode(first.tree, cursorId).children[0]!;
        }
        set({
          tree: first.tree,
          cursorId,
          pendingPromotion: null,
          loadError: null,
          gameHeaders: hasPlayers ? first.headers : null,
        });
        return true;
      } catch (error) {
        set({ loadError: `Could not read PGN: ${(error as Error).message}` });
        return false;
      }
    },

    exportPgn: () => treeToPgn(get().tree, get().gameHeaders ?? {}),

    flip: () => set({ orientation: get().orientation === 'white' ? 'black' : 'white' }),
  };
});

