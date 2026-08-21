import { type Gray } from './image';
import type { CellCandidates } from '@shared/bookRepair';
import type { CellLabel, CellReading } from './classify';

/**
 * The trained diagram cell classifier (scripts/ml/): a small folded-BN CNN
 * over 32×32 grayscale cells, 13 classes. Weights ship as a static asset
 * (web/public/models/) and inference is plain TypeScript — no runtime, no
 * network, works offline like everything else. Reads any book or board
 * style with no calibration; the per-book template path remains both the
 * fallback and the personalisation layer.
 *
 * Binary layout: 'CNET' magic, u32 LE manifest length, JSON manifest, then
 * for each layer weight-then-bias as little-endian f32.
 */

interface ConvLayer {
  kind: 'conv';
  outC: number;
  inC: number;
  weight: Float32Array;
  bias: Float32Array;
}

interface LinearLayer {
  kind: 'linear';
  outN: number;
  inN: number;
  weight: Float32Array;
  bias: Float32Array;
}

export interface CellNet {
  labels: string;
  convs: ConvLayer[];
  head: LinearLayer;
}

export function parseCellNet(buf: ArrayBuffer): CellNet {
  const view = new DataView(buf);
  if (view.getUint32(0, false) !== 0x434e4554) throw new Error('bad model magic');
  const headerLen = view.getUint32(4, true);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen))) as {
    labels: string;
    layers: { kind: string; shape: number[] }[];
  };
  let at = 8 + headerLen;
  const take = (n: number): Float32Array => {
    const out = new Float32Array(buf.slice(at, at + n * 4));
    at += n * 4;
    return out;
  };
  const convs: ConvLayer[] = [];
  let head: LinearLayer | null = null;
  for (const layer of manifest.layers) {
    if (layer.kind === 'conv') {
      const [outC, inC, kh, kw] = layer.shape as [number, number, number, number];
      convs.push({ kind: 'conv', outC, inC, weight: take(outC * inC * kh * kw), bias: take(outC) });
    } else {
      const [outN, inN] = layer.shape as [number, number];
      head = { kind: 'linear', outN, inN, weight: take(outN * inN), bias: take(outN) };
    }
  }
  if (!head || convs.length === 0) throw new Error('incomplete model');
  return { labels: manifest.labels, convs, head };
}

let cached: Promise<CellNet | null> | null = null;

/** Fetch-and-cache the bundled model; null when unavailable (fallback path). */
export function loadCellNet(): Promise<CellNet | null> {
  cached ??= fetch('/models/cellnet-v1.bin')
    .then(async (res) => {
      if (!res.ok) throw new Error(`model fetch ${res.status}`);
      return parseCellNet(await res.arrayBuffer());
    })
    .catch(() => null);
  return cached;
}

/**
 * 3×3 same-padding convolution + ReLU over CHW data.
 *
 * Half of a board read is this function — conv1 alone is 5.3M of the 10.8M
 * multiply-adds a 32² tile costs — so the edge of the image is worth
 * separating from the middle of it. Only the one-pixel border can fall
 * outside, and every interior pixel was paying two bounds checks per tap to
 * establish that it does not.
 *
 * The nine taps below are written out in the SAME order the general loop
 * visits them, and added one statement at a time rather than summed in one
 * expression, because float addition does not associate: reordering them
 * would change the last bits of the result and this has to stay the same
 * classifier. Verified against the old code over a whole board — every one
 * of the 64 tiles' 13 probabilities bit-identical.
 */
