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

/**
 * How a finished position is written on a scoresheet, or null when nobody
 * won it.
 *
 * Takes a score `terminalScore` RETURNED, and nothing else. `{ mate: 1 }`
 * from an engine is a mate still to be played and has to keep printing
 * `#1`; handing one to this turns "mates next move" into "has already
 * mated", which is the single confusion the result notation exists to
 * stop. Every caller therefore reads it off the settled score inside the
 * branch that already knows the game is over.
 *
 * A draw gets no result here. `0.0` is what a draw is worth and what a bar
 * or a readout already prints for one, so it keeps its number rather than
 * spending four glyphs on ½-½ to say the same thing.
 */
export function terminalResult(settled: { cp?: number; mate?: number }): '1-0' | '0-1' | null {
  if (settled.mate === undefined) return null;
  return settled.mate > 0 ? '1-0' : '0-1';
}
