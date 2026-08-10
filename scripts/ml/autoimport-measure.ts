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
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Role } from 'chessops/types';
import {
  Dialect,
  chapterSides,
  pageMateGoal,
  pageNumbers,
  parseMainline,
  replayLine,
  solutionEntries as parseSolutionEntries,
  type BookText,
} from '../../shared/bookImport.ts';
import { detectBoardQuad, detectDiagrams } from '../../web/src/puzzles/ocr/detect';
import { warpQuad, type Gray } from '../../web/src/puzzles/ocr/image';
import { cellTile, classifyBoardNet, parseCellNet, runCellNet } from '../../web/src/puzzles/ocr/cellnet';
import { labelsToFen } from '../../web/src/puzzles/ocr/classify';

const REPO = resolve(import.meta.dirname, '..', '..');
const RENDER_WIDTH = 1400;

// --- inputs -------------------------------------------------------------------

const pagesDir = process.argv[2];
if (!pagesDir) throw new Error('usage: autoimport-measure <pages_dir> [--book <config.json>] [--limit N] [--emit <dir>]');

// --book <config>: every book-specific fact lives in scripts/ml/books/*.json.
// Defaults preserve the original 1001 behaviour (and its artifact names).
const bookAt = process.argv.indexOf('--book');
const BOOK = {
  slug: '1001',
  title: '1001 Chess Exercises for Beginners',
  pages: [5, 105] as [number, number],
  solutionsAfterPage: 100,
  /** Books whose answers are interleaved (one section per chapter) list the
   *  page spans here; it replaces the "everything after solutionsAfterPage"
   *  rule, which would swallow the puzzle pages in between. */
  solutionRanges: null as [number, number][] | null,
  maxNumber: 1001,
  text: 'data/ml/1001-text.json',
  cache: 'data/ml/1001-reads.json',
  report: 'data/ml/autoimport-report.json',
  /** 'bare' = plain digits above the diagram; 'paren' = "123)". */
  numberStyle: 'bare' as 'bare' | 'paren',
  /** Solutions entry anchor: 'dash' = "N - 1."; 'paren' = "N) ...". */
  anchorStyle: 'dash' as 'dash' | 'paren' | 'dot',
  /** 'dotted' = "1.e4 / 1 ... e5" markers; 'dotless' = "1 e4". */
  moveMarkers: 'dotted' as 'dotted' | 'dotless',
  /** Where the side to move is printed: a chapter header, a per-puzzle
   *  "White to play" label, or a bare 'W'/'B' letter under the number. */
  sideMode: 'chapter' as 'chapter' | 'label' | 'letter',
  /** How far (render px) a number label may sit left of / above its diagram. */
  labelX: 20,
  labelY: 40,
  /** How far BELOW the diagram top a label's baseline may sit (margin
   *  labels print beside the top corner, not above it). */
  labelDrop: 14,
  /** Fractions of the detected rect to trim before READING the board
   *  (left, top, right, bottom) — for books that print coordinates in a
   *  gutter outside the frame, which would warp into the cells. */
  cropTrim: [0, 0, 0, 0] as [number, number, number, number],
  ...(bookAt > 0
    ? (JSON.parse(readFileSync(process.argv[bookAt + 1]!, 'utf-8')) as object)
    : {}),
};
/** True when the book prints the side beside each puzzle, however it does
 *  it — those books trust their own label over the chapter carry-over. */
const SIDE_IS_PRINTED = BOOK.sideMode === 'label' || BOOK.sideMode === 'letter';
/** How far a side label may sit outside the diagram horizontally. Margin
 *  layouts print it further out than in-frame ones, and that distance is
 *  already described by labelX. */
