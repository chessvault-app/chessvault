import { FEATURE_PX } from './image';

/**
 * Per-book template matching (lanph3re's design): a printed book renders every
 * piece with ONE font at ONE size, so after the first confirmed diagram
 * teaches us what this book's pieces look like, nearest-template matching
 * reads the rest. No model, no network — and every confirmed diagram adds
 * templates, so accuracy climbs as the book fills in.
 */

export type CellLabel =
  | 'empty'
  | 'P' | 'N' | 'B' | 'R' | 'Q' | 'K'
  | 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

const LABELS: ReadonlySet<string> = new Set([
  'empty', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k',
]);

export interface Template {
  label: CellLabel;
  /** Base64 of FEATURE_PX² raw grayscale bytes (see cellFeature). */
  feature: string;
}

export interface CellReading {
  label: CellLabel;
  /**
   * 0..1; the ratio-test margin between the best match and the best match
   * of a DIFFERENT label. Low values mean "check this square by eye".
   */
  confidence: number;
}

const FEATURE_LEN = FEATURE_PX * FEATURE_PX;
/** Keep at most this many templates per label (newest win). */
const PER_LABEL_CAP = 16;
/** A new template this close to an existing same-label one adds nothing. */
const DUPLICATE_DISTANCE = 4;

function encodeFeature(feature: Uint8Array): string {
  let bin = '';
  for (const byte of feature) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function decodeFeature(encoded: string): Uint8Array {
  const bin = atob(encoded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isValidTemplate(value: unknown): value is Template {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as { label?: unknown; feature?: unknown };
  if (typeof t.label !== 'string' || !LABELS.has(t.label)) return false;
  if (typeof t.feature !== 'string') return false;
  try {
    return decodeFeature(t.feature).length === FEATURE_LEN;
  } catch {
    return false;
  }
}

/**
 * Zero-mean, unit-variance floats: printing density and photo exposure
 * vary between shots, shape does not.
 */
function normalize(feature: Uint8Array): Float32Array {
  let sum = 0;
  for (const v of feature) sum += v;
  const mean = sum / feature.length;
  let varSum = 0;
  for (const v of feature) varSum += (v - mean) ** 2;
  const std = Math.sqrt(varSum / feature.length) || 1;
  const out = new Float32Array(feature.length);
  for (let i = 0; i < feature.length; i++) out[i] = (feature[i]! - mean) / std;
  return out;
}

function distance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return sum;
}

/**
 * Nearest template wins; confidence is 1 − d_best/d_otherLabel (0 when a
 * different label matches just as well, →1 when the winner is unambiguous).
 */
function classifyCell(
  feature: Uint8Array,
  templates: Template[],
): CellReading {
  const probe = normalize(feature);
  let best: { label: CellLabel; d: number } | null = null;
  let bestOther = Infinity;
  for (const t of templates) {
    const d = distance(probe, normalize(decodeFeature(t.feature)));
    if (!best || d < best.d) {
      if (best && best.label !== t.label) bestOther = Math.min(bestOther, best.d);
      best = { label: t.label, d };
    } else if (t.label !== best.label && d < bestOther) {
      bestOther = d;
    }
  }
  if (!best) return { label: 'empty', confidence: 0 };
  const confidence = bestOther === Infinity ? 1 : Math.max(0, 1 - best.d / bestOther);
  return { label: best.label, confidence };
}

export function classifyBoard(cells: Uint8Array[], templates: Template[]): CellReading[] {
  return cells.map((cell) => classifyCell(cell, templates));
}

/**
 * FEN piece placement from 64 cell labels (row-major from the image's
 * top-left). `blackAtBottom` says the photo shows the board from Black's
 * side, so the image reads h1..a8 instead of a8..h1.
 */
export function labelsToFen(labels: CellLabel[], blackAtBottom: boolean): string {
  const ranks: string[] = [];
  for (let rank = 0; rank < 8; rank++) {
    let row = '';
    let run = 0;
    for (let file = 0; file < 8; file++) {
      const index = blackAtBottom ? (7 - rank) * 8 + (7 - file) : rank * 8 + file;
      const label = labels[index]!;
      if (label === 'empty') {
        run++;
      } else {
        if (run > 0) row += run;
        run = 0;
        row += label;
      }
    }
    if (run > 0) row += run;
    ranks.push(row);
  }
  return `${ranks.join('/')} w - - 0 1`;
}

/** Inverse of labelsToFen: cell labels (image order) from a FEN. */
export function fenToLabels(fen: string, blackAtBottom: boolean): CellLabel[] {
  const placement = fen.split(' ')[0]!;
  const grid: CellLabel[] = [];
  for (const rank of placement.split('/')) {
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        for (let i = 0; i < Number(ch); i++) grid.push('empty');
      } else {
        grid.push(ch as CellLabel);
      }
    }
  }
  if (!blackAtBottom) return grid;
  return grid.map((_, i) => grid[63 - i]!);
}

/**
 * Learn from a confirmed diagram: every cell becomes a template labelled
 * by the position the user just verified. Near-duplicates are skipped and
 * each label keeps its newest PER_LABEL_CAP entries, so the store stays
 * small no matter how many puzzles a book has.
 */
export function harvestTemplates(
  cells: Uint8Array[],
  confirmedFen: string,
  blackAtBottom: boolean,
  existing: Template[],
): Template[] {
  const labels = fenToLabels(confirmedFen, blackAtBottom);
  const result = [...existing];
  for (let i = 0; i < 64; i++) {
    const label = labels[i]!;
    const probe = normalize(cells[i]!);
    const duplicate = result.some(
      (t) =>
        t.label === label && distance(probe, normalize(decodeFeature(t.feature))) < DUPLICATE_DISTANCE,
    );
    if (duplicate) continue;
    result.push({ label, feature: encodeFeature(cells[i]!) });
  }
  // Enforce the per-label cap, newest first.
  const byLabel = new Map<CellLabel, number>();
  const trimmed: Template[] = [];
  for (let i = result.length - 1; i >= 0; i--) {
    const t = result[i]!;
    const count = byLabel.get(t.label) ?? 0;
    if (count >= PER_LABEL_CAP) continue;
    byLabel.set(t.label, count + 1);
    trimmed.push(t);
  }
  return trimmed.reverse();
}
