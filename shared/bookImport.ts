/**
 * The book importer's TEXT half: puzzle numbers out of word boxes, entries
 * out of an answers chapter, and printed moves resolved against a position.
 *
 * None of it touches a file or a canvas, which is the point. The measure
 * stage (scripts/ml/autoimport-measure.ts) runs it over a Python text dump
 * and page renders; the app runs the same functions over pdf.js output in a
 * worker. Two callers, one behaviour — and it is testable on its own, which
 * as a script it never was.
 *
 * The vision half (finding a diagram, warping it, reading its 64 cells)
 * already lives in web/src/puzzles/ocr and is already shared the same way.
 */
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { squareRank } from 'chessops/util';
import type { Move, NormalMove, Role } from 'chessops/types';

/** One word of a PDF's text layer, in that page's own coordinates. */
export interface Word {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
}

export interface TextPage {
  page: number;
  width: number;
  words: Word[];
  text: string;
}

/** Every book-specific fact the text half needs. See scripts/ml/books/. */
export interface BookText {
  /** 'bare' = plain digits above the diagram; 'paren' = "123)". */
  numberStyle: 'bare' | 'paren';
  /** Entry anchor: 'dash' = "N - 1."; 'paren' = "N) ..."; 'dot' = "N. ...". */
  anchorStyle: 'dash' | 'paren' | 'dot';
  /** 'dotted' = "1.e4 / 1 ... e5" markers; 'dotless' = "1 e4". */
  moveMarkers: 'dotted' | 'dotless';
  maxNumber: number;
  /** First page that can hold answers, when they are all at the back. */
  solutionsAfterPage: number;
  /** Page spans of the answers, for books with one section per chapter. */
  solutionRanges?: [number, number][] | null;
  /**
   * A book whose answers are anchored in a way none of the named styles
   * describes supplies the pattern itself: one capture group, the puzzle
   * number. The named styles are presets for this, not a closed set — a
   * book the presets do not fit must not need a code change.
   */
  anchorPattern?: string | null;
}

// --- puzzle-number labels -----------------------------------------------------

export interface NumberBox {
  value: number;
  x0: number;
  x1: number;
  y1: number;
}

/** Digit words merged into numbers ("1 0 3" is three words in this scan). */
export function pageNumbers(words: Word[], book: BookText): NumberBox[] {
  if (book.numberStyle === 'paren') {
    // "123)" is a single word; no digit-run merging needed.
    return words
      .filter((w) => /^\d{1,4}\)$/.test(w.text))
      .map((w) => ({ value: Number(w.text.slice(0, -1)), x0: w.x0, x1: w.x1, y1: w.y1 }))
      .filter((n) => n.value >= 1 && n.value <= book.maxNumber);
  }
  const digits = words
    .filter((w) => /^\d{1,4}$/.test(w.text))
    .sort((a, b) => (Math.abs(a.y0 - b.y0) < 3 ? a.x0 - b.x0 : a.y0 - b.y0));
  const out: NumberBox[] = [];
  let run: typeof digits = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const text = run.map((w) => w.text).join('');
    const value = Number(text);
    if (value >= 1 && value <= book.maxNumber && text.length <= 4) {
      out.push({ value, x0: run[0]!.x0, x1: run[run.length - 1]!.x1, y1: run[run.length - 1]!.y1 });
    }
    run = [];
  };
  for (const d of digits) {
    const prev = run[run.length - 1];
    if (prev && Math.abs(d.y0 - prev.y0) < 3 && d.x0 - prev.x1 < 8 && d.x0 >= prev.x1 - 1) run.push(d);
    else {
      flush();
      run = [d];
    }
  }
  flush();
  return out;
}

/** Chapter headers state the side to move; pages inherit the last one. */
export function chapterSides(pages: TextPage[]): Map<number, 'w' | 'b'> {
  const out = new Map<number, 'w' | 'b'>();
  let current: 'w' | 'b' | null = null;
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    const m = /(white|black)\s+to\s+(?:move|play)/i.exec(p.text);
    if (m) current = m[1]!.toLowerCase() === 'white' ? 'w' : 'b';
    if (current) out.set(p.page, current);
  }
  return out;
}

