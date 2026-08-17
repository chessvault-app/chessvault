import { api } from '@/lib/api';
import type { GameSummary } from './shared';

/**
 * The collection list, cached for the session.
 *
 * `/api/games` walks every PGN in the collection and replays each game for
 * its opening and final position. The server memoises that per file by
 * mtime, but the Games page was paying a round-trip for the whole list on
 * every visit and rendering nothing until it landed — twice over, since the
 * elite browser asks for the same list to mark the games already kept.
 *
 * So: hand back the last answer at once and revalidate behind it. Anything
 * that writes a game document calls `forgetCollection`, exactly as the book
 * cache in BooksView is invalidated by anything that rewrites a book.
 */
let cache: GameSummary[] | null = null;
let inFlight: Promise<GameSummary[]> | null = null;

/** The cached list, or null if nothing has been fetched yet this session. */
export const cachedCollection = (): GameSummary[] | null => cache;

export function forgetCollection(): void {
  cache = null;
}

export async function loadCollection(): Promise<GameSummary[]> {
  // One request even when both panes of the page ask at the same moment.
  // api() throws on failure, so the rejection reaches every caller's own
  // catch instead of caching an undefined list.
  inFlight ??= api<{ games: GameSummary[] }>('/api/games')
    .then(({ games }) => {
      cache = games;
      return games;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
