/**
 * Read the diagrams an annotated-games book prints, so its games can be
 * anchored to positions instead of resting entirely on its move text.
 *
 *   python scripts/ml/harvest_pdfs.py "<book>.pdf" data/ml/<slug>-pages
 *   npx tsx scripts/ml/read-anchors.ts data/ml/<slug>-pages --book scripts/ml/books/<slug>.json
 *
 * A book of annotated games prints a diagram every few moves, marked "(D)"
 * on the move it follows. Those are checkpoints: whatever the scan did to
 * the move text, the position at that point is stated in pixels, and the
 * pixels are readable by the same CellNet the puzzle books use.
 *
 * Pairing is by reading order — the nth marker on a page is the nth diagram
 * on it — and the output is keyed the same way, so the importer can look up
 * an anchor without knowing anything about pixels.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectBoardQuad, detectDiagrams } from '../../web/src/puzzles/ocr/detect';
import { warpQuad, type Gray } from '../../web/src/puzzles/ocr/image';
import { classifyBoardNet, parseCellNet } from '../../web/src/puzzles/ocr/cellnet';
import { labelsToFen } from '../../web/src/puzzles/ocr/classify';
import { readingOrder } from '../../web/src/puzzles/ocr/derotate.ts';
import { REPO_ROOT } from '../../server/paths.ts';

const pagesDir = process.argv[2];
const bookAt = process.argv.indexOf('--book');
if (!pagesDir || bookAt < 0) {
  throw new Error('usage: read-anchors <pages_dir> --book scripts/ml/books/<slug>.json');
}
const BOOK = JSON.parse(readFileSync(process.argv[bookAt + 1]!, 'utf-8')) as {
  slug: string;
  lines: string;
};

interface Line {
  x0: number;
  y0: number;
  x1: number;
  text: string;
}
const { pages } = JSON.parse(readFileSync(resolve(REPO_ROOT, BOOK.lines), 'utf-8')) as {
  pages: { page: number; width: number; lines: Line[] }[];
};

const net = parseCellNet(
  readFileSync(resolve(REPO_ROOT, 'web', 'public', 'models', 'cellnet-v1.bin')).buffer.slice(
    0,
  ) as ArrayBuffer,
);

function loadGray(path: string): Gray | null {
  try {
    const buf = readFileSync(path);
    const w = buf.readUInt32LE(0);
    const h = buf.readUInt32LE(4);
    return { w, h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, w * h) };
  } catch {
    return null;
  }
}

/** One diagram, read into a placement. */
function readBoard(page: Gray, rect: { x: number; y: number; w: number; h: number }): {
  placement: string;
  unsure: number;
} {
  const m = Math.round(Math.min(rect.w, rect.h) * 0.04);
  const x0 = Math.max(0, Math.round(rect.x) - m);
  const y0 = Math.max(0, Math.round(rect.y) - m);
  const w = Math.min(page.w - x0, Math.round(rect.w) + 2 * m);
  const h = Math.min(page.h - y0, Math.round(rect.h) + 2 * m);
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    data.set(page.data.subarray((y0 + y) * page.w + x0, (y0 + y) * page.w + x0 + w), y * w);
  }
  const crop: Gray = { w, h, data };
  const quad = detectBoardQuad(crop) ?? [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const readings = classifyBoardNet(net, warpQuad(crop, quad));
  return {
    placement: labelsToFen(
      readings.map((r) => r.label),
      false,
    ).split(' ')[0]!,
    unsure: readings.filter((r) => r.confidence < 0.35).length,
  };
}

const anchors: Record<string, { placement: string; unsure: number }> = {};
let markers = 0;
let read = 0;
for (const info of pages) {
  const onPage = info.lines.filter((l) => /\(\s*D\s*\)/.test(l.text)).length;
  if (onPage === 0) continue;
  markers += onPage;
  const gray = loadGray(resolve(pagesDir, `page-${String(info.page).padStart(3, '0')}.gray`));
  if (!gray) continue;
  const rects = readingOrder(detectDiagrams(gray), gray.w);
  // More markers than diagrams (or the other way) means the pairing is not
  // certain on this page, so it is skipped rather than guessed at.
  if (rects.length !== onPage) continue;
  rects.forEach((rect, i) => {
    anchors[`${info.page}:${i}`] = readBoard(gray, rect);
    read++;
  });
}

const out = resolve(REPO_ROOT, 'data', 'ml', `${BOOK.slug}-anchors.json`);
writeFileSync(out, `${JSON.stringify(anchors, null, 1)}\n`);
console.log(`${markers} printed diagrams, ${read} read and paired -> ${out}`);
