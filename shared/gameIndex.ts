import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { Game, PgnNodeData } from 'chessops/pgn';
import { hashSetup } from './zobrist.ts';

/**
 * Turning the vault's own games into something the explorer can query.
 *
 * An opening book pre-aggregates: one row per (position, move) with the
 * results already summed. That is the right shape for a database of
 * millions of games and the wrong shape for yours, because summing at build
 * time destroys the per-game dimension — and every question worth asking of
 * your own games is a filtered one. "What do I play here as Black, in
 * blitz, since June" cannot be answered by a table that already added all
 * of them together.
 *
 * So this keeps the game dimension: one row per (position, move, game),
 * plus the game's metadata beside it, and the summing happens in the query.
 * At personal scale the extra rows cost nothing — a few thousand games is
 * a couple of hundred thousand rows, which SQLite does not notice.
 *
 * Extraction lives in shared/ rather than in the server because the static
 * demo runs the same indexer over an in-memory vault. Two copies of this
 * would drift, and the drift would be invisible: both would still build an
 * index, just not the same one.
 */

/**
 * Plies indexed per game.
 *
 * Deeper than a book's 24 (`scripts/lib/book-builder.ts`), because the
 * questions differ. A book answers "what is normal here", which stops
 * meaning anything once a line leaves theory. Your own games answer "have I
 * been here, and how did it go" — still worth knowing at move 25, where
 * the position is probably unique to you and the answer is a specific
 * game. Past 60 the hit rate is one game per position and the honest answer
 * comes from the games list, not from statistics.
 */
export const MAX_PLY = 60;

/** How the result is stored: from White's point of view, and sortable. */
export type Score = 1 | 0 | -1;

export interface IndexedGame {
  /** PGN file this game came from, relative to the games directory. */
  file: string;
  /** Its position within that file, so a row can point back at the game. */
  idx: number;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  score: Score;
  /** `YYYY-MM-DD`, or null when the PGN did not say. */
  date: string | null;
  timeControl: string | null;
  speed: Speed | null;
  eco: string | null;
  /** Which side the vault's owner played, when it can be determined. */
  userSide: 'white' | 'black' | null;
  site: string | null;
  /** (position before the move, move played), in order. */
  plies: { hash: bigint; uci: string; ply: number }[];
}

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';

/**
 * The username an archive path names, or null.
 *
 * Archive files live at `<site>/<user>/<month>.pgn`, so the path itself
 * says whose games these are — which is what lets a row know which side
 * the owner played without asking anyone.
 */
export function pathUser(rel: string): string | null {
  return /^(chesscom|lichess)\//.test(rel) ? (rel.split('/')[1]?.toLowerCase() ?? null) : null;
}

/**
 * Which side the vault's owner played.
 *
 * An explicit `VaultSide` header wins — a game imported by hand says so
 * outright, and nothing about its path can be relied on. Otherwise the
 * archive path names the player.
 */
export function userSideOf(
  white: string,
  black: string,
  vaultSide: string | undefined,
  user: string | null,
): 'white' | 'black' | null {
  if (vaultSide === 'white' || vaultSide === 'black') return vaultSide;
  if (!user) return null;
  if (white.toLowerCase() === user) return 'white';
  if (black.toLowerCase() === user) return 'black';
  return null;
}

/**
 * Lichess's speed bands, computed the way Lichess computes them: the
 * estimated total is the base plus forty increments, because a 3+2 game
 * lasts far longer than its three minutes suggest.
 *
 * Ultrabullet folds into bullet. It is a real category, but nobody filters
 * their own games down to it, and a fifth chip earns less than the row it
 * costs.
 */
export function speedOf(timeControl: string | null | undefined): Speed | null {
  if (!timeControl || timeControl === '-') return null;
  // Correspondence is written as days-per-move (`1/259200`).
  if (timeControl.includes('/')) return 'correspondence';
  const [base, inc] = timeControl.split('+');
  const seconds = Number(base);
  if (!Number.isFinite(seconds)) return null;
  const total = seconds + 40 * (Number(inc) || 0);
  if (total >= 86_400) return 'correspondence';
  if (total < 180) return 'bullet';
  if (total < 480) return 'blitz';
  if (total < 1500) return 'rapid';
  return 'classical';
}

/** `2026.08.11` or `2026-08-11` → `2026-08-11`; anything vaguer → null. */
export function normaliseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/.exec(raw.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const SCORES: Record<string, Score> = { '1-0': 1, '1/2-1/2': 0, '0-1': -1 };

/**
 * One parsed game as index rows, or null if it should not be indexed.
 *
 * Rejected on the same grounds a book rejects a game, and for the same
 * reason: a variant or a game starting from a set-up position produces
 * position hashes that mean something else, and mixing them in would answer
 * "what did I play here" with a move from a different game entirely. An
 * unfinished game is dropped too — it has no result to count, and counting
 * it as anything would be a guess.
 */
export function indexGame(
  game: Game<PgnNodeData>,
  where: { file: string; idx: number; user: string | null },
): IndexedGame | null {
  const h = (key: string): string | undefined => game.headers.get(key);

  const variant = (h('Variant') ?? 'standard').toLowerCase();
  if (!['standard', 'chess', 'classical', 'normal'].includes(variant)) return null;
  if (game.headers.has('FEN')) return null;

  const score = SCORES[h('Result') ?? ''];
  if (score === undefined) return null;

  const white = h('White') ?? '?';
  const black = h('Black') ?? '?';
  const timeControl = h('TimeControl') ?? null;

  const plies: IndexedGame['plies'] = [];
  const pos = Chess.default();
  let ply = 0;
  for (const data of game.moves.mainline()) {
    if (ply >= MAX_PLY) break;
    const move = parseSan(pos, data.san);
    if (!move) break; // an illegal move: keep what replayed, drop the rest
    // hashSetup(pos.toSetup()) before the move, matching the book indexer —
    // toSetup()'s X-FEN normalisation is what keeps index-time and
    // query-time keys equal (see shared/zobrist.ts).
    plies.push({ hash: hashSetup(pos.toSetup()), uci: makeUci(move), ply });
    pos.play(move);
    ply += 1;
  }
  if (plies.length === 0) return null;

  return {
    file: where.file,
    idx: where.idx,
    white,
    black,
    whiteElo: Number(h('WhiteElo')) || 0,
    blackElo: Number(h('BlackElo')) || 0,
    score,
    date: normaliseDate(h('UTCDate') ?? h('Date')),
    timeControl,
    speed: speedOf(timeControl),
    eco: h('ECO') ?? null,
    userSide: userSideOf(white, black, h('VaultSide'), where.user),
    site: h('Link') ?? (h('Site')?.startsWith('http') ? h('Site')! : null),
    plies,
  };
}
