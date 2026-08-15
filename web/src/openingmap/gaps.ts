import type { FieldMove } from '@/repertoire/field';

/**
 * The gap question: at a position where the opponent moves, which of
 * their popular replies do you have nothing against?
 *
 * "Popular" is a share of the games reaching the position, not a raw
 * count — a sideline seen twice in a tiny book is noise, the same reply
 * in two percent of a million games is homework. The threshold is the
 * drill's own (GAP_NOTE_SHARE): below it, oddballs would drown the
 * panel. "Met" means the map charts the reply or a tagged study
 * prepares it — either way you have somewhere to stand.
 */

/** A reply is worth flagging from this share of games. */
export const GAP_SHARE = 0.05;

export interface NodeGaps {
  /** Games observed at the position. 0 means the field has no answer. */
  games: number;
  /** Frequency-weighted share of replies that have prep, 0..1. */
  metShare: number;
  /** Popular replies with no prep, most popular first. */
  gaps: { san: string; share: number }[];
}

export function computeGaps(moves: FieldMove[], met: ReadonlySet<string>): NodeGaps {
  const games = moves.reduce((sum, m) => sum + m.total, 0);
  if (games === 0) return { games: 0, metShare: 0, gaps: [] };
  let metGames = 0;
  const gaps: { san: string; share: number }[] = [];
  for (const move of moves) {
    if (move.total === 0) continue;
    if (met.has(move.san)) {
      metGames += move.total;
    } else {
      const share = move.total / games;
      if (share >= GAP_SHARE) gaps.push({ san: move.san, share });
    }
  }
  gaps.sort((a, b) => b.share - a.share);
  return { games, metShare: metGames / games, gaps };
}
