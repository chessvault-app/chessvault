import { useState } from 'react';
import { parseSquare, squareRank } from 'chessops/util';
import type { Color, Role } from 'chessops/types';
import { pieceAt } from '@/lib/fen';

/** A move stashed while the picker asks which piece the pawn becomes. */
export interface PendingPromotion {
  orig: string;
  dest: string;
  color: Color;
}

/**
 * The promotion gate every board with a picker shares.
 *
 * chessground reports a move as orig/dest only, so a pawn reaching the last
 * rank cannot become a move yet: it is stashed here, the caller overlays
 * PromotionPicker while `pending` is set, and only the chosen piece
 * completes it (Escape or a click elsewhere cancels — a misdrag must be
 * takeable-back). That detect → stash → complete/cancel cycle used to be
 * hand-rolled once per view, four near-identical copies each with its own
 * role-to-letter map. The analysis board is the deliberate exception and
 * does not use this hook: its pending move lives in the analysis STORE,
 * where loads and resets can clear it alongside the tree they replace.
 */
export function usePromotion(apply: (orig: string, dest: string, role: Role) => void): {
  pending: PendingPromotion | null;
  /** True — and the move stashed — when orig→dest is a pawn reaching the
      mover's last rank; the caller then returns instead of playing it. */
  maybeStart: (fen: string, turn: Color, orig: string, dest: string) => boolean;
  complete: (role: Role) => void;
  cancel: () => void;
} {
  const [pending, setPending] = useState<PendingPromotion | null>(null);
  return {
    pending,
    maybeStart: (fen, turn, orig, dest) => {
      const to = parseSquare(dest);
      if (to === undefined || squareRank(to) !== (turn === 'white' ? 7 : 0)) return false;
      if (pieceAt(fen, orig)?.toLowerCase() !== 'p') return false;
      setPending({ orig, dest, color: turn });
      return true;
    },
    complete: (role) => {
      if (!pending) return;
      apply(pending.orig, pending.dest, role);
      setPending(null);
    },
    cancel: () => setPending(null),
  };
}