const MATE_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** "mate in three" on the page — the goal the puzzle states. */
export function pageMateGoal(text: string): number {
  const m = /mate in (\w+)/i.exec(text);
  if (!m) return 0;
  const word = m[1]!.toLowerCase();
  return MATE_WORDS[word] ?? (Number(word) > 0 && Number(word) < 9 ? Number(word) : 0);
}

// --- solutions text -----------------------------------------------------------

/** Strip [] and () variation blocks, nesting-aware. */
export function stripVariations(text: string): string {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

export interface Mainline {
  startsBlack: boolean;
  tokens: string[];
}

/**
 * A token is move-shaped when it holds a square or a castling pattern —
 * but prose talks about squares too ("the f7-pawn", "the a1-h8 diagonal"),
 * and swallowing those as moves is how a solution that parsed fine ends up
 * replaying into nothing. A square followed by a hyphen and letters is
 * English, not notation.
 */
export function isMoveish(token: string): boolean {
  if (/[a-h][1-8]\s*-\s*[a-z]/i.test(token)) return false;
  if (/[a-h][1-8]/.test(token)) return true;
  const castleish = token.replace(/[^0Oo-]/g, '');
  return /^[0Oo]-[0Oo](-[0Oo])?$/.test(castleish);
}

/**
 * Movetext -> ordered move tokens. Books write replies BARE (no "1..."
 * marker: "1.Bg5+ Ke8 2.Qh8#"), so every move-shaped token between markers
 * belongs to the mainline; prose asides ("double check", "only move") have
 * no square in them and drop out. Only the FIRST marker's dot count is
 * meaningful: "1." starts White, "1 ..." starts Black.
 */
export function parseMainline(body: string, book: BookText): Mainline | null {
  const clean = stripVariations(body.replace(/­\n?/g, '').replace(/\n/g, ' '));
  const scanner = /(\d{1,3})\s*((?:\.\s*)+)|(\S+)/g;
  const tokens: string[] = [];
  let startsBlack: boolean | null = null;
  let lastNumber = 0;
  let lastDots = 0;
  for (const m of clean.matchAll(scanner)) {
    if (book.moveMarkers === 'dotless' && m[3] !== undefined && /^\d{1,3}$/.test(m[3])) {
      // Bare numbers are move markers only while they advance 1,2,3… —
      // years and ratings in prose fail that and end the mainline.
      const number = Number(m[3]);
      if (number === lastNumber || number === lastNumber + 1) {
        if (startsBlack === null) startsBlack = false;
        lastNumber = number;
        continue;
      }
      if (lastNumber > 0) break;
      continue;
    }
    if (m[1] !== undefined) {
      const number = Number(m[1]);
      const dots = (m[2]!.match(/\./g) ?? []).length;
      if (startsBlack === null) startsBlack = dots >= 2;
      // A marker that does not ADVANCE ends the mainline: mate-in-one
      // entries list ALTERNATIVE solutions as "1.Rxh6# 1.Qh7# 1.Nf7#".
      else if (number < lastNumber || (number === lastNumber && dots <= lastDots)) break;
      lastNumber = number;
      lastDots = dots;
      continue;
    }
    const word = m[3]!;
    if (isMoveish(word)) tokens.push(word);
  }
  if (startsBlack === null || tokens.length === 0) return null;
  return { startsBlack, tokens };
}

/** number -> raw entry body, from the answers pages. */
export function solutionEntries(pages: TextPage[], book: BookText): Map<number, string> {
  // Interleaved books name their answer spans; the rest take everything
  // from the first page that looks like an answers page onwards.
  let solutionPages: TextPage[];
  if (book.solutionRanges) {
    const inRange = (page: number): boolean =>
      book.solutionRanges!.some(([lo, hi]) => page >= lo && page <= hi);
    solutionPages = pages.filter((p) => inRange(p.page));
  } else {
    const startPage = pages.findIndex(
      (p) =>
        p.page > book.solutionsAfterPage &&
        (book.anchorStyle === 'paren'
          ? /\d{1,4}\)\s/.test(p.text)
          : book.anchorStyle === 'dot'
            ? /(?:^|\n)\s{0,3}\d{1,4}\.\s+[A-Z]/.test(p.text)
            : /\d+\s*-\s*1\s*\./.test(p.text)),
    );
    solutionPages = pages.slice(startPage);
  }
  const joined = solutionPages.map((p) => p.text).join('\n');
  const out = new Map<number, string>();
  // Entry anchor: a puzzle number, a dash, then move one. The OCR detaches
  // leading digits ("103 -" scans as "1 03 -"), so digits may be spaced.
  const anchor = book.anchorPattern
    ? new RegExp(book.anchorPattern, 'g')
    : book.anchorStyle === 'paren'
      ? // Digits detach in these scans ("11)" reads as "1 1 )"), so the
        // number may be spaced and the bracket may drift off it.
        /(?:^|\n)\s{0,4}(\d(?:\s?\d){0,3})\s*\)\s/g
      : book.anchorStyle === 'dot'
        ? /(?:^|\n)\s{0,3}(\d{1,4})\.\s+(?=[A-Z])/g
        : /(?:^|\s)(\d(?:\s?\d){0,3})\s*-\s*(?=1\s*\.)/g;
  const hits = [...joined.matchAll(anchor)];
  for (let i = 0; i < hits.length; i++) {
    const value = Number(hits[i]![1]!.replace(/\s/g, ''));
    if (value < 1 || value > book.maxNumber) continue;
    const from = hits[i]!.index! + hits[i]![0].length;
    const to = i + 1 < hits.length ? hits[i + 1]!.index! : joined.length;
    if (!out.has(value)) out.set(value, joined.slice(from, to));
  }
  return out;
}

