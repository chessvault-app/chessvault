import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { moveSquares } from '@shared/tree';

/** One ply of a principal variation, as everything a reader can act on. */
export interface PvPly {
  san: string;
  /** As the engine spelled it. What gets replayed into the tree. */
  uci: string;
  /** `12.` or `12...`, only on the plies that print one. */
  number?: string;
  /** From/to squares, for the preview's last-move highlight. */
  squares?: [string, string];
}

/**
 * The position a prefix of a line leads to — what a preview of that ply
 * draws.
 *
 * Deliberately not a field on PvPly. Serialising one FEN per ply inside
 * formatPv put 24 board writes in a render path that runs per engine
 * update, three lines at a time — about 72 a second, to show at most one
 * of them, and only when a desktop pointer happens to rest on a move. It
 * measured 0.044 -> 0.096 ms per call. Replaying once on hover costs
 * ~0.05 ms and happens only when there is something to show.
 */
export function fenAfter(fen: string, uciMoves: string[]): string | undefined {
  const setup = parseFen(fen);
  if (setup.isErr) return undefined;
  const position = Chess.fromSetup(setup.unwrap());
  if (position.isErr) return undefined;
  const pos = position.unwrap();
  for (const uci of uciMoves) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return undefined;
    pos.play(move);
  }
  return makeFen(pos.toSetup());
}

export interface FormattedPv {
  /** Readable notation with move numbers, e.g. `12. Nf3 Nc6 13. Bb5`. */
  text: string;
  /** SAN of the first move, for the click-to-play action. */
  firstSan?: string;
  /**
   * The same line, ply by ply, for callers that make each move its own
   * target. Empty when the line could not be replayed at all — those
   * callers fall back to `text`, which is then the raw UCI.
   */
  plies: PvPly[];
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
  const fallback: FormattedPv = { text: uciMoves.join(' '), plies: [] };
  if (uciMoves.length === 0) return { text: '', plies: [] };

  const setup = parseFen(fen);
  if (setup.isErr) return fallback;
  const position = Chess.fromSetup(setup.unwrap());
  if (position.isErr) return fallback;
  const pos = position.unwrap();

  const plies: PvPly[] = [];

  for (const uci of uciMoves) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;

    const moveNumber = pos.fullmoves;
    const whiteToMove = pos.turn === 'white';
    // makeSanAndPlay advances `pos`, so read the number before calling it.
    const san = makeSanAndPlay(pos, move);

    // A number before every White move, and before a leading Black one so
    // the line says where it starts; nowhere else.
    const number = whiteToMove
      ? `${moveNumber}.`
      : plies.length === 0
        ? `${moveNumber}...`
        : undefined;
    // Not uci.slice(0, 4): castling is spelled king-takes-rook in places,
    // and the square a reader follows the king to is the one to light up.
    const squares = moveSquares({ uci, san });

    plies.push({
      san,
      uci,
      ...(number ? { number } : {}),
      ...(squares ? { squares } : {}),
    });
  }

  if (plies.length === 0) return fallback;
  // Built from the plies rather than alongside them, so the string and the
  // list a reader clicks can never drift apart.
  const text = plies.flatMap((ply) => (ply.number ? [ply.number, ply.san] : [ply.san])).join(' ');
  return { text, firstSan: plies[0]!.san, plies };
}
