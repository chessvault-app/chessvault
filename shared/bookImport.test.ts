import { describe, expect, it } from 'vitest';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import {
  Dialect,
  answerPageIndex,
  assignLabels,
  castlingRights,
  chapterSides,
  deriveNumbering,
  fitLabelWindow,
  isMoveish,
  labelForDiagram,
  letterSides,
  pageMateGoal,
  pageNumbers,
  parseMainline,
  replayLine,
  resolveToken,
  saneCounts,
  solutionEntries,
  stripVariations,
  tokenPrefix,
  type BookText,
  type PageLayout,
  type TextPage,
  type Word,
} from './bookImport.ts';

const BOOK: BookText = {
  numberStyle: 'bare',
  anchorStyle: 'dash',
  moveMarkers: 'dotted',
  maxNumber: 1001,
  solutionsAfterPage: 0,
};

const word = (text: string, x0: number, y0: number): Word => ({
  text,
  x0,
  y0,
  x1: x0 + text.length * 6,
  y1: y0 + 10,
});

const page = (n: number, text: string, words: Word[] = []): TextPage => ({
  page: n,
  width: 480,
  words,
  text,
});

describe('puzzle-number labels', () => {
  it('merges digits the scan split apart', () => {
    // "103" comes back as three words on one baseline.
    const numbers = pageNumbers([word('1', 10, 40), word('0', 16, 40), word('3', 22, 40)], BOOK);
    expect(numbers.map((n) => n.value)).toEqual([103]);
  });

  it('keeps digits on different lines apart', () => {
    const numbers = pageNumbers([word('4', 10, 40), word('7', 10, 200)], BOOK);
    expect(numbers.map((n) => n.value)).toEqual([4, 7]);
  });

  it('ignores numbers past the last puzzle', () => {
    expect(pageNumbers([word('9999', 10, 40)], BOOK)).toEqual([]);
  });

  it('reads "123)" whole in paren books', () => {
    const paren = { ...BOOK, numberStyle: 'paren' as const };
    expect(pageNumbers([word('123)', 10, 40), word('45', 10, 60)], paren).map((n) => n.value)).toEqual([123]);
  });
});

describe('matching a number to its diagram', () => {
  const window = { labelX: 20, labelY: 40, labelDrop: 14 };
  const rect = { x: 100, y: 200, w: 300, h: 300 };

  it('takes the number printed just above the diagram', () => {
    const numbers = [
      { value: 7, x0: 100, x1: 112, y1: 180 },
      { value: 8, x0: 100, x1: 112, y1: 560 }, // the next diagram's
    ];
    expect(labelForDiagram(rect, numbers, window)?.value).toBe(7);
  });

  it('ignores a number too far above to belong to it', () => {
    expect(labelForDiagram(rect, [{ value: 7, x0: 100, x1: 112, y1: 100 }], window)).toBeUndefined();
  });

  it('ignores a number off to the side', () => {
    expect(labelForDiagram(rect, [{ value: 7, x0: 500, x1: 512, y1: 190 }], window)).toBeUndefined();
  });

  it('accepts a margin label beside the diagram top when the book allows it', () => {
    const margin = { labelX: 100, labelY: 130, labelDrop: 160 };
    // Printed to the LEFT and slightly BELOW the top edge, as in The
    // Ultimate Chess Puzzle Book.
    const numbers = [{ value: 49, x0: 20, x1: 40, y1: 280 }];
    expect(labelForDiagram(rect, numbers, window)).toBeUndefined();
    expect(labelForDiagram(rect, numbers, margin)?.value).toBe(49);
  });

  it('binds a lone W or B to the number above it, not to a nearby column', () => {
    const numbers = [
      { value: 49, x0: 50, x1: 61, y1: 96 },
      { value: 53, x0: 252, x1: 263, y1: 96 },
    ];
    const words: Word[] = [
      { text: 'W', x0: 52, x1: 60, y0: 97, y1: 108 },
      { text: 'B', x0: 254, x1: 262, y0: 97, y1: 108 },
      // A capital in the running head, nowhere near a number.
      { text: 'W', x0: 400, x1: 408, y0: 20, y1: 31 },
    ];
    const sides = letterSides(words, numbers);
    expect(sides.get(49)).toBe('w');
    expect(sides.get(53)).toBe('b');
    expect(sides.size).toBe(2);
  });
});