const SIDE_LABEL_X = Math.max(60, BOOK.labelX);

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
// --jobs N: page reads and the repair search shard across N child
// processes of this same script (--read-shard / --repair-shard are the
// child modes). Reads land in per-shard cache files the parent merges;
// repairs come back as JSON the parent applies before reporting.
const jobsAt = process.argv.indexOf('--jobs');
const jobs = jobsAt > 0 ? Math.max(1, Number(process.argv[jobsAt + 1])) : 1;
const readShardAt = process.argv.indexOf('--read-shard');
const readShard = readShardAt > 0 ? [Number(process.argv[readShardAt + 1]), Number(process.argv[readShardAt + 2])] : null;
const repairShardAt = process.argv.indexOf('--repair-shard');
const repairShard = repairShardAt > 0 ? [Number(process.argv[repairShardAt + 1]), Number(process.argv[repairShardAt + 2])] : null;

async function runShards(mode: string, n: number, strip: string[] = []): Promise<void> {
  const drop = new Set<number>();
  for (const flag of ['--jobs', ...strip]) {
    const at = process.argv.indexOf(flag);
    if (at > 0) {
      drop.add(at); // the flag itself…
      drop.add(at + 1); // …and its value
    }
  }
  const base = process.argv.slice(1).filter((_, i) => !drop.has(i + 1));
  await Promise.all(
    [...Array(n).keys()].map(
      (i) =>
        new Promise<void>((done, fail) => {
          const child = spawn(process.execPath, [...process.execArgv, ...base, mode, String(i), String(n)], {
            stdio: 'inherit',
          });
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${mode} ${i} exited ${code}`))));
        }),
    ),
  );
}

const extraAt = process.argv.indexOf('--extra-labels');
const extraLabels: { page: number; rect: { x: number; y: number; w: number; h: number }; read: number }[] =
  extraAt > 0
    ? (JSON.parse(readFileSync(process.argv[extraAt + 1]!, 'utf-8')) as typeof extraLabels)
    : [];

const net = parseCellNet(
  readFileSync(resolve(REPO, 'web', 'public', 'models', 'cellnet-v1.bin')).buffer.slice(0) as ArrayBuffer,
);
const textData = JSON.parse(
  readFileSync(resolve(REPO, BOOK.text), 'utf-8'),
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
  /** Set when pass 4 corrected the board read (number of cells changed). */
  repairedCells?: number;
  /** Multiple repairs replayed the line and TTA could not break the tie;
   *  the import settles these with the engine + book-square overlap. */
  repairCandidates?: { fen: string; side: 'w' | 'b'; sans: string[]; edits: number }[];
  /** Side printed beside THIS puzzle (sideMode 'label' books). */
  sideStated?: 'w' | 'b';
}

/** Reading rect: the detect rect minus the configured coordinate gutter. */
function readRect(rect: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const [l, t, r, b] = BOOK.cropTrim;
  return {
    x: Math.round(rect.x + rect.w * l),
    y: Math.round(rect.y + rect.h * t),
    w: Math.round(rect.w * (1 - l - r)),
    h: Math.round(rect.h * (1 - t - b)),
  };
}

/** One dialect per run, learned from every line that replays. */
const dialect = new Dialect();
const results = new Map<number, PuzzleResult>();
const solutions = parseSolutionEntries(textData.pages, BOOK as BookText);
console.log(`${solutions.size} solution entries parsed from the text layer`);

// Board reads are deterministic and slow (~1 s each); cache them across runs.
const cachePath = resolve(REPO, BOOK.cache);
type CachedRead = {
  fen: string;
  uncertain: number;
  page: number;
  rect?: { x: number; y: number; w: number; h: number };
  sideStated?: 'w' | 'b';
};
let readCache = new Map<number, CachedRead>();
try {
  readCache = new Map(
    (JSON.parse(readFileSync(cachePath, 'utf-8')) as [number, CachedRead][]),
  );
  console.log(`read cache: ${readCache.size} boards`);
} catch {
  // first run
}

// Parent with --jobs: farm the pixel reads out, merge shard caches, and
// let the normal loop below find everything already cached.
if (jobs > 1 && !readShard && !repairShard) {
  await runShards('--read-shard', jobs);
  for (let i = 0; i < jobs; i++) {
    const shardPath = `${cachePath}.shard${i}`;
    if (!existsSync(shardPath)) continue;
    for (const [value, cached] of JSON.parse(readFileSync(shardPath, 'utf-8')) as [number, CachedRead][]) {
      readCache.set(value, cached);
    }
  }
  writeFileSync(cachePath, JSON.stringify([...readCache.entries()]));
}

let boardsRead = 0;
let pageIndex = -1;
for (const pageInfo of textData.pages) {
  pageIndex++;
  if (readShard && pageIndex % readShard[1]! !== readShard[0]!) continue;
  if (readShard) {
    // Shard mode reads pixels regardless of the shared cache.
    for (const c of [...readCache.keys()]) {
      if (readCache.get(c)!.page === pageInfo.page) readCache.delete(c);
    }
  }
  if (boardsRead >= limit) break;
  if (pageInfo.page < BOOK.pages[0] || pageInfo.page > BOOK.pages[1]) continue;
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
  const numbers = pageNumbers(pageInfo.words, BOOK as BookText).map((n) => ({
    value: n.value,
    x0: n.x0 * scale,
    x1: n.x1 * scale,
    y1: n.y1 * scale,
  }));
  const sideLabels: { side: 'w' | 'b'; x: number; y: number }[] = [];
  const letterSides = new Map<number, 'w' | 'b'>();
  if (BOOK.sideMode === 'label') {
    const ws = pageInfo.words;
    for (let i = 0; i + 2 < ws.length; i++) {
      if (!/^(White|Black)$/i.test(ws[i]!.text)) continue;
      if (!/^to$/i.test(ws[i + 1]!.text) || !/^play$/i.test(ws[i + 2]!.text)) continue;
      sideLabels.push({
        side: ws[i]!.text[0]!.toLowerCase() === 'w' ? 'w' : 'b',
        x: ws[i]!.x0 * scale,
        y: ws[i]!.y0 * scale,
      });
    }
  } else if (BOOK.sideMode === 'letter') {
    // A lone 'W' or 'B' printed directly under the puzzle number. Prose is
    // full of stray capitals, so the letter only counts when it sits under
    // a number box — and that binding is exact, so the side attaches to the
    // NUMBER rather than being matched to a diagram by geometry. Two puzzle
    // columns per page would otherwise be within reach of each other.
    for (const w of pageInfo.words) {
      if (!/^[WB]$/.test(w.text)) continue;
      const under = pageNumbers(pageInfo.words, BOOK as BookText).find(
        (n) => Math.abs(n.x0 - w.x0) < 6 && w.y0 >= n.y1 - 2 && w.y0 - n.y1 < 8,
      );
      if (under) letterSides.set(under.value, w.text === 'W' ? 'w' : 'b');
    }
  }
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
      results.set(value, { number: value, page: cached.page, fen: cached.fen, uncertain: cached.uncertain, status: 'read', rect: cached.rect, sideStated: cached.sideStated });
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
          n.y1 <= rect.y + BOOK.labelDrop &&
          rect.y - n.y1 <= BOOK.labelY &&
          n.x1 >= rect.x - BOOK.labelX &&
          n.x0 <= rect.x + rect.w,
      )
      .sort((a, b) => b.y1 - a.y1);
    const label = candidates[0];
    if (!label) continue;
    // Numbers are unique in the book; the first (earliest-page) claim wins.
    if (results.has(label.value)) continue;
    const rr = readRect(rect);
    const m = Math.round(Math.min(rr.w, rr.h) * 0.04);
    const x0 = Math.max(0, Math.round(rr.x) - m);
    const y0 = Math.max(0, Math.round(rr.y) - m);
    const w = Math.min(pageGray.w - x0, Math.round(rr.w) + 2 * m);
    const h = Math.min(pageGray.h - y0, Math.round(rr.h) + 2 * m);
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

    const stated =
      BOOK.sideMode === 'letter'
        ? letterSides.get(label.value)
        : BOOK.sideMode === 'label'
          ? sideLabels
              .filter((l) => l.x > rect.x - SIDE_LABEL_X && l.x < rect.x + rect.w + SIDE_LABEL_X)
              .sort(
                (a, b) =>
                  Math.min(Math.abs(a.y - rect.y), Math.abs(a.y - (rect.y + rect.h))) -
                  Math.min(Math.abs(b.y - rect.y), Math.abs(b.y - (rect.y + rect.h))),
              )[0]?.side
          : undefined;
    results.set(label.value, {
      number: label.value,
      page: pageInfo.page,
      fen,
      uncertain,
      status: 'read',
      ...(stated ? { sideStated: stated } : {}),
      mateIn: pageMateGoal(textData.pages.find((p) => p.page === pageInfo.page)?.text ?? ''),
      rect: {
        x: rect.x / pageGray.w,
        y: rect.y / pageGray.h,
        w: rect.w / pageGray.w,
        h: rect.h / pageGray.h,
      },
    });
    readCache.set(label.value, { fen, uncertain, page: pageInfo.page, rect: results.get(label.value)!.rect, sideStated: results.get(label.value)!.sideStated });
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
if (readShard) {
  const mine = [...readCache.entries()].filter(([, c]) =>
    textData.pages.some((p, i) => p.page === c.page && i % readShard[1]! === readShard[0]!),
  );
  writeFileSync(`${cachePath}.shard${readShard[0]}`, JSON.stringify(mine));
  process.exit(0);
}
writeFileSync(cachePath, JSON.stringify([...readCache.entries()]));

// --- validate: pass 1 (no hints), learn the figurine dialect, pass 2 ----------

// Chapter pages state the side to move ("White to move and mate in two");
// pages inherit the most recent statement. lanph3re spotted this — it beats
// trusting the OCR's dots, which flip the side when "1 ..." loses a dot.
const chapterSide = chapterSides(textData.pages);

function validateEntry(entry: PuzzleResult, hints?: Map<string, Role>): void {
  const solution = solutions.get(entry.number);
  if (!solution) {
    entry.status = 'no-solution-text';
    // The per-puzzle printed label outranks the chapter fallback (lanph3re's
    // CCW #4: label said Black, chapter carry-over said White).
    entry.side ??= entry.sideStated ?? chapterSide.get(entry.page);
    return;
  }
  // Corroboration data for the engine-hybrid import: every square the book's
  // entry mentions (variations included — the author wrote about the TRUE
  // position, which is exactly what a misread board would fail to overlap).
  entry.squares = [...new Set(solution.match(/[a-h][1-8]/g) ?? [])];
  const mainline = parseMainline(solution, BOOK as BookText);
  if (!mainline) {
    entry.status = 'unparseable-solution';
    entry.side ??= entry.sideStated ?? chapterSide.get(entry.page);
    return;
  }
  entry.side = mainline.startsBlack ? 'b' : 'w';
  if (SIDE_IS_PRINTED && entry.sideStated) entry.side = entry.sideStated;
  const outcome = replayLine(entry.fen!, entry.side, mainline.tokens, dialect, hints);
  if ('fail' in outcome) {
    // The dots-derived side may be OCR damage; the book's stated side
    // (or its opposite, for label books) gets one shot before failing.
    const stated = SIDE_IS_PRINTED
      ? ((entry.side === 'w' ? 'b' : 'w') as 'w' | 'b')
      : chapterSide.get(entry.page);
    if (stated && stated !== entry.side) {
      const retry = replayLine(entry.fen!, stated, mainline.tokens, dialect, hints);
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
const hints = dialect.hints();
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
const glyph: Record<string, Role> =
  glyphAt > 0 ? (JSON.parse(readFileSync(process.argv[glyphAt + 1]!, 'utf-8')) as Record<string, Role>) : {};
const mergedHints = new Map<string, Role>([...Object.entries(glyph), ...hints]);
if (glyphAt > 0) {
  let rescued3 = 0;
  for (const entry of results.values()) {
    if (entry.status !== 'replay-failed') continue;
    validateEntry(entry, mergedHints);
    if ((entry.status as string) === 'validated') rescued3++;
  }
  console.log(`pass 3 with ${Object.keys(glyph).length} glyph hints rescued ${rescued3} puzzles`);
}

// --- pass 4: solution-constrained board repair --------------------------------
//
// ~99.4% per-cell accuracy means only ~0.994^64 ≈ 68% of boards read
// perfectly; most failures are one or two wrong cells. The book's own
// mainline is a checksum strong enough to find them: try the classifier's
// runner-up labels on its least-confident cells and accept a repair only
// when EXACTLY ONE candidate position makes the whole solution replay
// (and any claimed mate check out).
if (process.argv.includes('--repair')) {
  if (jobs > 1 && !repairShard) {
    // Children re-derive validation identically from the shared cache
    // (no pixels except their own failing boards), repair their slice of
    // the numbers, and hand the fixes back.
    await runShards('--repair-shard', jobs, ['--emit']);
    let applied = 0;
    for (let i = 0; i < jobs; i++) {
      const shardPath = `${resolve(REPO, BOOK.report)}.repairs${i}`;
      if (!existsSync(shardPath)) continue;
      const shard = JSON.parse(readFileSync(shardPath, 'utf-8')) as {
        repairs: { number: number; fen: string; side: 'w' | 'b'; sans: string[]; repairedCells: number }[];
        candidates: { number: number; candidates: NonNullable<PuzzleResult['repairCandidates']> }[];
      };
      for (const r of shard.repairs) {
        const entry = results.get(r.number);
        if (!entry) continue;
        entry.fen = r.fen;
        entry.side = r.side;
        entry.sans = r.sans;
        entry.status = 'validated';
        entry.repairedCells = r.repairedCells;
        delete entry.detail;
        applied++;
      }
      for (const c of shard.candidates) {
        const entry = results.get(c.number);
        if (entry) entry.repairCandidates = c.candidates;
      }
    }
    console.log(`pass 4 board repair (parallel x${jobs}): ${applied} rescued`);
  } else {
  const repairsOut: { number: number; fen: string; side: 'w' | 'b'; sans: string[]; repairedCells: number }[] = [];
  const candidatesOut: { number: number; candidates: NonNullable<PuzzleResult['repairCandidates']> }[] = [];
  const pageCacheR = new Map<number, Gray | null>();
  const loadPageR = (page: number): Gray | null => {
    if (!pageCacheR.has(page)) {
      try {
        pageCacheR.set(page, loadGray(resolve(pagesDir, `page-${String(page).padStart(3, '0')}.gray`)));
      } catch {
        pageCacheR.set(page, null);
      }
    }
    return pageCacheR.get(page)!;
  };

  let repaired = 0;
  let ambiguous = 0;
  const byEdits = new Map<number, number>();
  for (const entry of results.values()) {
    if (entry.status !== 'replay-failed' && entry.status !== 'illegal-position') continue;
    if (repairShard && entry.number % repairShard[1]! !== repairShard[0]!) continue;
    if (!entry.rect) continue;
    const solution = solutions.get(entry.number);
    if (!solution) continue;
    const mainline = parseMainline(solution, BOOK as BookText);
    if (!mainline) continue;
    const sides: ('w' | 'b')[] = [mainline.startsBlack ? 'b' : 'w'];
    const stated = chapterSide.get(entry.page);
    if (stated && !sides.includes(stated)) sides.push(stated);

    const page = loadPageR(entry.page);
    if (!page) continue;
    const rect = readRect({
      x: Math.round(entry.rect.x * page.w),
      y: Math.round(entry.rect.y * page.h),
      w: Math.round(entry.rect.w * page.w),
      h: Math.round(entry.rect.h * page.h),
    });
    const m = Math.round(Math.min(rect.w, rect.h) * 0.04);
    const x0 = Math.max(0, rect.x - m);
    const y0 = Math.max(0, rect.y - m);
    const w = Math.min(page.w - x0, rect.w + 2 * m);
    const h = Math.min(page.h - y0, rect.h + 2 * m);
    const cropData = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      cropData.set(page.data.subarray((y0 + y) * page.w + x0, (y0 + y) * page.w + x0 + w), y * w);
    }
    const quad = detectBoardQuad({ w, h, data: cropData }) ?? [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    const board = warpQuad({ w, h, data: cropData }, quad);

    // Full class distributions for every cell, plus test-time
    // augmentation: the same board re-read under small shifts. Cells
    // whose augmented votes disagree with the base label are where the
    // classifier is actually wrong far more often than the softmax
    // margin admits — they lead the repair search.
    const shifted: Gray[] = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => {
      const data = new Uint8ClampedArray(board.w * board.h).fill(255);
      for (let y = 0; y < board.h; y++) {
        const sy = y + dy!;
        if (sy < 0 || sy >= board.h) continue;
        for (let x = 0; x < board.w; x++) {
          const sx = x + dx!;
          if (sx >= 0 && sx < board.w) data[y * board.w + x] = board.data[sy * board.w + sx]!;
        }
      }
      return { w: board.w, h: board.h, data };
    });
    const cells: { probs: Float32Array; top: number; votes: Map<number, number> }[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const probs = runCellNet(net, cellTile(board, col, row));
        let top = 0;
        for (let i = 0; i < probs.length; i++) if (probs[i]! > probs[top]!) top = i;
        const votes = new Map<number, number>();
        for (const aug of shifted) {
          const ap = runCellNet(net, cellTile(aug, col, row));
          let at = 0;
          for (let i = 0; i < ap.length; i++) if (ap[i]! > ap[at]!) at = i;
          if (at !== top) votes.set(at, (votes.get(at) ?? 0) + 1);
        }
        cells.push({ probs, top, votes });
      }
    }
    const labels = cells.map((c) => net.labels[c.top]!);
    // Disagreeing TTA votes outrank probability runner-ups; no floor —
    // the uniqueness gate protects against inventions.
    const alternates = (i: number, take: number): number[] => {
      const c = cells[i]!;
      const voted = [...c.votes.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const byProb = [...c.probs.keys()]
        .filter((k) => k !== c.top && !voted.includes(k))
        .sort((a, b) => c.probs[b]! - c.probs[a]!);
      return [...voted, ...byProb].slice(0, take);
    };

    const test = (
      ls: string[],
    ): { fen: string; side: 'w' | 'b'; sans: string[] } | null => {
      const fen = labelsToFen(
        ls.map((ch) => (ch === '1' ? 'empty' : ch)) as Parameters<typeof labelsToFen>[0],
        false,
      ).split(' ')[0]!;
      for (const side of sides) {
        const outcome = replayLine(fen, side, mainline.tokens, dialect, mergedHints);
        if (!('fail' in outcome)) return { fen, side, sans: outcome.sans };
      }
      return null;
    };

    const wins = new Map<string, { side: 'w' | 'b'; sans: string[]; edits: number; cells: [number, number][] }>();
    // 1-cell repairs across the whole board.
    for (let i = 0; i < 64; i++) {
      for (const alt of alternates(i, 3)) {
        const ls = labels.slice();
        ls[i] = net.labels[alt]!;
        const got = test(ls);
        if (got) wins.set(got.fen, { side: got.side, sans: got.sans, edits: 1, cells: [[i, alt]] });
      }
    }
    // 2-cell repairs only among the least-confident cells, and only if no
    // single edit worked — a wider net would start inventing positions.
    const margin = (i: number): number => {
      const p = [...cells[i]!.probs].sort((a, b) => b - a);
      return p[0]! - p[1]!;
    };
    const disagree = (i: number): number => [...cells[i]!.votes.values()].reduce((s, v) => s + v, 0);
    const shaky = [...Array(64).keys()]
      .sort((a, b) => disagree(b) - disagree(a) || margin(a) - margin(b))
      .slice(0, 20);
    if (wins.size === 0) {
      for (let a = 0; a < shaky.length; a++) {
        for (let b = a + 1; b < shaky.length; b++) {
          for (const altA of alternates(shaky[a]!, 2)) {
            for (const altB of alternates(shaky[b]!, 2)) {
              const ls = labels.slice();
              ls[shaky[a]!] = net.labels[altA]!;
              ls[shaky[b]!] = net.labels[altB]!;
              const got = test(ls);
              if (got) wins.set(got.fen, { side: got.side, sans: got.sans, edits: 2, cells: [[shaky[a]!, altA], [shaky[b]!, altB]] });
            }
          }
        }
      }
    }
    // 3-cell repairs: an even tighter pool, reached only when nothing
    // simpler replayed. The uniqueness gate, TTA-support tie-break and
    // sanity counts are what keep this from inventing positions.
    if (wins.size === 0) {
      const pool = shaky.slice(0, 12);
      for (let a = 0; a < pool.length; a++) {
        for (let b = a + 1; b < pool.length; b++) {
          for (let c = b + 1; c < pool.length; c++) {
            for (const altA of alternates(pool[a]!, 2)) {
              for (const altB of alternates(pool[b]!, 2)) {
                for (const altC of alternates(pool[c]!, 2)) {
                  const ls = labels.slice();
                  ls[pool[a]!] = net.labels[altA]!;
                  ls[pool[b]!] = net.labels[altB]!;
                  ls[pool[c]!] = net.labels[altC]!;
                  const got = test(ls);
                  if (got) wins.set(got.fen, { side: got.side, sans: got.sans, edits: 3, cells: [[pool[a]!, altA], [pool[b]!, altB], [pool[c]!, altC]] });
                }
              }
            }
          }
        }
      }
    }

    if (wins.size > 1) {
      // Several positions replay the line: accept the one the augmented
      // votes actually support, if a single winner emerges.
      const support = (w: { cells: [number, number][] }): number =>
        w.cells.reduce((sum, [i, alt]) => sum + (cells[i]!.votes.get(alt) ?? 0), 0);
      const ranked = [...wins.entries()].sort((a, b) => support(b[1]) - support(a[1]));
      if (support(ranked[0]![1]) > 0 && (ranked.length < 2 || support(ranked[0]![1]) > support(ranked[1]![1]))) {
        wins.clear();
        wins.set(ranked[0]![0], ranked[0]![1]);
      }
    }
    if (wins.size === 1) {
      const [fen, win] = [...wins.entries()][0]!;
      entry.fen = fen;
      entry.side = win.side;
      entry.sans = win.sans;
      entry.status = 'validated';
      entry.repairedCells = win.edits;
      delete entry.detail;
      repairsOut.push({ number: entry.number, fen, side: win.side, sans: win.sans, repairedCells: win.edits });
      repaired++;
      byEdits.set(win.edits, (byEdits.get(win.edits) ?? 0) + 1);
    } else if (wins.size > 1) {
      ambiguous++;
      entry.repairCandidates = [...wins.entries()]
        .slice(0, 4)
        .map(([fen, w]) => ({ fen, side: w.side, sans: w.sans, edits: w.edits }));
      candidatesOut.push({ number: entry.number, candidates: entry.repairCandidates });
    }
  }
  console.log(
    `pass 4 board repair: ${repaired} rescued (${byEdits.get(1) ?? 0} one-cell, ${byEdits.get(2) ?? 0} two-cell, ${byEdits.get(3) ?? 0} three-cell), ${ambiguous} ambiguous left alone`,
  );
  if (repairShard) {
    writeFileSync(
      `${resolve(REPO, BOOK.report)}.repairs${repairShard[0]}`,
      JSON.stringify({ repairs: repairsOut, candidates: candidatesOut }),
    );
    process.exit(0);
  }
  }
}

// --- report -------------------------------------------------------------------

const byStatus = new Map<string, number>();
for (const r of results.values()) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
const validated = [...results.values()].filter((r) => r.status === 'validated');

console.log(`\n=== auto-import measurement: ${BOOK.title} ===`);
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
  resolve(REPO, BOOK.report),
  JSON.stringify([...results.values()], null, 1),
);
console.log(`\nfull report -> ${BOOK.report}`);
