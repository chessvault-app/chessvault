/**
 * Boards and text in, verified puzzles out.
 *
 * This is the whole decision the import makes once the pages have been
 * read: work out how the book writes its answers, replay every printed
 * solution on the board it belongs to, and keep the ones that hold up.
 * Everything it needs is already shared and tested, so it has no files, no
 * canvas and no network in it — the driver that walks the PDF hands it two
 * arrays and posts what comes back.
 *
 * What it will NOT do is import a book it could not read. The score is the
 * count of solutions that replay legally, and a book whose notation none of
 * the candidates describes scores near zero across the board. That case
 * comes back as `confident: false` with the numbers attached, for the
 * caller to show, rather than as a pile of plausible-looking wrong answers.
 */
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { Role } from 'chessops/types';
import {
  Dialect,
  castlingRights,
  chapterSides,
  parseMainline,
  replayLine,
  solutionEntries,
  type BookText,
  type TextPage,
} from './bookImport.ts';
import { answerPages, searchSettings, type ReadBoard, type Score } from './bookConfigSearch.ts';

/** A puzzle ready to POST to /puzzlebooks/:slug/puzzles. */
export interface VerifiedPuzzle {
  number: number;
  /** Full FEN: the read board, the side that made the solution work. */
  fen: string;
  uci: string[];
  san: string[];
  provenance: 'book-parsed';
}

export interface SolveResult {
  /** The settings that read the book best, and how well they did. */
  settings: Score;
  /** The whole ranking, so a caller can show what else was close. */
  ranking: Score[];
  puzzles: VerifiedPuzzle[];
  /** Boards whose solution could not be replayed — these become drafts. */
  unresolved: number[];
  /** Where the answers turned out to be, which nobody had to write down. */
  answerRanges: [number, number][];
  /**
   * Replay a candidate position for one puzzle, against the same parsed
   * line and learned dialect the solve used.
   *
   * This is what makes board REPAIR possible without the repair search
   * knowing anything about how a book writes its answers: hand it a
   * position, it says whether the book's printed solution works there.
   */
  replayFor: (number: number, placement: string) => Omit<VerifiedPuzzle, 'number'> | null;
  /**
   * What the book's garbled piece prefixes turned out to mean, learned
   * from the lines that replayed. These are the labels the glyph reader
   * trains on — it needs to know what a knight looks like before it can
   * recognise one, and this is where that comes from.
   */
  learnedHints: Map<string, Role>;
  /**
   * Whether the winning settings read enough of the book to be believed.
   * False is a real answer: the positions are still worth importing as
   * drafts, but their printed solutions were not understood.
   */
  confident: boolean;
}

/** Below this, the book was not read — it was guessed at. */
const MIN_VALIDATED = 20;
const MIN_SHARE = 0.05;

export function solveBook(
  pages: TextPage[],
  boards: Map<number, ReadBoard>,
  book: Omit<BookText, 'anchorStyle' | 'moveMarkers'>,
  /**
   * Piece symbols read off the printed page (see bookGlyphs.ts), for the
   * prefixes the text could not settle by itself. The learned dialect wins
   * where both know one: it was derived from lines that actually replayed,
   * which is stronger evidence than a picture matching a picture.
   */
  glyphHints?: Map<string, Role>,
): SolveResult {
  const ranking = searchSettings(pages, boards, book);
  const settings = ranking[0]!;
  const config: BookText = {
    ...book,
    anchorStyle: settings.anchorStyle,
    moveMarkers: settings.moveMarkers,
    ...(settings.anchorPattern ? { anchorPattern: settings.anchorPattern } : {}),
  };

  const entries = solutionEntries(pages, config);
  const sides = chapterSides(pages);
  const dialect = new Dialect();
  const puzzles: VerifiedPuzzle[] = [];
  const unresolved: number[] = [];

  // Two passes for the same reason the scoring uses two: the first teaches
  // the dialect what this book's figurines mean, the second spends it.
  const withGlyphs = (learned: Map<string, Role>): Map<string, Role> =>
    glyphHints ? new Map([...glyphHints, ...learned]) : learned;

  for (let pass = 0; pass < 2; pass++) {
    const hints = pass === 0 ? undefined : withGlyphs(dialect.hints());
    puzzles.length = 0;
    unresolved.length = 0;
    for (const [number, board] of boards) {
      const body = entries.get(number);
      const mainline = body ? parseMainline(body, config) : null;
      if (!mainline) {
        unresolved.push(number);
        continue;
      }
      const stated =
        settings.sidePrinted && board.sideStated
          ? board.sideStated
          : mainline.startsBlack
            ? 'b'
            : 'w';
      const other = stated === 'w' ? 'b' : 'w';
      const fallback = settings.sidePrinted ? other : (sides.get(board.page) ?? other);

      let done = false;
      for (const side of [stated, fallback]) {
        const out = replayLine(board.placement, side, mainline.tokens, dialect, hints);
        if ('fail' in out) continue;
        const fen = `${board.placement} ${side} ${castlingRights(board.placement)} - 0 1`;
        const uci = toUci(fen, out.sans);
        if (!uci) break; // written moves must replay from the written FEN
        puzzles.push({ number, fen, uci, san: out.sans, provenance: 'book-parsed' });
        done = true;
        break;
      }
      if (!done) unresolved.push(number);
    }
  }

  puzzles.sort((a, b) => a.number - b.number);
  unresolved.sort((a, b) => a - b);
  const share = boards.size > 0 ? puzzles.length / boards.size : 0;

  // The dialect is fully learned by now, so a retry gets the book's best
  // reading rather than the first pass's.
  const hints = withGlyphs(dialect.hints());
  const replayFor = (number: number, placement: string): Omit<VerifiedPuzzle, 'number'> | null => {
    const body = entries.get(number);
    const mainline = body ? parseMainline(body, config) : null;
    const board = boards.get(number);
    if (!mainline || !board) return null;
    const stated =
      settings.sidePrinted && board.sideStated
        ? board.sideStated
        : mainline.startsBlack
          ? 'b'
          : 'w';
    const other = stated === 'w' ? 'b' : 'w';
    const fallback = settings.sidePrinted ? other : (sides.get(board.page) ?? other);
    for (const side of [stated, fallback]) {
      const out = replayLine(placement, side, mainline.tokens, dialect, hints);
      if ('fail' in out) continue;
      // Same rule as the first pass: the moves must also replay from the
      // FEN that would be stored, or the pair is not self-consistent.
      const fen = `${placement} ${side} ${castlingRights(placement)} - 0 1`;
      const uci = toUci(fen, out.sans);
      if (!uci) continue;
      return { fen, uci, san: out.sans, provenance: 'book-parsed' };
    }
    return null;
  };

  return {
    settings,
    ranking,
    puzzles,
    unresolved,
    answerRanges: answerPages(pages, config),
    replayFor,
    learnedHints: dialect.hints(),
    confident: puzzles.length >= MIN_VALIDATED && share >= MIN_SHARE,
  };
}

/**
 * The same line in UCI, replayed from the FEN that will be stored — which
 * also proves the pair is self-consistent before it is written anywhere.
 */
function toUci(fen: string, sans: string[]): string[] | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const position = Chess.fromSetup(setup.unwrap());
  if (position.isErr) return null;
  const pos = position.unwrap();
  const uci: string[] = [];
  for (const san of sans) {
    const move = parseSan(pos, san);
    if (!move) return null;
    uci.push(makeUci(move));
    pos.play(move);
  }
  return uci;
}
