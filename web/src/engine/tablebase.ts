import type { PvLine } from './uci.ts';

/**
 * Client side of the tablebase: eligibility, and a lookup that returns the
 * proof already shaped as engine lines.
 *
 * There is no wording here any more. The verdict used to be a sentence of
 * its own above the engine's lines — "Tablebase: White wins, mate in 10" —
 * which said the same thing twice in two vocabularies and left the eval
 * bar and the best-move arrow still reading the estimate underneath. The
 * server now answers in the engine's own terms, a mate score and a line,
 * so a proof simply replaces the guess everywhere the guess was shown.
 *
 * Failures stay silent by design: a pane that grows an error line whenever
 * the machine is offline would cost more than the rows are worth, and the
 * engine's own lines are a perfectly good answer to fall back to.
 */

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
const cacheKey = (fen: string, lines: number): string =>
  `${fen.trim().split(/\s+/).slice(0, 5).join(' ')}|${lines}`;

const cache = new Map<string, PvLine[]>();
const inflight = new Map<string, Promise<PvLine[] | null>>();

/**
 * The proof for a position, as engine lines, or null when there is not one
 * to be had right now.
 *
 * Null and [] are different answers and are kept different. [] means the
 * tablebase answered and has no line to offer — a draw, or a position
 * whose winning moves have no DTM — which is settled, cacheable, and means
 * the engine's lines stand. Null means we could not ask: offline, or
 * throttled. That is not cached, so the next visit tries again.
 */
export function lookupTablebaseLines(fen: string, lines: number): Promise<PvLine[] | null> {
  const key = cacheKey(fen, lines);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;

  const request = (async (): Promise<PvLine[] | null> => {
    try {
      // Raw fetch on purpose, not api(): this proxied Lichess lookup is the
      // silent enhancement described above — api()'s error copy and 401
      // relock belong to vault traffic someone is waiting on, and a
      // background proof must never be what flips the app to the lock
      // screen. The status codes are read directly below.
      const res = await fetch(
        `/api/tablebase/lines?fen=${encodeURIComponent(fen)}&lines=${lines}`,
      );
      // 400 is definitive — too many men, or castling rights. It will not
      // become answerable, so remember that and stop asking.
      if (res.status === 400) {
        cache.set(key, []);
        return [];
      }
      if (!res.ok) return null;
      const body = (await res.json()) as { lines?: PvLine[] };
      const found = body.lines ?? [];
      cache.set(key, found);
      return found;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}