function convRelu(layer: ConvLayer, src: Float32Array, size: number): Float32Array {
  const { outC, inC, weight, bias } = layer;
  const out = new Float32Array(outC * size * size);
  const plane = size * size;
  const last = size - 1;

  /** The general case, for pixels that can hang off the edge. */
  const border = (oc: number, wBase: number, oBase: number, y: number, x: number): void => {
    let acc = bias[oc]!;
    for (let ic = 0; ic < inC; ic++) {
      const iBase = ic * plane;
      const wIC = wBase + ic * 9;
      for (let ky = -1; ky <= 1; ky++) {
        const sy = y + ky;
        if (sy < 0 || sy >= size) continue;
        const rowBase = iBase + sy * size;
        const wRow = wIC + (ky + 1) * 3;
        for (let kx = -1; kx <= 1; kx++) {
          const sx = x + kx;
          if (sx < 0 || sx >= size) continue;
          acc += weight[wRow + kx + 1]! * src[rowBase + sx]!;
        }
      }
    }
    out[oBase + y * size + x] = acc > 0 ? acc : 0;
  };

  for (let oc = 0; oc < outC; oc++) {
    const wBase = oc * inC * 9;
    const oBase = oc * plane;
    for (let x = 0; x < size; x++) border(oc, wBase, oBase, 0, x);
    for (let y = 1; y < last; y++) {
      border(oc, wBase, oBase, y, 0);
      for (let x = 1; x < last; x++) {
        let acc = bias[oc]!;
        for (let ic = 0; ic < inC; ic++) {
          const w = wBase + ic * 9;
          const r1 = ic * plane + y * size + x;
          const r0 = r1 - size;
          const r2 = r1 + size;
          acc += weight[w]! * src[r0 - 1]!;
          acc += weight[w + 1]! * src[r0]!;
          acc += weight[w + 2]! * src[r0 + 1]!;
          acc += weight[w + 3]! * src[r1 - 1]!;
          acc += weight[w + 4]! * src[r1]!;
          acc += weight[w + 5]! * src[r1 + 1]!;
          acc += weight[w + 6]! * src[r2 - 1]!;
          acc += weight[w + 7]! * src[r2]!;
          acc += weight[w + 8]! * src[r2 + 1]!;
        }
        out[oBase + y * size + x] = acc > 0 ? acc : 0;
      }
      border(oc, wBase, oBase, y, last);
    }
    if (last > 0) for (let x = 0; x < size; x++) border(oc, wBase, oBase, last, x);
  }
  return out;
}

function maxPool2(src: Float32Array, channels: number, size: number): Float32Array {
  const half = size / 2;
  const out = new Float32Array(channels * half * half);
  for (let c = 0; c < channels; c++) {
    const iBase = c * size * size;
    const oBase = c * half * half;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const i = iBase + 2 * y * size + 2 * x;
        out[oBase + y * half + x] = Math.max(src[i]!, src[i + 1]!, src[i + size]!, src[i + size + 1]!);
      }
    }
  }
  return out;
}

/** Softmax class probabilities for one 32×32 tile (values 0..1). */
export function runCellNet(net: CellNet, tile: Float32Array): Float32Array {
  let act = convRelu(net.convs[0]!, tile, 32);
  act = convRelu(net.convs[1]!, act, 32);
  act = maxPool2(act, net.convs[1]!.outC, 32);
  act = convRelu(net.convs[2]!, act, 16);
  act = maxPool2(act, net.convs[2]!.outC, 16);
  act = convRelu(net.convs[3]!, act, 8);
  // Global average pool.
  const channels = net.convs[3]!.outC;
  const pooled = new Float32Array(channels);
  for (let c = 0; c < channels; c++) {
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += act[c * 64 + i]!;
    pooled[c] = sum / 64;
  }
  const { outN, inN, weight, bias } = net.head;
  const logits = new Float32Array(outN);
  let max = -Infinity;
  for (let o = 0; o < outN; o++) {
    let acc = bias[o]!;
    for (let i = 0; i < inN; i++) acc += weight[o * inN + i]! * pooled[i]!;
    logits[o] = acc;
    if (acc > max) max = acc;
  }
  let denom = 0;
  for (let o = 0; o < outN; o++) {
    logits[o] = Math.exp(logits[o]! - max);
    denom += logits[o]!;
  }
  for (let o = 0; o < outN; o++) logits[o]! /= denom;
  return logits;
}

