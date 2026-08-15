/**
 * The field: where "what do opponents actually play here" comes from.
 *
 * Two views ask the question — the repertoire trainer picks its replies
 * from it, the opening map compares its coverage against it — so the
 * source constants and the one fetch live here rather than in either
 * view. Both sources answer in the same shape: the server normalises
 * the Lichess payload to the book contract, so only the URL differs.
 */

export interface FieldMove {
  uci: string;
  san: string;
  total: number;
}

/**
 * The online source's value in a picker. A book name must match
 * `^[A-Za-z0-9][A-Za-z0-9_.-]*$` (server/books.ts), so a value with a
 * colon can never collide with one — the same trick the explorer uses.
 */
export const ONLINE_SOURCE = 'lichess:lichess';

/**
 * The rating groups the Lichess explorer actually has, one per option.
 *
 * These are not ours to choose or to refine. Measured against the live
 * API: asking for 1600 and 1800 together returns EXACTLY the sum of
 * asking for each alone, so the database is aggregated per group rather
 * than filtered per game, and a boundary at 1500 cannot be computed from
 * it. Asking for 1500 anyway does not fail — it silently answers with
 * the 1400 group — which is why the server keeps an allowlist and why
 * this list is the whole of what can be offered.
 *
 * Each label is the span the group covers, not its floor: shown bare, a
 * "1600" reads as exactly 1600 when it means 1600 to 1800.
 *
 * This replaced four bands that spanned two groups each, so the middle
 * of the range could only be had 400 points at a time.
 */
export const RATING_BANDS: { label: string; ratings: string }[] = [
  { label: '400–1000', ratings: '400' },
  { label: '1000–1200', ratings: '1000' },
  { label: '1200–1400', ratings: '1200' },
  { label: '1400–1600', ratings: '1400' },
  { label: '1600–1800', ratings: '1600' },
  { label: '1800–2000', ratings: '1800' },
  { label: '2000–2200', ratings: '2000' },
  { label: '2200–2500', ratings: '2200' },
  { label: '2500+', ratings: '2500' },
  { label: 'All ratings', ratings: '400,1000,1200,1400,1600,1800,2000,2200,2500' },
];

/** Every reply real games made in the position, with counts. Failures
    throw; the caller decides whether that is an error or a shrug. */
export async function fetchField(
  source: string,
  ratings: string,
  fen: string,
): Promise<FieldMove[]> {
  const url =
    source === ONLINE_SOURCE
      ? `/api/explorer/lichess?fen=${encodeURIComponent(fen)}&ratings=${ratings}`
      : `/api/refgames/explore?db=${encodeURIComponent(source)}&fen=${encodeURIComponent(fen)}`;
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as { moves?: FieldMove[] } | null;
  if (!res.ok || !body?.moves) throw new Error('field unavailable');
  return body.moves;
}