describe('solution text', () => {
  it('anchors entries and gives each its own body', () => {
    const pages = [page(1, '1 - 1.e4 e5\n2 - 1.d4 d5\n')];
    const entries = solutionEntries(pages, BOOK);
    expect([...entries.keys()]).toEqual([1, 2]);
    expect(entries.get(1)).toContain('e4');
    expect(entries.get(1)).not.toContain('d4');
  });

  it('tolerates the digits of an anchor drifting apart', () => {
    const entries = solutionEntries([page(1, '1 03 - 1.e4')], BOOK);
    expect([...entries.keys()]).toEqual([103]);
  });

  it('reads answers that sit in one section per chapter', () => {
    const pages = [page(1, '5) 1.Qa4'), page(2, 'puzzles, not answers'), page(3, '6) 1.Ba4')];
    const interleaved = {
      ...BOOK,
      anchorStyle: 'paren' as const,
      solutionRanges: [[1, 1], [3, 3]] as [number, number][],
    };
    const entries = solutionEntries(pages, interleaved);
    expect([...entries.keys()]).toEqual([5, 6]);
    // Page 2 is not answers, so nothing from it joins entry 5's body.
    expect(entries.get(5)).not.toContain('puzzles');
  });

  it('takes a pattern from the book when no named style fits', () => {
    const pages = [page(1, 'Solution 7: 1.Qh5#\nSolution 8: 1.Rd8#')];
    const custom = { ...BOOK, anchorPattern: 'Solution (\\d{1,4}):\\s' };
    const entries = solutionEntries(pages, custom);
    expect([...entries.keys()]).toEqual([7, 8]);
    expect(entries.get(7)).toContain('Qh5#');
  });
});

describe('mainline parsing', () => {
  it('takes bare replies as part of the line', () => {
    const line = parseMainline('1.Bg5+ Ke8 2.Qh8#', BOOK);
    expect(line?.startsBlack).toBe(false);
    expect(line?.tokens).toEqual(['Bg5+', 'Ke8', 'Qh8#']);
  });

  it('knows a black first move by its dots', () => {
    expect(parseMainline('1 ... Nc6 2.Nf3', BOOK)?.startsBlack).toBe(true);
  });

  it('stops at an alternative solution rather than playing it', () => {
    // Mate-in-one entries list every mate as its own "1.".
    expect(parseMainline('1.Rxh6# 1.Qh7# 1.Nf7#', BOOK)?.tokens).toEqual(['Rxh6#']);
  });

  it('drops prose and bracketed variations', () => {
    const line = parseMainline('1.Qxh7+ (not 1.Qxf7 Kh8) Kxh7 2.Rh3# a lovely finish', BOOK);
    expect(line?.tokens).toEqual(['Qxh7+', 'Kxh7', 'Rh3#']);
  });

  it('ends a dotless line at a number that stops counting', () => {
    const dotless = { ...BOOK, moveMarkers: 'dotless' as const };
    expect(parseMainline('1 e4 e5 2 Nf3 Nc6 Reggio Emilia 2000', dotless)?.tokens).toEqual([
      'e4',
      'e5',
      'Nf3',
      'Nc6',
    ]);
  });

  it('refuses prose that only mentions squares', () => {
    expect(isMoveish('f7-pawn')).toBe(false);
    expect(isMoveish('a1-h8')).toBe(false);
    expect(isMoveish('Qxf7#')).toBe(true);
    expect(isMoveish('0-0-0')).toBe(true);
  });

  it('strips nested brackets', () => {
    expect(stripVariations('a (b (c) d) e').trim()).toBe('a  e'.trim());
  });
});

