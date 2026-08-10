/**
 * Work out how a book writes its answers, instead of being told.
 *
 * Every book so far needed a human to pick its anchor style, its move
 * markers and where it prints the side to move, by reading a few pages and
 * guessing. That is the one step of the import that cannot be automated by
 * staring harder at the PDF — but it does not need to be, because there is
 * an objective score already: how many printed solutions REPLAY LEGALLY on
 * the boards that were read. A wrong reading of the notation cannot fake
 * that; it just fails.
 *
 * So the settings are searched, not chosen. Two properties make it cheap:
 *
 *  - the expensive half of the import (finding and reading the boards) does
 *    not depend on any of these settings, so it is paid once and every
 *    candidate reuses it;
 *  - what is left is text parsing and replay, which runs a whole book in
 *    about a second.
 *
 * And when none of the named styles fits — a book neither of us has seen —
 * the anchor is DERIVED from the answers text rather than picked from a
 * list, because an anchor has a signature no punctuation can hide: it is
 * the line-leading pattern whose captured number counts upwards.
 */
import type { Role } from 'chessops/types';
import {
  Dialect,
  chapterSides,
  parseMainline,
  replayLine,
  solutionEntries,
  type BookText,
  type TextPage,
} from './bookImport.ts';

/** A board the vision half already read, keyed by printed puzzle number. */
export interface ReadBoard {
  /** Piece placement only — the side to move is what we are working out. */
  placement: string;
  page: number;
  /** The side printed beside this puzzle, where the book prints one. */
  sideStated?: 'w' | 'b';
}

/** The settings a search decides, on top of the ones a book states. */
export interface TextSettings {
  anchorStyle: BookText['anchorStyle'];
  moveMarkers: BookText['moveMarkers'];
  /** Whether the book prints the side beside each puzzle, or per chapter. */
  sidePrinted: boolean;
  anchorPattern?: string | null;
}

export interface Score extends TextSettings {
  /** Entries whose printed solution replayed legally — the whole point. */
  validated: number;
  /** Entries the anchor found at all. */
  entries: number;
}

const ANCHOR_STYLES: BookText['anchorStyle'][] = ['dash', 'paren', 'dot'];
const MOVE_MARKERS: BookText['moveMarkers'][] = ['dotted', 'dotless'];

/**
 * Anchor patterns the book's own answers suggest.
 *
 * An entry anchor is whatever sits at the start of a line and carries a
 * number that keeps counting up. So: take every line-leading shape of the
 * form <junk><number><junk>, group the lines by the shape's punctuation,
 * and keep the shapes whose numbers form a long increasing run. A book that
 * writes "Solution 7:" is found the same way as one that writes "7)".
 */
