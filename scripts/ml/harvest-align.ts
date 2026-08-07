// Detect diagrams on rendered book pages (raw .gray dumps) and align each to
// a 512x512 board via the app's own pipeline, for pseudo-labeling.
// Usage: npx tsx scripts/ml/harvest-align.ts <pages_dir> <out_dir> <book_tag>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectBoardQuad, detectDiagrams } from '../../web/src/puzzles/ocr/detect';
import { warpQuad, type Gray } from '../../web/src/puzzles/ocr/image';

const [pagesDir, outDir, tag] = process.argv.slice(2);
if (!pagesDir || !outDir || !tag) throw new Error('usage: harvest-align <pages> <out> <tag>');
mkdirSync(outDir, { recursive: true });

function loadGray(path: string): Gray {
  const buf = readFileSync(path);
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  return { w, h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, w * h) };
}

function crop(src: Gray, x0: number, y0: number, w: number, h: number): Gray {
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    data.set(src.data.subarray((y0 + y) * src.w + x0, (y0 + y) * src.w + x0 + w), y * w);
  }
  return { w, h, data };
}

let boards = 0;
for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.gray')).sort()) {
  const page = loadGray(resolve(pagesDir, file));
  for (const [i, r] of detectDiagrams(page).entries()) {
    // Margin so the corner detector sees the whole border like a real crop.
    const m = Math.round(Math.min(r.w, r.h) * 0.04);
    const x0 = Math.max(0, r.x - m);
    const y0 = Math.max(0, r.y - m);
    const cropped = crop(page, x0, y0, Math.min(page.w - x0, r.w + 2 * m), Math.min(page.h - y0, r.h + 2 * m));
    const quad = detectBoardQuad(cropped) ?? [
      { x: 0, y: 0 },
      { x: cropped.w, y: 0 },
      { x: cropped.w, y: cropped.h },
      { x: 0, y: cropped.h },
    ];
    const board = warpQuad(cropped, quad, 512);
    const out = Buffer.alloc(8 + 512 * 512);
    out.writeUInt32LE(512, 0);
    out.writeUInt32LE(512, 4);
    Buffer.from(board.data.buffer, board.data.byteOffset, 512 * 512).copy(out, 8);
    writeFileSync(resolve(outDir, `${tag}-${file.replace('.gray', '')}-${i}.gray`), out);
    boards++;
  }
}
console.log(`${tag}: ${boards} boards -> ${outDir}`);