describe('resolving a printed token against a position', () => {
  const pos = (fen: string): Chess => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

  it('reads a figurine-less token by legality alone', () => {
    // Only one piece can reach c6.
    const p = pos('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1');
    expect(resolveToken(p, 'lDg5', false).san).toBe('Ng5');
  });

  it('rejects a claimed mate that is not mate', () => {
    const p = pos('7k/8/8/8/8/8/8/K5R1 w - - 0 1');
    const res = resolveToken(p, 'Rg7#', true);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('claims mate');
  });

  it('takes a bare destination as a pawn move', () => {
    // Both a pawn and a rook can reach a4; SAN says bare means the pawn.
    const p = pos('4k3/8/8/8/8/8/P7/R3K3 w Q - 0 1');
    expect(resolveToken(p, 'a4', false).san).toBe('a4');
  });

  it('uses a learned prefix to break a tie', () => {
    // Rook on d1 and queen on h5 both capture on d5.
    const p = pos('k7/8/8/3q3Q/8/8/8/3RK3 w - - 0 1');
    const ambiguous = resolveToken(p, '%xd5', false);
    expect(ambiguous.ok).toBe(false);
    const hinted = resolveToken(p, '%xd5', false, new Map([['%', 'rook']]));
    expect(hinted.san).toBe('Rxd5');
  });

  it('honors a printed underpromotion instead of assuming the queen', () => {
    // All four promotions are legal and land on the same square; only the
    // token's own suffix can say which piece the book meant.
    const p = pos('8/4P3/8/8/7k/8/8/K7 w - - 0 1');
    expect(resolveToken(p, 'e8=N', false).san).toBe('e8=N');
    expect(resolveToken(p, 'e8N', false).san).toBe('e8=N');
    // The book's "+" may be its own optimism; the suffix still reads.
    expect(resolveToken(p, 'e8=R+', false).san).toBe('e8=R');
    // Lowercase is believed only behind "=", where it cannot be noise.
    expect(resolveToken(p, 'e8=n', false).san).toBe('e8=N');
    // No suffix still means the queen, by far the common case.
    expect(resolveToken(p, 'e8', false).san).toBe('e8=Q');
    expect(resolveToken(p, 'e8=Q', false).san).toBe('e8=Q');
  });

  it('names the prefix a figurine left behind, and ignores SAN letters', () => {
    expect(tokenPrefix('tt:lxe5+')).toBe('tt:l');
    expect(tokenPrefix('cxd6')).toBeNull();
    expect(tokenPrefix('e4')).toBeNull();
  });
});

