/**
 * Read the PIECE SYMBOLS a book prints, when the text layer has mangled
 * them into garbage.
 *
 * A figurine font puts a little knight in the text where SAN would write
 * N, and a scan's OCR turns that into whatever it happens to look like —
 * "tt:l", "'2l", "lD". The text-only dialect (see bookImport.ts) works out
 * what those mean by aligning solutions it managed to replay against the
 * moves they produced, which settles the COMMON ones. The rare ones never
 * appear in enough solved lines to be settled that way.
 *
 * They can be read instead of inferred: the glyph is printed right there
 * on the page. Crop the symbol at the head of each move, learn what each
 * piece looks like from the prefixes the text already settled, and read
 * the rest off the page.
 *
 * Measured on 1001 Chess Exercises: 707 solutions replay without this and
 * 732 with it.
 */
import type { Role } from 'chessops/types';

/** A single-channel image; the same shape the vision half passes around. */
export interface GrayLike {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** Every glyph is squashed to this before being compared. */
const GLYPH_W = 16;
const GLYPH_H = 24;

/** The pieces a figurine can be. Pawns have no symbol — that is the point. */
const GLYPH_ROLES: Role[] = ['knight', 'bishop', 'rook', 'queen', 'king'];

/** One glyph read off a page, with the garbled prefix it was printed as. */
export interface GlyphSample {
  prefix: string;
  /** GLYPH_W × GLYPH_H, ink as 1 and paper as 0. */
  pixels: Float32Array;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Dark blobs in a crop, as bounding boxes.
 *
 * Flood fill rather than anything cleverer: a word box is a few hundred
 * pixels, and the whole point is to find where one symbol ends and the
 * letters after it begin.
 */
function components(img: GrayLike): Box[] {
  const seen = new Uint8Array(img.w * img.h);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || img.data[start]! >= 128) continue;
    let x0 = start % img.w;
    let x1 = x0;
    let y0 = Math.floor(start / img.w);
    let y1 = y0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop()!;
      const x = at % img.w;
      const y = Math.floor(at / img.w);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= img.w || ny >= img.h) continue;
        const next = ny * img.w + nx;
        if (seen[next] || img.data[next]! >= 128) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    boxes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
  }
  return boxes;
}

/**
 * The figurine at the head of a move: the leftmost blob tall enough to be
 * a piece rather than a quote mark or an accent, which the scans are full
 * of and which sit exactly where the symbol does.
 */
function leadingGlyph(word: GrayLike): Box | null {
  const tall = components(word).filter((b) => b.y1 - b.y0 >= word.h * 0.5);
  if (tall.length === 0) return null;
  return tall.reduce((best, b) => (b.x0 < best.x0 ? b : best));
}

/** Squash a box to the standard tile, ink-positive so blank is zero. */
function normalise(word: GrayLike, box: Box): Float32Array {
  const out = new Float32Array(GLYPH_W * GLYPH_H);
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      // Nearest-neighbour: these tiles are tiny and the comparison is a
      // correlation, which does not care about the smoothing.
      const sx = Math.min(bw - 1, Math.floor((x * bw) / GLYPH_W));
      const sy = Math.min(bh - 1, Math.floor((y * bh) / GLYPH_H));
      const px = word.data[(box.y0 + sy) * word.w + (box.x0 + sx)] ?? 255;
      out[y * GLYPH_W + x] = 1 - px / 255;
    }
  }
  return out;
}

/** Read the piece symbol printed at the start of one word, if there is one. */
export function readGlyph(page: GrayLike, box: Box): Float32Array | null {
  const x0 = Math.max(0, Math.floor(box.x0) - 1);
  const y0 = Math.max(0, Math.floor(box.y0) - 1);
  const x1 = Math.min(page.w, Math.ceil(box.x1) + 1);
  const y1 = Math.min(page.h, Math.ceil(box.y1) + 1);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 1 || h <= 1) return null;
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    data.set(page.data.subarray((y0 + y) * page.w + x0, (y0 + y) * page.w + x0 + w), y * w);
  }
  const word: GrayLike = { w, h, data };
  const glyph = leadingGlyph(word);
  return glyph ? normalise(word, glyph) : null;
}

