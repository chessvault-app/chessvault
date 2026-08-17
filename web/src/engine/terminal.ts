import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';

/**
 * What a finished position is worth, without asking an engine.
 *
 * A terminal position produces no engine lines AT ALL: Stockfish answers a
 * mated board with `bestmove (none)` and a single PV-less `info` line,
 * which parseInfo drops for having no moves (see uci.ts — a line with no
 * variation is not a variation). So anything waiting for `lines[0]` waits
 * for ever, and anything treating its absence as "no opinion" scores a
 * checkmate as nothing at all.
 *
 * The rule is the same one written out in adjudicate.ts and review.ts,
 * which each had their own copy: mate counts AGAINST the side to move,
 * and any other end — stalemate, insufficient material — is a draw. Signed
 * as ±1 rather than 0 because a score of zero cannot carry a sign, and the
 * eval bar has to know which way to fall.
 *
 * Null means "not finished, go and ask the engine". A FEN that will not
 * parse is null too: the callers include a render path, where throwing
 * would take the page down over a position, and an engine asked to look at
 * a bad FEN simply reports nothing.
 */
export function terminalScore(fen: string): { cp?: number; mate?: number } | null {
  let pos;
  try {
    pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    return null;
  }
  if (!pos.isEnd()) return null;
  return pos.isCheckmate() ? { mate: pos.turn === 'white' ? -1 : 1 } : { cp: 0 };
}