export function deriveAnchors(pages: TextPage[], maxNumber: number): string[] {
  const runs = new Map<string, number[]>();
  for (const page of pages) {
    for (const line of page.text.split('\n')) {
      const m = /^\s{0,4}([^0-9\n]{0,12}?)(\d{1,4})([^0-9\n]{0,3})/.exec(line);
      if (!m) continue;
      const value = Number(m[2]);
      if (value < 1 || value > maxNumber) continue;
      // The shape is the punctuation around the number, not the number.
      const key = `${m[1]!.trimStart()}|${m[3]!.trimEnd()}`;
      runs.set(key, [...(runs.get(key) ?? []), value]);
    }
  }

  const scored: { pattern: string; run: number }[] = [];
  for (const [key, values] of runs) {
    if (values.length < 20) continue; // a handful of lines is a coincidence
    let longest = 0;
    let current = 0;
    let previous = -Infinity;
    for (const v of values) {
      current = v > previous ? current + 1 : 1;
      previous = v;
      longest = Math.max(longest, current);
    }
    // Most of the lines carrying this shape must be part of the climb.
    if (longest < Math.max(20, values.length * 0.5)) continue;
    const [before, after] = key.split('|') as [string, string];
    scored.push({
      pattern: `(?:^|\\n)\\s{0,4}${escape(before)}(\\d{1,4})${escape(after)}`,
      run: longest,
    });
  }
  return scored.sort((a, b) => b.run - a.run).map((s) => s.pattern);
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How many of this book's printed solutions replay on the read boards under
 * one set of settings. This is the score everything else is ranked by.
 */
export function scoreSettings(
  pages: TextPage[],
  boards: Map<number, ReadBoard>,
  book: Omit<BookText, 'anchorStyle' | 'moveMarkers'>,
  settings: TextSettings,
): Score {
  const config: BookText = {
    ...book,
    anchorStyle: settings.anchorStyle,
    moveMarkers: settings.moveMarkers,
    ...(settings.anchorPattern ? { anchorPattern: settings.anchorPattern } : {}),
  };
  const entries = solutionEntries(pages, config);
  const sides = chapterSides(pages);
  const dialect = new Dialect();

  const attempt = (hints?: Map<string, Role>): number => {
    let validated = 0;
    for (const [number, board] of boards) {
      const body = entries.get(number);
      if (!body) continue;
      const mainline = parseMainline(body, config);
      if (!mainline) continue;
      // The printed side beats the dots when the book prints one; either
      // way the other side gets a try before the entry is given up on,
      // exactly as the measure stage does.
      const first =
        settings.sidePrinted && board.sideStated
          ? board.sideStated
          : mainline.startsBlack
            ? 'b'
            : 'w';
      const second = first === 'w' ? 'b' : 'w';
      const fallback = settings.sidePrinted ? second : (sides.get(board.page) ?? second);
      const ok =
        !('fail' in replayLine(board.placement, first, mainline.tokens, dialect, hints)) ||
        !('fail' in replayLine(board.placement, fallback, mainline.tokens, dialect, hints));
      if (ok) validated++;
    }
    return validated;
  };

  // Two passes, like the measure stage: the first learns the book's
  // figurine dialect from the lines that needed no help, the second uses it
  // to break the ties the first could not. Scoring on one pass alone
  // ranked correctly but undercounted by a tenth, which made the number
  // useless for deciding whether a book had been read well enough.
  attempt();
  return { ...settings, validated: attempt(dialect.hints()), entries: entries.size };
}

/**
 * Every candidate, best first. The caller decides whether the winner is
 * good enough to import with — a book none of these describes scores badly
 * across the board, and that is the answer, not a silent least-bad pick.
 */
export function searchSettings(
  pages: TextPage[],
  boards: Map<number, ReadBoard>,
  book: Omit<BookText, 'anchorStyle' | 'moveMarkers'>,
): Score[] {
  // A book that prints no side beside its puzzles cannot be read as one
  // that does, however the score happens to fall. Left free, this is the
  // setting the search gets wrong: the side it would be "using" is absent,
  // so the flag only reshuffles which side gets tried second, and a book
  // can score a point higher on noise and then import materially worse.
  const stated = [...boards.values()].filter((b) => b.sideStated).length;
  const sideModes = stated >= Math.max(10, boards.size * 0.5) ? [false, true] : [false];

  const candidates: TextSettings[] = [];
  for (const anchorStyle of ANCHOR_STYLES) {
    for (const moveMarkers of MOVE_MARKERS) {
      for (const sidePrinted of sideModes) {
        candidates.push({ anchorStyle, moveMarkers, sidePrinted });
      }
    }
  }
  // Derived anchors ride on top of the same marker/side choices.
  for (const anchorPattern of deriveAnchors(pages, book.maxNumber).slice(0, 4)) {
    for (const moveMarkers of MOVE_MARKERS) {
      for (const sidePrinted of sideModes) {
        candidates.push({ anchorStyle: 'paren', moveMarkers, sidePrinted, anchorPattern });
      }
    }
  }
  return candidates
    .map((settings) => scoreSettings(pages, boards, book, settings))
    .sort((a, b) => b.validated - a.validated || b.entries - a.entries);
}

/**
 * Pages that hold answers: the ones the winning anchor actually fires on.
 * Books that put a section after every chapter need this — and it is the
 * same fact the human was encoding by hand as `solutionRanges`.
 */
export function answerPages(pages: TextPage[], book: BookText): [number, number][] {
  const anchor = new RegExp(
    book.anchorPattern ??
      (book.anchorStyle === 'paren'
        ? '(?:^|\\n)\\s{0,4}(\\d(?:\\s?\\d){0,3})\\s*\\)\\s'
        : book.anchorStyle === 'dot'
          ? '(?:^|\\n)\\s{0,3}(\\d{1,4})\\.\\s+(?=[A-Z])'
          : '(?:^|\\s)(\\d(?:\\s?\\d){0,3})\\s*-\\s*(?=1\\s*\\.)'),
    'g',
  );
  const hit = pages
    .filter((p) => [...p.text.matchAll(anchor)].length >= 3)
    .map((p) => p.page)
    .sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const page of hit) {
    const last = ranges.at(-1);
    if (last && page <= last[1] + 1) last[1] = page;
    else ranges.push([page, page]);
  }
  return ranges;
}
