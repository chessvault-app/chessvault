/** Position identity: the FEN without its move counters, so a
    transposition lands on one entry. Born in the drill, but every feature
    that keys anything by position uses it — so it lives here, not in
    repertoire/. */
export const fenKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

/**
 * The piece on `square`, as its FEN letter, or null for an empty square.
 *
 * Read straight off the placement field, so callers holding only a FEN (a
 * trainer's puzzle position) need no chessops replay to ask — and callers
 * that do hold a position get the same answer, because the placement field
 * IS that position's board. The board renderer's castling prune and the
 * promotion gate had each walked the ranks themselves.
 */
export function pieceAt(fen: string, square: string): string | null {
  const row = fen.split(' ')[0]!.split('/')[8 - Number(square[1])];
  if (!row) return null;
  const file = square.charCodeAt(0) - 97;
  let at = 0;
  for (const ch of row) {
    const run = Number(ch);
    if (Number.isInteger(run)) {
      at += run;
      if (at > file) return null; // the empty run covers the square
    } else {
      if (at === file) return ch;
      at += 1;
    }
  }
  return null;
}
