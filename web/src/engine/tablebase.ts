import { t } from '@/lib/i18n';

/**
 * Client side of the tablebase verdict: eligibility, a lookup with a
 * session cache, and the wording. The verdict is the one exact fact the
 * engine pane can show — in a 7-man ending the engine's "+2.1" may be a
 * proven draw, and this row is what says so.
 *
 * Failures stay silent by design: the row is an enhancement, and a pane
 * that grows an error line whenever the machine is offline would cost
 * more than the row is worth.
 */

export interface TbMove {
  uci: string;
  san: string;
  category: string;
  dtz: number | null;
  dtm: number | null;
}

export interface TbResult {
  category: string;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  moves: TbMove[];
}

/** Tablebases answer for 7 men or fewer, and never with castling rights. */
export function tablebaseEligible(fen: string): boolean {
  const fields = fen.trim().split(/\s+/);
  const board = fields[0] ?? '';
  const castling = fields[2] ?? '-';
  if (castling !== '-') return false;
  let men = 0;
  for (const ch of board) {
    if (/[a-z]/i.test(ch)) men++;
  }
  return men > 0 && men <= 7;
}

/** Position + clock is the identity; the fullmove number is display-only. */
const cacheKey = (fen: string): string => fen.trim().split(/\s+/).slice(0, 5).join(' ');

const cache = new Map<string, TbResult | null>();
const inflight = new Map<string, Promise<TbResult | null>>();

/**
 * Look a position up, remembering answers for the session. Definitive
 * failures (a 400: too many men, castling) cache as null; network
 * failures do not, so the next visit retries.
 */
export function lookupTablebase(fen: string): Promise<TbResult | null> {
  const key = cacheKey(fen);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;

  const request = (async (): Promise<TbResult | null> => {
    try {
      const res = await fetch(`/api/tablebase?fen=${encodeURIComponent(fen)}`);
      if (res.status === 400) {
        cache.set(key, null);
        return null;
      }
      if (!res.ok) return null;
      const body = (await res.json()) as TbResult;
      cache.set(key, body);
      return body;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}

/**
 * The verdict as a sentence, or null when there is nothing worth a row
 * (unknown coverage, or a terminal position the board already shows).
 * Categories are side-to-move POV upstream; wording is White-POV like
 * every other number in the pane. `maybe-*` (DTZ rounding at the 50-move
 * boundary) reads as its base category — the tooltip owns the nuance.
 */
export function tbVerdict(result: TbResult, turn: 'white' | 'black'): string | null {
  if (result.checkmate || result.stalemate) return null;

  const category = result.category.replace('maybe-', '');
  if (category === 'cursed-win' || category === 'blessed-loss') {
    return t('Tablebase: draw (50-move rule)');
  }
  if (category === 'draw') return t('Tablebase: draw');
  if (category !== 'win' && category !== 'loss') return null;

  const winner: 'white' | 'black' =
    category === 'win' ? turn : turn === 'white' ? 'black' : 'white';
  const mateMoves = result.dtm !== null ? Math.ceil(Math.abs(result.dtm) / 2) : null;

  if (winner === 'white') {
    return mateMoves !== null
      ? t('Tablebase: White wins, mate in {n}', { n: mateMoves })
      : t('Tablebase: White wins');
  }
  return mateMoves !== null
    ? t('Tablebase: Black wins, mate in {n}', { n: mateMoves })
    : t('Tablebase: Black wins');
}
