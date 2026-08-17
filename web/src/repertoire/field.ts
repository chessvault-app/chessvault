/**
 * The field: where "what do opponents actually play here" comes from.
 *
 * Two views ask the question — the repertoire trainer picks its replies
 * from it, the opening map compares its coverage against it — so the
 * source constants and the one fetch live here rather than in either
 * view. Both sources answer in the same shape: the server normalises
 * the Lichess payload to the book contract, so only the URL differs.
 */
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export interface FieldMove {
  uci: string;
  san: string;
  total: number;
  /** White wins / draws / Black wins — every source sends them. */
  w?: number;
  d?: number;
  b?: number;
}

/**
 * The online source's value in a picker. A book name must match
 * `^[A-Za-z0-9][A-Za-z0-9_.-]*$` (server/books.ts), so a value with a
 * colon can never collide with one — the same trick the explorer uses.
 */
export const ONLINE_SOURCE = 'lichess:lichess';

/** The vault's own games as a field — see server/myGames.ts. */
export const MY_GAMES_SOURCE = 'mine:mygames';

/**
 * The reference databases a picker can offer, from `GET /api/refgames`.
 *
 * Two mounts answer that route (server/refgames.ts). The directory mount
 * lists databases by name. The single-file mount — the static demo, and
 * the tests — has no names to list and answers `{ ready, games }`, which
 * every field picker read as `databases ?? []`: an empty list, and so no
 * reference database on offer at all. In the demo that hid the only field
 * there is, which took the gap badges, the dot sizes and the lit mainline
 * with it — a database the explorer beside it was answering from.
 *
 * A single mount ignores `?db=`, so the name here is only ever a label
 * and a picker's value; the routes reach the one file whatever it says.
 */
export const SINGLE_DB_SOURCE = 'refgames';

export interface FieldDatabase {
  name: string;
  games?: number;
  /** What a picker shows. Absent for a named database, which is its name. */
  label?: string;
}

export function fieldDatabases(body: {
  ready?: boolean;
  games?: number;
  databases?: FieldDatabase[];
}): FieldDatabase[] {
  if (body.databases) return body.databases;
  // The one file has no name of its own, so it is offered by what it is.
  return body.ready ? [{ name: SINGLE_DB_SOURCE, games: body.games, label: t('Reference games') }] : [];
}

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

/** Where a fresh session starts: 1600–1800, the group the database as a
    whole averages into — named, so no view carries a magic index. */
export const DEFAULT_BAND = RATING_BANDS[4]!;

/**
 * The same question for MANY positions in one request, answered with
 * whatever the source can say at once.
 *
 * The local sources — reference databases and the vault's own games —
 * answer every position, each behind its own batch route. The Lichess
 * proxy answers only what its disk cache holds: the public explorer
 * takes one position per request, and no proxy can change that. So the
 * map is PARTIAL: a position missing from it is unanswered, not empty,
 * and the caller asks for it one at a time. Returns null only when there
 * is no source.
 *
 * This exists because the opening map asks about every charted position
 * at once. Measured on a real 280k-game database, a lookup takes well
 * under a millisecond — the seconds were all round trips, and a browser
 * runs about six of those at a time to one origin however many the
 * caller starts.
 *
 * `ratings` matters to the online source alone; `side` to the own-games
 * source alone (whose games count).
 */
export async function fetchFieldBatch(
  source: string,
  fens: string[],
  ratings: string,
  side?: 'white' | 'black',
): Promise<Map<string, FieldMove[]> | null> {
  if (!source) return null;
  const url =
    source === ONLINE_SOURCE
      ? `/api/explorer/lichess/batch?ratings=${ratings}`
      : source === MY_GAMES_SOURCE
        ? `/api/mygames/explore-batch${side ? `?side=${side}` : ''}`
        : `/api/refgames/explore-batch?db=${encodeURIComponent(source)}`;
  const body = await api<{ positions?: { fen: string; moves: FieldMove[] }[] } | null>(url, {
    method: 'POST',
    json: { fens },
  });
  if (!body?.positions) throw new Error('field unavailable');
  return new Map(body.positions.map((p) => [p.fen, p.moves]));
}

/** Every reply real games made in the position, with counts. Failures
    throw; the caller decides whether that is an error or a shrug.
    `side` applies to the own-games source only: which side the vault's
    owner played in the games that count. */
export async function fetchField(
  source: string,
  ratings: string,
  fen: string,
  side?: 'white' | 'black',
): Promise<FieldMove[]> {
  const url =
    source === ONLINE_SOURCE
      ? `/api/explorer/lichess?fen=${encodeURIComponent(fen)}&ratings=${ratings}`
      : source === MY_GAMES_SOURCE
        ? `/api/mygames?fen=${encodeURIComponent(fen)}${side ? `&side=${side}` : ''}`
        : `/api/refgames/explore?db=${encodeURIComponent(source)}&fen=${encodeURIComponent(fen)}`;
  const body = await api<{ moves?: FieldMove[] } | null>(url);
  if (!body?.moves) throw new Error('field unavailable');
  return body.moves;
}
