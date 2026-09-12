import { parseFen } from 'chessops/fen';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';

/**
 * What the body of a ```chess fence stands for, as PGN.
 *
 * The manual promises the fence takes "a FEN or moves", and three readers
 * used to decide that separately: the note's board, the board's paste box
 * and the shelf card's thumbnail. Only the paste box accepted a bare FEN.
 * The other two handed it to the PGN parser, which took the FEN for junk
 * movetext and answered with the starting position and no moves. So a
 * note that said "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1" drew thirty-two
 * pieces, its card drew none, and the first move played on that board
 * wrote "1. e4 *" over the author's position. Nothing said the fence had
 * been misread, because nothing had failed.
 *
 * One reader now, and it answers null where it cannot read, so a caller
 * can SAY so rather than draw a position nobody wrote:
 *
 *   - an empty body is an empty board (the fence a fresh block writes);
 *   - one line that is a FEN becomes the [FEN]/[SetUp] headers the PGN
 *     codec already understands, and a FEN that will not parse is
 *     unreadable rather than a game that starts from the opening;
 *   - anything else is PGN, and PGN whose movetext yields no move at all
 *     is unreadable too. Junk parses as a game with zero moves; a game
 *     with zero moves and nothing but a result token in its movetext is
 *     the same empty board as above.
 */
export function chessFencePgn(body: string): string | null {
  const text = body.trim();
  if (!text) return '*';

  const lines = text.split('\n');
  if (lines.length === 1 && looksLikeFen(text)) {
    return parseFen(text).isOk ? `[FEN "${text}"]\n[SetUp "1"]\n\n*` : null;
  }

  const game = parsePgn(text)[0];
  if (!game) return null;
  const start = startingPosition(game.headers);
  if (start.isErr) return null;
  const first = game.moves.children[0];
  if (first && !parseSan(start.unwrap(), first.data.san)) return null;
  if (!first && movetextOf(text)) return null;
  return text;
}

/** Six space-separated fields whose first has the board's seven slashes. */
function looksLikeFen(line: string): boolean {
  const fields = line.split(/\s+/);
  return fields.length >= 4 && (fields[0]!.match(/\//g) ?? []).length === 7;
}

/** The movetext with its comments and result stripped: what has to be moves. */
function movetextOf(pgn: string): string {
  return pgn
    .split('\n')
    .filter((line) => !/^\s*\[/.test(line))
    .join(' ')
    .replace(/\{[^}]*\}/g, '')
    .replace(/;[^\n]*/g, '')
    .replace(/(^|\s)(\*|1-0|0-1|1\/2-1\/2)(?=\s|$)/g, ' ')
    .trim();
}