/** Bilinear-resize one board cell (64² of a 512² board) to the 32² input. */
export function cellTile(board: Gray, col: number, row: number): Float32Array {
  const cell = board.w / 8;
  const scale = cell / 32;
  const out = new Float32Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const sx = col * cell + (x + 0.5) * scale - 0.5;
      const sy = row * cell + (y + 0.5) * scale - 0.5;
      const x0 = Math.max(0, Math.min(board.w - 2, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(board.h - 2, Math.floor(sy)));
      const fx = Math.min(1, Math.max(0, sx - x0));
      const fy = Math.min(1, Math.max(0, sy - y0));
      const at = (xx: number, yy: number): number => board.data[yy * board.w + xx]!;
      out[y * 32 + x] =
        (at(x0, y0) * (1 - fx) * (1 - fy) +
          at(x0 + 1, y0) * fx * (1 - fy) +
          at(x0, y0 + 1) * (1 - fx) * fy +
          at(x0 + 1, y0 + 1) * fx * fy) / 255;
    }
  }
  return out;
}

/**
 * Read a board the way the REPAIR search needs it: every cell's whole class
 * distribution, plus how the same cell reads when the board is nudged.
 *
 * The nudges are the point. A cell the classifier is genuinely wrong about
 * tends to flip when the board moves two pixels, while its softmax margin
 * stays perfectly confident — so a disagreeing shifted read is a better
 * pointer at a misread cell than the probabilities are. Both go to the
 * search; see shared/bookRepair.ts.
 *
 * Five times the work of a plain read, so it is only ever run on the
 * handful of boards whose printed solution did NOT replay.
 */
export function classifyBoardDetailed(
  net: CellNet,
  board: Gray,
): { cells: CellCandidates[]; labels: string[] } {
  const shifted = ([[2, 0], [-2, 0], [0, 2], [0, -2]] as const).map(([dx, dy]) => {
    const data = new Uint8ClampedArray(board.w * board.h).fill(255);
    for (let y = 0; y < board.h; y++) {
      const sy = y + dy;
      if (sy < 0 || sy >= board.h) continue;
      for (let x = 0; x < board.w; x++) {
        const sx = x + dx;
        if (sx >= 0 && sx < board.w) data[y * board.w + x] = board.data[sy * board.w + sx]!;
      }
    }
    return { w: board.w, h: board.h, data };
  });

  const cells: CellCandidates[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const probs = runCellNet(net, cellTile(board, col, row));
      let top = 0;
      for (let i = 0; i < probs.length; i++) if (probs[i]! > probs[top]!) top = i;
      const votes = new Map<number, number>();
      for (const nudged of shifted) {
        const alt = runCellNet(net, cellTile(nudged, col, row));
        let at = 0;
        for (let i = 0; i < alt.length; i++) if (alt[i]! > alt[at]!) at = i;
        if (at !== top) votes.set(at, (votes.get(at) ?? 0) + 1);
      }
      cells.push({ probs, top, votes });
    }
  }
  return { cells, labels: [...net.labels] };
}

/**
 * Read all 64 cells of an aligned board. Confidence is the softmax margin
 * (top minus runner-up) — comparable to the template path's ratio test, so
 * callers keep their existing "check by eye" thresholds.
 */
export function classifyBoardNet(net: CellNet, board: Gray): CellReading[] {
  const out: CellReading[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const probs = runCellNet(net, cellTile(board, col, row));
      let top = 0;
      let second = 0;
      let topAt = 0;
      for (let i = 0; i < probs.length; i++) {
        const p = probs[i]!;
        if (p > top) {
          second = top;
          top = p;
          topAt = i;
        } else if (p > second) {
          second = p;
        }
      }
      const ch = net.labels[topAt]!;
      out.push({
        label: (ch === '1' ? 'empty' : ch) as CellLabel,
        confidence: top - second,
      });
    }
  }
  return out;
}
