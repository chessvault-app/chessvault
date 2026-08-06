import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseUci } from 'chessops/util';

export interface FormattedPv {
  /** Readable notation with move numbers, e.g. `12. Nf3 Nc6 13. Bb5`. */
  text: string;
  /** SAN of the first move, for the click-to-play action. */
  firstSan?: string;
}

/**
 * Render an engine principal variation as SAN with move numbers.
 *
 * The engine emits UCI, which is unreadable in a side pane. Converting needs the
 * actual position, so this replays the line from `fen`. It stops at the first
 * illegal move rather than throwing — a truncated PV is far better than a crash
 * in a render path.
 */
export function formatPv(fen: string, uciMoves: string[]): FormattedPv {
  const fallback: FormattedPv = { text: uciMoves.join(' ') };
  if (uciMoves.length === 0) return { text: '' };

  const setup = parseFen(fen);
  if (setup.isErr) return fallback;
  const position = Chess.fromSetup(setup.unwrap());
  if (position.isErr) return fallback;
  const pos = position.unwrap();

  const parts: string[] = [];
  let firstSan: string | undefined;

  for (const uci of uciMoves) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;

    const moveNumber = pos.fullmoves;
    const whiteToMove = pos.turn === 'white';
    // makeSanAndPlay advances `pos`, so read the number before calling it.
    const san = makeSanAndPlay(pos, move);

    if (whiteToMove) parts.push(`${moveNumber}.`);
    else if (parts.length === 0) parts.push(`${moveNumber}...`);
    parts.push(san);

    firstSan ??= san;
  }

  if (parts.length === 0) return fallback;
  return { text: parts.join(' '), ...(firstSan ? { firstSan } : {}) };
}
