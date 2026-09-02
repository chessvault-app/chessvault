import { Chess, castlingSide } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import { makeUci, parseUci } from 'chessops/util';
import type { Move } from 'chessops/types';

/**
 * A move as someone TYPES it, read against a position.
 *
 * chessops' parseSan reads what a PGN prints: `Nf3`, `exd5`, `e8=Q`,
 * `O-O`, with or without `+`/`#`. What a person types into a box is
 * looser than that, and each of these had to be accepted or the box
 * would refuse a move the reader can see is right:
 *
 * - figurines, because the move list prints them and a paste from it
 *   comes back that way (`♘f3`, and the black glyphs too);
 * - castling with zeros or lowercase (`0-0`, `o-o-o`);
 * - a promotion without its `=` (`e8Q`) or in lowercase (`e8q`), which
 *   chessops already takes, and UCI (`e7e8q`), which it does not;
 * - a lowercase piece letter (`nf3`), retried as its uppercase only when
 *   the input fails as typed, so `bxc3` stays the pawn capture it is;
 * - trailing `!?` marks and internal spaces, dropped.
 *
 * Everything else is chessops: a move that is not legal in `pos` is not
 * a move, and an ambiguous one (`Nd2` with two knights that can go
 * there) is refused rather than guessed. `pos` is not modified.
 */
export function readTypedMove(pos: Chess, text: string): Move | undefined {
  const cleaned = tidy(text);
  if (!cleaned) return undefined;
  if (UCI.test(cleaned)) {
    const move = parseUci(cleaned.toLowerCase());
    if (move && pos.isLegal(move)) return move;
  }
  const move = parseSan(pos, cleaned);
  if (move) return move;
  // `nf3` → `Nf3`. Not `b`: a leading b is a pawn on the b-file until the
  // writer says otherwise, and `bxc3` and `Bxc3` are both legal often
  // enough that a guess would be wrong half the time.
  if (/^[nrqk][a-h1-8x]/.test(cleaned)) {
    return parseSan(pos, cleaned[0]!.toUpperCase() + cleaned.slice(1));
  }
  return undefined;
}

/**
 * The same, from a FEN, answered as both notations: the UCI the boards
 * play and the SAN chessops would print for it. Null when the FEN or the
 * move is unreadable, or the move is not legal there.
 */
export function typedMove(fen: string, text: string): { uci: string; san: string } | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return null;
  const move = readTypedMove(pos.value, text);
  if (!move) return null;
  return { uci: standardUci(pos.value, move), san: makeSan(pos.value, move) };
}

/**
 * chessops writes castling as king-takes-rook (`e1h1`); the boards, the
 * puzzle files and every judge that compares against them write the
 * king's own square (`e1g1`), so that is what a typed castle becomes.
 */
function standardUci(pos: Chess, move: Move): string {
  const side = castlingSide(pos, move);
  if (!side || !('from' in move)) return makeUci(move);
  return makeUci({ from: move.from, to: move.from + (side === 'h' ? 2 : -2) });
}

const UCI = /^[a-h][1-8][a-h][1-8][nbrq]?$/i;

const FIGURINES: Record<string, string> = {
  '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N',
  '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N',
};

function tidy(text: string): string {
  let s = text.replace(/\s+/g, '').replace(/[♔♕♖♗♘♚♛♜♝♞]/g, (g) => FIGURINES[g]!);
  // Annotation marks are a verdict on the move, not part of it.
  s = s.replace(/[!?]+$/, '');
  // Castling in every spelling: zeros, lowercase, and the check suffix kept.
  const castle = s.match(/^([0oO])-\1(-\1)?([+#]?)$/);
  if (castle) return `O-O${castle[2] ? '-O' : ''}${castle[3]}`;
  return s;
}
