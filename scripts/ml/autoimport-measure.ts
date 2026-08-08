// Auto-import measurement for '1001 Chess Exercises for Beginners'.
//
// Pipeline per puzzle: diagram detected on the rendered page -> matched to
// its printed number (nearest number-word above the diagram, from the PDF
// text layer) -> position read by the SHIPPED CellNet -> solution parsed
// from the book's OCR'd solutions text -> mainline replayed with chessops.
//
// The figurine letters are OCR garbage ("tt:l" = knight...), so moves are
// resolved STRUCTURALLY: destination square + capture/check/mate flags +
// legality against the recognized position. A puzzle VALIDATES when every
// mainline move resolves uniquely and a claimed mate is a real checkmate —
// which simultaneously confirms the position, the side to move and the
// solution.
//
// Usage: npx tsx scripts/ml/autoimport-measure.ts <pages_dir> [--limit N]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { squareRank } from 'chessops/util';
import type { Move, NormalMove } from 'chessops/types';
import { detectBoardQuad, detectDiagrams } from '../../web/src/puzzles/ocr/detect';
import { warpQuad, type Gray } from '../../web/src/puzzles/ocr/image';
import { classifyBoardNet, parseCellNet } from '../../web/src/puzzles/ocr/cellnet';
import { labelsToFen } from '../../web/src/puzzles/ocr/classify';

const REPO = resolve(import.meta.dirname, '..', '..');
const RENDER_WIDTH = 1400;

// --- inputs -------------------------------------------------------------------

const pagesDir = process.argv[2];
if (!pagesDir) throw new Error('usage: autoimport-measure <pages_dir> [--limit N] [--emit <dir>]');
const limitAt = process.argv.indexOf('--limit');
const limit = limitAt > 0 ? Number(process.argv[limitAt + 1]) : Infinity;
// --emit dumps per-puzzle board grays + per-page grays for the import step's
// evidence images; forces fresh page reads (the cache has no pixels).
const emitAt = process.argv.indexOf('--emit');
const emitDir = emitAt > 0 ? process.argv[emitAt + 1]! : null;
if (emitDir) mkdirSync(emitDir, { recursive: true });

// --extra-labels: numbers recovered by the image-side digit reader
// (scripts/ml/digit_labels.py) for diagrams whose printed number the PDF
// text layer lost. Each { page, rect (page fractions), read } becomes a
// synthetic label box just above its diagram, so the normal matching,
// reading and validation flow picks the diagram up like any other.
const extraAt = process.argv.indexOf('--extra-labels');
const extraLabels: { page: number; rect: { x: number; y: number; w: number; h: number }; read: number }[] =
  extraAt > 0
    ? (JSON.parse(readFileSync(process.argv[extraAt + 1]!, 'utf-8')) as typeof extraLabels)
    : [];

const net = parseCellNet(
  readFileSync(resolve(REPO, 'web', 'public', 'models', 'cellnet-v1.bin')).buffer.slice(0) as ArrayBuffer,
);
const textData = JSON.parse(
  readFileSync(resolve(REPO, 'data', 'ml', '1001-text.json'), 'utf-8'),
) as {
  pages: {
    page: number;
    width: number;
    words: { x0: number; y0: number; x1: number; y1: number; text: string }[];
    text: string;
  }[];
};

function loadGray(path: string): Gray {
  const buf = readFileSync(path);
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  return { w, h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, w * h) };
}

// --- puzzle-number labels -----------------------------------------------------

interface NumberBox {
  value: number;
  x0: number;
  y1: number;
  x1: number;
}