/** Mean image per role — the whole model. */
function centroids(samples: GlyphSample[], labels: number[]): Float32Array[] {
  return GLYPH_ROLES.map((_, role) => {
    const mean = new Float32Array(GLYPH_W * GLYPH_H);
    let n = 0;
    for (let at = 0; at < samples.length; at++) {
      if (labels[at] !== role) continue;
      const pixels = samples[at]!.pixels;
      for (let i = 0; i < mean.length; i++) mean[i] = mean[i]! + pixels[i]!;
      n++;
    }
    if (n > 0) for (let i = 0; i < mean.length; i++) mean[i] = mean[i]! / n;
    return mean;
  });
}

/** Correlation against each centroid; brightness and contrast cancel out. */
function bestRole(model: Float32Array[], crop: Float32Array): { role: number; score: number } {
  const centre = (v: Float32Array): { values: Float32Array; norm: number } => {
    let mean = 0;
    for (const x of v) mean += x;
    mean /= v.length;
    const values = new Float32Array(v.length);
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      values[i] = v[i]! - mean;
      norm += values[i]! * values[i]!;
    }
    return { values, norm: Math.sqrt(norm) };
  };
  const a = centre(crop);
  let role = 0;
  let score = -Infinity;
  for (let r = 0; r < model.length; r++) {
    const b = centre(model[r]!);
    let dot = 0;
    for (let i = 0; i < a.values.length; i++) dot += a.values[i]! * b.values[i]!;
    const sim = dot / (a.norm * b.norm + 1e-6);
    if (sim > score) {
      score = sim;
      role = r;
    }
  }
  return { role, score };
}

/** A repeated glyph must agree with itself this often to become a hint. */
const AGREEMENT = 0.8;
/** And each reading must look at least this much like the piece it claims. */
const CONFIDENCE = 0.6;

/**
 * Learn what the book's piece symbols look like, then read the prefixes
 * the text could not settle.
 *
 * @param samples every move-leading glyph found on the answer pages
 * @param settled prefixes the text half already resolved, which are the
 *   labels the model is trained on
 */
export function learnGlyphHints(
  samples: GlyphSample[],
  settled: Map<string, Role>,
): Map<string, Role> {
  const labelled: GlyphSample[] = [];
  const labels: number[] = [];
  for (const sample of samples) {
    const role = settled.get(sample.prefix);
    const at = role ? GLYPH_ROLES.indexOf(role) : -1;
    if (at >= 0) {
      labelled.push(sample);
      labels.push(at);
    }
  }
  // Every piece has to have been seen, or the model has a hole it will
  // confidently fill with the wrong answer.
  const seen = new Set(labels);
  if (seen.size < GLYPH_ROLES.length) return new Map();

  const model = centroids(labelled, labels);
  const votes = new Map<string, Map<number, number>>();
  for (const sample of samples) {
    const { role, score } = bestRole(model, sample.pixels);
    if (score < CONFIDENCE) continue;
    const tally = votes.get(sample.prefix) ?? new Map<number, number>();
    tally.set(role, (tally.get(role) ?? 0) + 1);
    votes.set(sample.prefix, tally);
  }

  const hints = new Map<string, Role>();
  for (const [prefix, tally] of votes) {
    let total = 0;
    let bestRoleIndex = -1;
    let bestCount = 0;
    for (const [role, count] of tally) {
      total += count;
      if (count > bestCount) {
        bestCount = count;
        bestRoleIndex = role;
      }
    }
    if (bestRoleIndex >= 0 && bestCount / total >= AGREEMENT) {
      hints.set(prefix, GLYPH_ROLES[bestRoleIndex]!);
    }
  }
  return hints;
}