describe('assembling a position from a read board', () => {
  it('refuses a board no game could reach', () => {
    expect(saneCounts('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(true);
    // Nine black pawns.
    expect(saneCounts('rnbqkbnr/pppppppp/p7/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(false);
    // Five white queens with a full pawn set to explain them.
    expect(saneCounts('4k3/8/8/8/8/QQQQQ3/PPPPPPPP/4K3')).toBe(false);
  });

  it('infers castling from untouched home squares', () => {
    expect(castlingRights('r3k2r/8/8/8/8/8/8/R3K2R')).toBe('KQkq');
    expect(castlingRights('4k3/8/8/8/8/8/8/R3K3')).toBe('Q');
    expect(castlingRights('4k3/8/8/8/8/8/8/4K3')).toBe('-');
  });

  it('validates a whole line, and feeds the dialect what it learned', () => {
    const dialect = new Dialect();
    // 1.Qxh7+ Kxh7 — the queen's prefix is seen once, the king's capture
    // is a bare destination and needs no prefix at all.
    const out = replayLine('5rk1/pp3ppp/8/7Q/8/8/PPP2PPP/2K5', 'w', ['%xh7+', 'xh7'], dialect);
    expect('sans' in out && out.sans).toEqual(['Qxh7+', 'Kxh7']);
    // One sighting is not a dialect; five agreeing ones are.
    expect(dialect.hints().size).toBe(0);
    for (let i = 0; i < 5; i++) dialect.record('%xh7+', 'queen');
    expect(dialect.hints().get('%')).toBe('queen');
  });

  it('reports why a line failed instead of guessing', () => {
    const out = replayLine('4k3/8/8/8/8/8/8/4K3', 'w', ['Qh8#'], new Dialect());
    expect('fail' in out && out.fail).toContain('no legal move to h8');
  });
});

describe('page-level hints', () => {
  it('carries a chapter’s side to move down its pages', () => {
    const sides = chapterSides([
      page(1, 'White to move and mate in two'),
      page(2, 'more puzzles'),
      page(3, 'Black to play'),
      page(4, 'more puzzles'),
    ]);
    expect(sides.get(2)).toBe('w');
    expect(sides.get(4)).toBe('b');
  });

  it('reads the stated mate distance', () => {
    expect(pageMateGoal('White to move and mate in three')).toBe(3);
    expect(pageMateGoal('mate in 4')).toBe(4);
    expect(pageMateGoal('a quiet positional page')).toBe(0);
    expect(pageMateGoal('White mates in three moves.')).toBe(3);
  });
});

describe('fitLabelWindow / assignLabels', () => {
  /** A page laid out the way a puzzle book lays one out. */
  const layout = (page: number, first: number, offset: { dx: number; dy: number }): PageLayout => {
    const rects = [
      { x: 100, y: 200, w: 200, h: 200 },
      { x: 400, y: 200, w: 200, h: 200 },
    ];
    return {
      page,
      rects,
      numbers: rects.map((r, i) => ({
        value: first + i,
        x0: r.x - offset.dx - 20,
        x1: r.x - offset.dx,
        y1: r.y - offset.dy,
      })),
    };
  };

  it('finds the window the book actually uses, without being told', () => {
    const offset = { dx: 0, dy: 30 };
    const pages = Array.from({ length: 12 }, (_, i) => layout(i + 1, i * 2 + 1, offset));
    const found = assignLabels(pages);
    expect(found.size).toBe(24);
    expect(found.get(1)).toEqual({ page: 1, rect: { x: 100, y: 200, w: 200, h: 200 } });
    expect(found.get(24)?.page).toBe(12);
  });

  it('reads a margin layout, where the number sits BELOW the diagram top', () => {
    // Same code, no setting changed: the cluster is simply at a different
    // place, which is the whole point of fitting it.
    const pages = Array.from({ length: 12 }, (_, i) => layout(i + 1, i * 2 + 1, { dx: 40, dy: -60 }));
    expect(assignLabels(pages).size).toBe(24);
  });

  it('ignores digits that are not labels', () => {
    const offset = { dx: 0, dy: 30 };
    const pages = Array.from({ length: 12 }, (_, i) => {
      const p = layout(i + 1, i * 2 + 1, offset);
      // A running head and a page number, nowhere near the cluster.
      p.numbers.push({ value: 900 + i, x0: 90, x1: 130, y1: 60 });
      p.numbers.push({ value: 800 + i, x0: 300, x1: 340, y1: 760 });
      return p;
    });
    const found = assignLabels(pages);
    expect(found.size).toBe(24);
    expect([...found.keys()].every((n) => n <= 24)).toBe(true);
  });

  it('refuses to invent a layout from a handful of pages', () => {
    expect(fitLabelWindow([layout(1, 1, { dx: 0, dy: 30 })])).toBeNull();
    expect(assignLabels([layout(1, 1, { dx: 0, dy: 30 })]).size).toBe(0);
  });

  it("keeps a number's first diagram when the book reprints it", () => {
    const offset = { dx: 0, dy: 30 };
    const pages = Array.from({ length: 12 }, (_, i) => layout(i + 1, i * 2 + 1, offset));
    // The answers section reprints puzzle 1's diagram, later in the book.
    pages.push(layout(99, 1, offset));
    expect(assignLabels(pages).get(1)?.page).toBe(1);
  });
});

describe('assignLabels — numbers the scan lost', () => {
  /** A page of `count` diagrams in one column, with numbers for `given`. */
  const page = (no: number, first: number, count: number, given: number[]): PageLayout => {
    const rects = [...Array(count).keys()].map((i) => ({ x: 100, y: 100 + i * 300, w: 200, h: 200 }));
    return {
      page: no,
      rects,
      numbers: rects
        .map((r, i) => ({ value: first + i, x0: r.x - 20, x1: r.x, y1: r.y - 30 }))
        .filter((n) => given.includes(n.value)),
    };
  };

  /** Enough pages for the window to be fitted at all. */
  const filler = (): PageLayout[] =>
    [...Array(10).keys()].map((i) => page(100 + i, 500 + i * 3, 3, [500 + i * 3, 501 + i * 3, 502 + i * 3]));

  it('deduces a number missing from the text layer', () => {
    // 10, 11, 12 printed; the scan lost 11.
    const found = assignLabels([page(1, 10, 3, [10, 12]), ...filler()]);
    expect(found.get(11)).toEqual({ page: 1, rect: { x: 100, y: 400, w: 200, h: 200 } });
  });

  it('fills a gap several wide when it matches exactly', () => {
    const found = assignLabels([page(1, 20, 5, [20, 24]), ...filler()]);
    expect([21, 22, 23].map((n) => found.get(n)?.rect.y)).toEqual([400, 700, 1000]);
  });

  it('refuses a gap that does not match what stands in it', () => {
    // Two diagrams between 30 and 34 — but three numbers are missing, so
    // which diagram is which is not deducible. Guessing would put wrong
    // numbers on real positions.
    const p = page(1, 30, 5, [30, 34]);
    p.rects.splice(2, 1); // one diagram was never detected
    const found = assignLabels([p, ...filler()]);
    expect(found.has(31)).toBe(false);
    expect(found.has(32)).toBe(false);
    expect(found.has(33)).toBe(false);
  });

  it('never overwrites a number a diagram actually carried', () => {
    const found = assignLabels([page(1, 40, 3, [40, 41, 42]), ...filler()]);
    expect(found.get(41)?.rect.y).toBe(400);
  });

  it('leaves a page alone when nothing on it was labelled', () => {
    const found = assignLabels([page(1, 50, 3, []), ...filler()]);
    expect([50, 51, 52].some((n) => found.has(n))).toBe(false);
  });
});

describe('deriveNumbering', () => {
  const digits = (values: number[], style: 'bare' | 'paren'): TextPage[] =>
    values.map((v, i) => ({
      page: i + 1,
      width: 600,
      text: '',
      words: [
        { x0: 10, x1: 30, y0: 10, y1: 20, text: style === 'paren' ? `${v})` : String(v) },
        // Noise every book has: a page number, a year in the prose.
        { x0: 300, x1: 330, y0: 700, y1: 710, text: String(400 + i) },
        { x0: 100, x1: 140, y0: 300, y1: 310, text: '1987' },
      ],
    }));

  it('reads the ceiling off the book’s own dense run', () => {
    expect(deriveNumbering(digits([...Array(120).keys()].map((i) => i + 1), 'bare'))).toEqual({
      numberStyle: 'bare',
      maxNumber: 120,
    });
  });

  it('tells a parenthesised book from a bare one', () => {
    const found = deriveNumbering(digits([...Array(120).keys()].map((i) => i + 1), 'paren'));
    expect(found.numberStyle).toBe('paren');
    expect(found.maxNumber).toBe(120);
  });

  it('stops where the run stops, not at the largest digit on the page', () => {
    // Scattered high numbers (years, page numbers) must not raise the
    // ceiling — only a run that keeps counting does.
    const found = deriveNumbering(digits([...Array(60).keys()].map((i) => i + 1), 'bare'));
    expect(found.maxNumber).toBe(60);
  });
});

describe('answerPageIndex', () => {
  /** An answers chapter: page 106 prints 1..3, page 107 prints 50..51. */
  const answers: TextPage[] = [
    { page: 105, width: 400, words: [], text: 'the last page of puzzles 998 999 1000 1001' },
    { page: 106, width: 400, words: [], text: '1 - Rxa6# 2 - Nb5# 3 - Rf7#' },
    { page: 107, width: 400, words: [], text: '50 - Qh6+ 51 - Bxg6' },
  ];

  it('sends a number to the page that prints it', () => {
    const pageFor = answerPageIndex(answers, [[106, 107]], 1001);
    expect(pageFor(2)).toBe(106);
    expect(pageFor(51)).toBe(107);
  });

  it('falls back to the run a mangled number sits in', () => {
    // 4 is on page 106 in the book, but the scan lost it. The run that
    // starts at 1 is the last one starting at or below 4, so 106 it is.
    const pageFor = answerPageIndex(answers, [[106, 107]], 1001);
    expect(pageFor(4)).toBe(106);
    expect(pageFor(60)).toBe(107);
  });

  it('reads nothing outside the answers pages', () => {
    // 998 is printed on page 105, which is puzzles, not answers.
    const pageFor = answerPageIndex(answers, [[106, 107]], 1001);
    expect(pageFor(998)).toBe(107);
  });

  it('ignores numbers past the book’s ceiling', () => {
    const pageFor = answerPageIndex(
      [{ page: 20, width: 400, words: [], text: '1996 - a year, not a puzzle 7 - Qxf7#' }],
      [[20, 20]],
      100,
    );
    expect(pageFor(7)).toBe(20);
    expect(pageFor(1996)).toBe(20); // by the run, not by the printed digits
  });

  it('answers nothing when the book has no answers pages', () => {
    expect(answerPageIndex(answers, [], 1001)(2)).toBeUndefined();
  });
});