/** Digit words merged into numbers ("1 0 3" is three words in this scan). */
function pageNumbers(words: { x0: number; y0: number; x1: number; y1: number; text: string }[]): NumberBox[] {
  const digits = words
    .filter((w) => /^\d{1,4}$/.test(w.text))
    .sort((a, b) => (Math.abs(a.y0 - b.y0) < 3 ? a.x0 - b.x0 : a.y0 - b.y0));
  const out: NumberBox[] = [];
  let run: typeof digits = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const text = run.map((w) => w.text).join('');
    const value = Number(text);
    if (value >= 1 && value <= 1001 && text.length <= 4) {
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

// --- solutions text -----------------------------------------------------------

/** Strip [] and () variation blocks, nesting-aware. */
function stripVariations(text: string): string {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

interface Mainline {
  startsBlack: boolean;
  tokens: string[];
}

/** A token is move-shaped when it holds a square or a castling pattern. */
function isMoveish(token: string): boolean {
  if (/[a-h][1-8]/.test(token)) return true;
  const castleish = token.replace(/[^0Oo-]/g, '');
  return /^[0Oo]-[0Oo](-[0Oo])?$/.test(castleish);
}

/**
 * Movetext -> ordered move tokens. The book writes replies BARE (no "1..."
 * marker: "1.Bg5+ Ke8 2.Qh8#"), so every move-shaped token between markers
 * belongs to the mainline; prose asides ("double check", "only move") have
 * no square in them and drop out. Only the FIRST marker's dot count is
 * meaningful: "1." starts White, "1 ..." starts Black.
 */
function parseMainline(body: string): Mainline | null {
  const clean = stripVariations(body.replace(/­\n?/g, '').replace(/\n/g, ' '));
  const scanner = /(\d{1,3})\s*((?:\.\s*)+)|(\S+)/g;
  const tokens: string[] = [];
  let startsBlack: boolean | null = null;
  let lastNumber = 0;
  let lastDots = 0;
  for (const m of clean.matchAll(scanner)) {
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

/** number -> raw entry body, from the solutions pages. */
function solutionEntries(): Map<number, string> {
  const startPage = textData.pages.findIndex(
    (p) => p.page > 100 && /\d+\s*-\s*1\s*\./.test(p.text),
  );
  const joined = textData.pages
    .slice(startPage)
    .map((p) => p.text)
    .join('\n');
  const out = new Map<number, string>();
  // Entry anchor: a puzzle number, a dash, then move one. The OCR detaches
  // leading digits ("103 -" scans as "1 03 -"), so digits may be spaced.
  const anchor = /(?:^|\s)(\d(?:\s?\d){0,3})\s*-\s*(?=1\s*\.)/g;
  const hits = [...joined.matchAll(anchor)];
  for (let i = 0; i < hits.length; i++) {
    const value = Number(hits[i]![1]!.replace(/\s/g, ''));
    if (value < 1 || value > 1001) continue;
    const from = hits[i]!.index! + hits[i]![0].length;
    const to = i + 1 < hits.length ? hits[i + 1]!.index! : joined.length;
    if (!out.has(value)) out.set(value, joined.slice(from, to));
  }
  return out;
}

// --- move resolution ----------------------------------------------------------

interface Resolution {
  ok: boolean;
  reason?: string;
  move?: Move;
  san?: string;
}

function legalMoves(pos: Chess): NormalMove[] {
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
type Role = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

/**
 * The garbage the OCR makes of a figurine is CONSISTENT within a book
 * ("tt:l" is always the knight). Validated puzzles reveal which piece each
 * garbage prefix meant; pass 2 uses that to break ambiguities pass 1 could
 * not. This is the per-book "dialect" learning itself automatically.
 */
const prefixStats = new Map<string, Map<Role, number>>();

function tokenPrefix(token: string): string | null {
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

/** In SAN a completely bare destination ("g2", "d6+!") is a PAWN move. */
function isBarePawnToken(token: string, dest: string): boolean {
  return token.replace(/[x!?+#\s]/g, '').replace(dest, '') === '';
}

function recordPrefix(token: string, role: Role): void {
  const prefix = tokenPrefix(token);
  if (!prefix) return;
  const counts = prefixStats.get(prefix) ?? new Map<Role, number>();
  counts.set(role, (counts.get(role) ?? 0) + 1);
  prefixStats.set(prefix, counts);
}

function learnedHints(): Map<string, Role> {
  const out = new Map<string, Role>();
  for (const [prefix, counts] of prefixStats) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const [bestRole, bestCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (total >= 5 && bestCount / total >= 0.9) out.set(prefix, bestRole);
  }
  return out;
}

function resolveToken(
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
  const destSq = (dest.charCodeAt(0) - 97) + (dest.charCodeAt(1) - 49) * 8;
  const wantsCapture = token.includes('x');
  const claimsMate = token.includes('#');
  const claimsCheck = claimsMate || token.includes('+');

  let candidates = legalMoves(pos).filter((m) => m.to === destSq);
  if (wantsCapture) {
    candidates = candidates.filter(
      (m) => pos.board.occupied.has(m.to) || (pos.board.get(m.from)!.role === 'pawn' && pos.epSquare === m.to),
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
      const queen = candidates.find((m) => m.promotion === 'queen')!;
      candidates = [queen];
    }
  }
  if (candidates.length === 0) return { ok: false, reason: `no legal move to ${dest} ("${token}")` };
  if (candidates.length > 1) return { ok: false, reason: `ambiguous to ${dest} ("${token}")` };
  const move = candidates[0]!;
  const result = play(move);
  if (claimsMate && isLast && !result.mate) return { ok: false, reason: `"${token}" claims mate, position is not mate` };
  return { ok: true, move, san: result.san };
}

// --- assemble position --------------------------------------------------------

function castlingRights(placement: string): string {
  const board = placement.split('/');
  const rank1 = board[7]!;
  const rank8 = board[0]!;
  const expand = (rank: string): string[] => {
    const out: string[] = [];
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') out.push(...Array(Number(ch)).fill(''));
      else out.push(ch);
    }
    return out;
  };
  const r1 = expand(rank1);
  const r8 = expand(rank8);
  let rights = '';
  if (r1[4] === 'K' && r1[7] === 'R') rights += 'K';
  if (r1[4] === 'K' && r1[0] === 'R') rights += 'Q';
  if (r8[4] === 'k' && r8[7] === 'r') rights += 'k';
  if (r8[4] === 'k' && r8[0] === 'r') rights += 'q';
  return rights || '-';
}

// --- main ---------------------------------------------------------------------

interface PuzzleResult {
  number: number;
  page: number;
  fen?: string;
  uncertain?: number;
  side?: 'w' | 'b';
  sans?: string[];
  status: string;
  detail?: string;
  /** Section goal from the page header, e.g. mate depth (0 = not a mate section). */
  mateIn?: number;
  /** Squares mentioned anywhere in the solution entry — corroboration data. */
  squares?: string[];
  /** Diagram bounds as FRACTIONS of the page — resolution-independent, the
   *  UI draws the highlight over the page image with these. */
  rect?: { x: number; y: number; w: number; h: number };
}

const MATE_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function pageMateGoal(text: string): number {
  const m = /mate in (\w+)/i.exec(text);
  if (!m) return 0;
  const word = m[1]!.toLowerCase();
  return MATE_WORDS[word] ?? (Number(word) > 0 && Number(word) < 9 ? Number(word) : 0);
}

/** Replay a mainline; on success record each token's piece for learning. */
function replay(
  fen: string,
  side: 'w' | 'b',
  tokens: string[],
  hints?: Map<string, Role>,
): { sans: string[] } | { fail: string } {
  const fullFen = `${fen} ${side} ${castlingRights(fen)} - 0 1`;
  const setup = parseFen(fullFen);
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
  for (const p of played) recordPrefix(p.token, p.role);
  return { sans };
}

const results = new Map<number, PuzzleResult>();
const solutions = solutionEntries();
console.log(`${solutions.size} solution entries parsed from the text layer`);

// Board reads are deterministic and slow (~1 s each); cache them across runs.
const cachePath = resolve(REPO, 'data', 'ml', '1001-reads.json');
let readCache = new Map<number, { fen: string; uncertain: number; page: number; rect?: { x: number; y: number; w: number; h: number } }>();
try {
  readCache = new Map(
    (JSON.parse(readFileSync(cachePath, 'utf-8')) as [number, { fen: string; uncertain: number; page: number; rect?: { x: number; y: number; w: number; h: number } }][]),
  );
  console.log(`read cache: ${readCache.size} boards`);
} catch {
  // first run
}

let boardsRead = 0;
for (const pageInfo of textData.pages) {
  if (boardsRead >= limit) break;
  if (pageInfo.page < 5 || pageInfo.page > 105) continue;
  let page: Gray | null = null;
  const pageExtras = extraLabels.filter((e) => e.page === pageInfo.page);
  const needsPage =
    emitDir !== null ||
    pageExtras.length > 0 ||
    ![...readCache.values()].some((c) => c.page === pageInfo.page);
  if (needsPage) {
    try {
      page = loadGray(resolve(pagesDir, `page-${String(pageInfo.page).padStart(3, '0')}.gray`));
    } catch {
      continue;
    }
  }
  const scale = RENDER_WIDTH / pageInfo.width;
  const numbers = pageNumbers(pageInfo.words).map((n) => ({
    value: n.value,
    x0: n.x0 * scale,
    x1: n.x1 * scale,
    y1: n.y1 * scale,
  }));
  if (page) {
    for (const e of pageExtras) {
      numbers.push({
        value: e.read,
        x0: e.rect.x * page.w,
        x1: (e.rect.x + 0.03) * page.w,
        y1: e.rect.y * page.h - 2,
      });
    }
  }
  if (!needsPage) {
    for (const [value, cached] of readCache) {
      if (cached.page !== pageInfo.page || results.has(value)) continue;
      boardsRead++;
      results.set(value, { number: value, page: cached.page, fen: cached.fen, uncertain: cached.uncertain, status: 'read', rect: cached.rect });
    }
    continue;
  }
  for (const rect of detectDiagrams(page!)) {
    if (boardsRead >= limit) break;
    const pageGray = page!;
    // The printed number sits JUST above the diagram (within ~40px scaled),
    // left-aligned-ish. A loose "anywhere above" match lets stray digits on
    // prose pages steal labels — hence the tight vertical band.
    const candidates = numbers
      .filter(
        (n) =>
          n.y1 <= rect.y + 14 &&
          rect.y - n.y1 <= 40 &&
          n.x1 >= rect.x - 20 &&
          n.x0 <= rect.x + rect.w,
      )
      .sort((a, b) => b.y1 - a.y1);
    const label = candidates[0];
    if (!label) continue;
    // Numbers are unique in the book; the first (earliest-page) claim wins.
    if (results.has(label.value)) continue;
    const m = Math.round(Math.min(rect.w, rect.h) * 0.04);
    const x0 = Math.max(0, rect.x - m);
    const y0 = Math.max(0, rect.y - m);
    const w = Math.min(pageGray.w - x0, rect.w + 2 * m);
    const h = Math.min(pageGray.h - y0, rect.h + 2 * m);
    const cropData = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      cropData.set(pageGray.data.subarray((y0 + y) * pageGray.w + x0, (y0 + y) * pageGray.w + x0 + w), y * w);
    }
    const crop: Gray = { w, h, data: cropData };
    const quad = detectBoardQuad(crop) ?? [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    const board = warpQuad(crop, quad);
    const readings = classifyBoardNet(net, board);
    const fen = labelsToFen(readings.map((r) => r.label), false).split(' ')[0]!;
    const uncertain = readings.filter((r) => r.confidence < 0.35).length;
    boardsRead++;

    results.set(label.value, {
      number: label.value,
      page: pageInfo.page,
      fen,
      uncertain,
      status: 'read',
      mateIn: pageMateGoal(textData.pages.find((p) => p.page === pageInfo.page)?.text ?? ''),
      rect: {
        x: rect.x / pageGray.w,
        y: rect.y / pageGray.h,
        w: rect.w / pageGray.w,
        h: rect.h / pageGray.h,
      },
    });
    readCache.set(label.value, { fen, uncertain, page: pageInfo.page, rect: results.get(label.value)!.rect });
    if (emitDir) {
      const out = Buffer.alloc(8 + 512 * 512);
      out.writeUInt32LE(512, 0);
      out.writeUInt32LE(512, 4);
      Buffer.from(board.data.buffer, board.data.byteOffset, 512 * 512).copy(out, 8);
      writeFileSync(resolve(emitDir, `n${label.value}.gray`), out);
      const pageCopy = resolve(emitDir, `page${String(pageInfo.page).padStart(3, '0')}.gray`);
      if (!existsSync(pageCopy)) {
        copyFileSync(resolve(pagesDir, `page-${String(pageInfo.page).padStart(3, '0')}.gray`), pageCopy);
      }
    }
  }
  if (pageInfo.page % 20 === 0) console.log(`page ${pageInfo.page}: ${results.size} puzzles so far`);
}
writeFileSync(cachePath, JSON.stringify([...readCache.entries()]));

// --- validate: pass 1 (no hints), learn the figurine dialect, pass 2 ----------

// Chapter pages state the side to move ("White to move and mate in two");
// pages inherit the most recent statement. lanph3re spotted this — it beats
// trusting the OCR's dots, which flip the side when "1 ..." loses a dot.
const chapterSide = new Map<number, 'w' | 'b'>();
{
  let current: 'w' | 'b' | null = null;
  for (const p of [...textData.pages].sort((a, b) => a.page - b.page)) {
    const m = /(white|black)\s+to\s+(?:move|play)/i.exec(p.text);
    if (m) current = m[1]!.toLowerCase() === 'white' ? 'w' : 'b';
    if (current) chapterSide.set(p.page, current);
  }
}

function validateEntry(entry: PuzzleResult, hints?: Map<string, Role>): void {
  const solution = solutions.get(entry.number);
  if (!solution) {
    entry.status = 'no-solution-text';
    entry.side ??= chapterSide.get(entry.page);
    return;
  }
  // Corroboration data for the engine-hybrid import: every square the book's
  // entry mentions (variations included — the author wrote about the TRUE
  // position, which is exactly what a misread board would fail to overlap).
  entry.squares = [...new Set(solution.match(/[a-h][1-8]/g) ?? [])];
  const mainline = parseMainline(solution);
  if (!mainline) {
    entry.status = 'unparseable-solution';
    return;
  }
  entry.side = mainline.startsBlack ? 'b' : 'w';
  const outcome = replay(entry.fen!, entry.side, mainline.tokens, hints);
  if ('fail' in outcome) {
    // The dots-derived side may be OCR damage; the chapter's stated side
    // gets one shot before the entry is declared failed.
    const stated = chapterSide.get(entry.page);
    if (stated && stated !== entry.side) {
      const retry = replay(entry.fen!, stated, mainline.tokens, hints);
      if (!('fail' in retry)) {
        entry.side = stated;
        entry.status = 'validated';
        entry.sans = retry.sans;
        return;
      }
    }
    entry.status = outcome.fail.startsWith('illegal-position') ? 'illegal-position' : 'replay-failed';
    entry.detail = outcome.fail;
  } else {
    entry.status = 'validated';
    entry.sans = outcome.sans;
  }
}

for (const entry of results.values()) validateEntry(entry);
const hints = learnedHints();
console.log(`\nlearned figurine dialect (${hints.size} prefixes):`);
for (const [prefix, role] of [...hints.entries()].slice(0, 12)) {
  console.log(`  ${JSON.stringify(prefix)} -> ${role}`);
}
let rescued = 0;
for (const entry of results.values()) {
  if (entry.status !== 'replay-failed') continue;
  validateEntry(entry, hints);
  // validateEntry mutates status; widen so TS forgets the narrowing.
  if ((entry.status as string) === 'validated') rescued++;
}
console.log(`pass 2 with learned dialect rescued ${rescued} puzzles`);

// Pass 3, image-derived: --glyph-hints (scripts/ml/figurine_glyphs.py reads
// the printed figurine glyphs) covers prefixes too rare for the text-only
// dialect. The dialect keeps priority where both know a prefix.
const glyphAt = process.argv.indexOf('--glyph-hints');
if (glyphAt > 0) {
  const glyph = JSON.parse(readFileSync(process.argv[glyphAt + 1]!, 'utf-8')) as Record<
    string,
    Role
  >;
  const merged = new Map<string, Role>([...Object.entries(glyph), ...hints]);
  let rescued3 = 0;
  for (const entry of results.values()) {
    if (entry.status !== 'replay-failed') continue;
    validateEntry(entry, merged);
    if ((entry.status as string) === 'validated') rescued3++;
  }
  console.log(`pass 3 with ${Object.keys(glyph).length} glyph hints rescued ${rescued3} puzzles`);
}

// --- report -------------------------------------------------------------------

const byStatus = new Map<string, number>();
for (const r of results.values()) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
const validated = [...results.values()].filter((r) => r.status === 'validated');

console.log('\n=== auto-import measurement: 1001 Chess Exercises ===');
console.log(`diagrams matched to puzzle numbers: ${results.size}`);
for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status}: ${count}`);
}
console.log(`validated (position+side+solution all consistent): ${validated.length}`);
const mates = validated.filter((r) => r.sans!.at(-1)?.includes('#')).length;
console.log(`  of which end in verified checkmate: ${mates}`);

const failures = [...results.values()].filter((r) => r.status === 'replay-failed').slice(0, 12);
console.log('\nsample failures:');
for (const f of failures) console.log(`  #${f.number} (p${f.page}, ${f.uncertain} unsure): ${f.detail}`);

console.log('\nsample validated:');
for (const v of validated.slice(0, 6)) {
  console.log(`  #${v.number}: ${v.fen} ${v.side} | ${v.sans!.join(' ')}`);
}

writeFileSync(
  resolve(REPO, 'data', 'ml', 'autoimport-report.json'),
  JSON.stringify([...results.values()], null, 1),
);
console.log('\nfull report -> data/ml/autoimport-report.json');