// --- move resolution ----------------------------------------------------------

export interface Resolution {
  ok: boolean;
  reason?: string;
  move?: Move;
  san?: string;
}

export function legalMoves(pos: Chess): NormalMove[] {
  const moves: NormalMove[] = [];
  for (const from of pos.board[pos.turn]) {
    for (const to of pos.dests(from)) {
      const piece = pos.board.get(from)!;
      if (piece.role === 'pawn' && (squareRank(to) === 0 || squareRank(to) === 7)) {
        for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as const) {
          moves.push({ from, to, promotion });
        }
      } else {
        moves.push({ from, to });
      }
    }
  }
  return moves;
}

const SQ = /[a-h][1-8]/g;

export function tokenPrefix(token: string): string | null {
  const squares = token.match(SQ);
  if (!squares) return null;
  const dest = squares[squares.length - 1]!;
  let prefix = token.slice(0, token.lastIndexOf(dest));
  prefix = prefix.replace(/[x!?+#\s]/g, '');
  if (prefix.length === 0) return null;
  // A bare file/rank letter is SAN disambiguation, not a figurine — but a
  // single NON-square character ("%" = this book's bishop) is learnable.
  if (prefix.length === 1 && /[a-h1-8]/.test(prefix)) return null;
  return prefix;
}

/**
 * The garbage the OCR makes of a figurine is CONSISTENT within a book
 * ("tt:l" is always the knight). Validated puzzles reveal which piece each
 * garbage prefix meant, and a later pass uses that to break ambiguities an
 * earlier one could not: the per-book dialect, learning itself.
 */
export class Dialect {
  private readonly stats = new Map<string, Map<Role, number>>();

  record(token: string, role: Role): void {
    const prefix = tokenPrefix(token);
    if (!prefix) return;
    const counts = this.stats.get(prefix) ?? new Map<Role, number>();
    counts.set(role, (counts.get(role) ?? 0) + 1);
    this.stats.set(prefix, counts);
  }

  /** Only prefixes seen often enough, and almost always meaning one piece. */
  hints(): Map<string, Role> {
    const out = new Map<string, Role>();
    for (const [prefix, counts] of this.stats) {
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const [bestRole, bestCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
      if (total >= 5 && bestCount / total >= 0.9) out.set(prefix, bestRole);
    }
    return out;
  }
}

/** In SAN a completely bare destination ("g2", "d6+!") is a PAWN move. */
function isBarePawnToken(token: string, dest: string): boolean {
  return token.replace(/[x!?+#\s]/g, '').replace(dest, '') === '';
}

export function resolveToken(
  pos: Chess,
  token: string,
  isLast: boolean,
  hints?: Map<string, Role>,
): Resolution {
  // Castling: two or three O/0 groups.
  const castleish = token.replace(/[^0Oo-]/g, '');
  if (/^[0Oo]-?[0Oo](-?[0Oo])?$/.test(castleish) && /[-]/.test(token)) {
    const san = castleish.replace(/0|o/g, 'O').split('-').length >= 3 ? 'O-O-O' : 'O-O';
    const move = parseSan(pos, san);
    if (!move) return { ok: false, reason: `illegal ${san}` };
    return { ok: true, move, san };
  }

  const squares = token.match(SQ);
  if (!squares) return { ok: false, reason: `no square in "${token}"` };
  const dest = squares[squares.length - 1]!;
  const destSq = dest.charCodeAt(0) - 97 + (dest.charCodeAt(1) - 49) * 8;
  const wantsCapture = token.includes('x');
  const claimsMate = token.includes('#');
  const claimsCheck = claimsMate || token.includes('+');

  let candidates = legalMoves(pos).filter((m) => m.to === destSq);
  if (wantsCapture) {
    candidates = candidates.filter(
      (m) =>
        pos.board.occupied.has(m.to) ||
        (pos.board.get(m.from)!.role === 'pawn' && pos.epSquare === m.to),
    );
  }
  const play = (m: Move): { san: string; mate: boolean; check: boolean } => {
    const copy = pos.clone();
    const san = makeSanAndPlay(copy, m);
    return { san, mate: copy.isCheckmate(), check: copy.isCheck() };
  };
  const narrow = (pred: (r: { mate: boolean; check: boolean }) => boolean): void => {
    if (candidates.length > 1) {
      const kept = candidates.filter((m) => pred(play(m)));
      if (kept.length > 0) candidates = kept;
    }
  };
  if (claimsMate && isLast) narrow((r) => r.mate);
  if (claimsCheck) narrow((r) => r.check);
  // No figurine, no disambiguator: SAN says that is a pawn move — and a
  // pawn CAPTURE would carry its file ("cxd6"), so bare means the push.
  if (candidates.length > 1 && isBarePawnToken(token, dest)) {
    const pawns = candidates.filter((m) => pos.board.get(m.from)!.role === 'pawn');
    if (pawns.length > 0) candidates = pawns;
    if (candidates.length > 1 && !wantsCapture) {
      const quiet = candidates.filter((m) => !pos.board.occupied.has(m.to));
      if (quiet.length > 0) candidates = quiet;
    }
  }
  // Learned figurine prefix -> piece type.
  if (candidates.length > 1 && hints) {
    const prefix = tokenPrefix(token);
    const role = prefix ? hints.get(prefix) : undefined;
    if (role) {
      const kept = candidates.filter((m) => pos.board.get(m.from)!.role === role);
      if (kept.length > 0) candidates = kept;
    }
  }
  // File hint: a genuine SAN file letter directly before the x/destination.
  if (candidates.length > 1) {
    const before = token.slice(0, token.lastIndexOf(dest));
    const hint = /([a-h])x?$/.exec(before)?.[1];
    if (hint) {
      const file = hint.charCodeAt(0) - 97;
      const kept = candidates.filter((m) => m.from % 8 === file);
      if (kept.length > 0) candidates = kept;
    }
  }
  // Promotion ambiguity only survives if several promo pieces satisfy all
  // constraints; a claimed mate usually pins it to one.
  if (candidates.length > 1) {
    const unique = new Set(candidates.map((m) => `${m.from}-${m.to}`));
    if (unique.size === 1 && candidates.every((m) => m.promotion)) {
      candidates = [candidates.find((m) => m.promotion === 'queen')!];
    }
  }
  if (candidates.length === 0) return { ok: false, reason: `no legal move to ${dest} ("${token}")` };
  if (candidates.length > 1) return { ok: false, reason: `ambiguous to ${dest} ("${token}")` };
  const move = candidates[0]!;
  const result = play(move);
  if (claimsMate && isLast && !result.mate) {
    return { ok: false, reason: `"${token}" claims mate, position is not mate` };
  }
  return { ok: true, move, san: result.san };
}

// --- assemble a position from a read board ------------------------------------

/**
 * Piece-count plausibility: replay can succeed with an inert phantom piece
 * parked off the action (Woodpecker's digit gutter read as a rook column
 * proved it), so a "validated" position must also be REACHABLE: per side,
 * max 8 pawns, 16 pieces, and no more extra majors/minors than missing
 * pawns can explain.
 */
export function saneCounts(placement: string): boolean {
  const counts = new Map<string, number>();
  for (const ch of placement) {
    if (/[a-zA-Z]/.test(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  for (const side of ['w', 'b'] as const) {
    const at = (c: string): number => counts.get(side === 'w' ? c.toUpperCase() : c) ?? 0;
    const pawns = at('p');
    const total = ['p', 'n', 'b', 'r', 'q', 'k'].reduce((sum, c) => sum + at(c), 0);
    if (pawns > 8 || total > 16) return false;
    const base: Record<string, number> = { n: 2, b: 2, r: 2, q: 1 };
    let extra = 0;
    for (const c of ['n', 'b', 'r', 'q']) extra += Math.max(0, at(c) - base[c]!);
    if (extra > 8 - pawns) return false;
  }
  return true;
}

/** Rights a diagram cannot state, inferred from untouched home squares. */
export function castlingRights(placement: string): string {
  const board = placement.split('/');
  const expand = (rank: string): string[] => {
    const out: string[] = [];
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') out.push(...(Array(Number(ch)).fill('') as string[]));
      else out.push(ch);
    }
    return out;
  };
  const r1 = expand(board[7] ?? '');
  const r8 = expand(board[0] ?? '');
  let rights = '';
  if (r1[4] === 'K' && r1[7] === 'R') rights += 'K';
  if (r1[4] === 'K' && r1[0] === 'R') rights += 'Q';
  if (r8[4] === 'k' && r8[7] === 'r') rights += 'k';
  if (r8[4] === 'k' && r8[0] === 'r') rights += 'q';
  return rights || '-';
}

/**
 * Replay a printed mainline on a read board. Success means the position,
 * the side to move and the solution all agree — one result validating three
 * inputs at once — and every token's piece is fed back to the dialect.
 */
export function replayLine(
  placement: string,
  side: 'w' | 'b',
  tokens: string[],
  dialect: Dialect,
  hints?: Map<string, Role>,
): { sans: string[] } | { fail: string } {
  if (!saneCounts(placement)) return { fail: 'implausible-piece-counts' };
  const setup = parseFen(`${placement} ${side} ${castlingRights(placement)} - 0 1`);
  if (setup.isErr) return { fail: 'bad-fen' };
  const posResult = Chess.fromSetup(setup.unwrap());
  if (posResult.isErr) return { fail: `illegal-position: ${String(posResult.error)}` };
  const pos = posResult.unwrap();
  const sans: string[] = [];
  const played: { token: string; role: Role }[] = [];
  for (const [i, token] of tokens.entries()) {
    const res = resolveToken(pos, token, i === tokens.length - 1, hints);
    if (!res.ok) return { fail: res.reason ?? 'unknown' };
    played.push({ token, role: pos.board.get((res.move as NormalMove).from)!.role });
    pos.play(res.move!);
    sans.push(res.san!);
  }
  for (const p of played) dialect.record(p.token, p.role);
  return { sans };
}
