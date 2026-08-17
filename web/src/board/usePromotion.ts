import { useState } from 'react';
import { parseSquare, squareRank } from 'chessops/util';
import type { Color, Role } from 'chessops/types';

/** A move stashed while the picker asks which piece the pawn becomes. */
export interface PendingPromotion {
  orig: string;
  dest: string;
  color: Color;
}

/**
 * Is the piece on `orig` a pawn? Read straight off the FEN, so callers that
 * only hold a FEN (the lichess trainer's puzzle positions) need no chessops
 * replay to answer it — and callers that do hold a position get the same
 * answer, because the FEN board field IS that position's board.
 */
function pawnAt(fen: string, orig: string): boolean {
  const rows = fen.split(' ')[0]!.split('/');
  const file = orig.charCodeAt(0) - 97;
  const rank = Number(orig[1]) - 1;
  const row = rows[7 - rank];
  if (!row) return false;
  let col = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) col += Number(ch);
    else {
      if (col === file) return ch === 'p' || ch === 'P';
      col++;
    }
  }
  return false;
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
      if (!pawnAt(fen, orig)) return false;
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
