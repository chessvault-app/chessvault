import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import type { Move } from 'chessops/types';
import { makeUci, parseUci } from 'chessops/util';

/**
 * Parse typed move text against a position.
 *
 * Reads SAN the way people actually type it: `Nf3`, but also `nf3`,
 * `exd5`, `0-0`, `e8=Q`, a bare `e4` — and raw UCI (`g1f3`) for those who
 * paste engine lines. Returns the move's UCI, or null when nothing legal
 * matches.
 */
export function moveTextToUci(fen: string, text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  let pos: Chess;
  try {
    pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    return null;
  }

  // UCI first: it is unambiguous when it matches at all.
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(raw)) {
    const move = parseUci(raw.toLowerCase());
    if (move && pos.isLegal(move)) return makeUci(move);
  }

  // SAN, as typed first — `b4` must stay the pawn move while b4 is legal —
  // then with the piece letter uppercased (`nf3`), then castling spelt
  // with zeros or lowercase o's normalised to letters.
  const candidates = [raw];
  const upper = raw.replace(/^[kqrbn]/, (m) => m.toUpperCase());
  if (upper !== raw) candidates.push(upper);
  const castle = raw.replace(/[0o]/gi, 'O');
  if (castle !== raw && /^O-O(-O)?[+#]?$/.test(castle)) candidates.push(castle);
  for (const san of candidates) {
    const move = parseSan(pos, san);
    if (move) return standardUci(pos, move);
  }
  return null;
}

/**
 * chessops represents castling as the king capturing its own rook
 * (`e1h1`); everything downstream of here — puzzle judging against
 * lichess solutions, the analysis tree fed by chessground — speaks the
 * standard king-two-squares form (`e1g1`). Translate on the way out.
 */
function standardUci(pos: Chess, move: Move): string {
  if ('from' in move) {
    const piece = pos.board.get(move.from);
    const target = pos.board.get(move.to);
    if (piece?.role === 'king' && target?.role === 'rook' && target.color === piece.color) {
      const rank = move.from >> 3;
      return makeUci({ from: move.from, to: rank * 8 + (move.to > move.from ? 6 : 2) });
    }
  }
  return makeUci(move);
}
