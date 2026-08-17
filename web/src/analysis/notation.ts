/**
 * Move-text vocabulary shared across features.
 *
 * These lived in MoveTreePane, and everything that prints a move — the
 * engine's PV rows, the study annotation pane — imported them from a
 * 550-line view. That made analysis and engine depend on each other's
 * views; a leaf module keeps the dependency one-way.
 */

const FIGURINE: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };

/** SAN with figurines — uppercase piece letters never mean anything else. */
export const figurine = (san: string): string => san.replace(/[KQRBN]/g, (m) => FIGURINE[m]!);

/** Glyphs for the NAGs a study realistically uses. */
export const NAG_GLYPH: Record<number, string> = {
  1: '!',
  2: '?',
  // Standard ASCII pairs, matching the board badges (BOARD_NAGS) so a move's
  // mark reads identically in the tree and on the board.
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
  7: '□',
  10: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+−',
  19: '−+',
  22: '⨀',
};
