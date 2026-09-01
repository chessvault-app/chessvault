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

/**
 * The one bit of the list that has to survive the session: whether it
 * had anything in it. The cache above is per session by design — it
 * holds whole game objects — so it is null at every cold start, and the
 * Games pane's opening tab, which needs an answer BEFORE the first
 * paint, had nothing to read. It opened on Databases every launch, drew
 * that tab's rows, and flipped to the collection once `/api/games`
 * landed: a measured 85ms of the wrong tab against a warm local server,
 * 280ms against a cold one, and two `/api/refgames` round trips thrown
 * away with it. A bit is small enough to keep, so it is kept.
 *
 * Written on every load rather than only when it changes, and never
 * cleared by `forgetCollection` — that drops the session's copy of the
 * list, not the record of what the list last was.
 */
const NONEMPTY_KEY = 'vault:games-collection-nonempty';

/**
 * Whether the collection held games the last time it was read on this
 * device. False when it was empty, and equally when nothing has ever
 * read it or there is no storage to read: all three are "no reason to
 * believe there are games", which is the only question the caller asks.
 */
export function collectionWasNonEmpty(): boolean {
  try {
    return localStorage.getItem(NONEMPTY_KEY) === '1';
  } catch {
    return false;
  }
}

export async function loadCollection(): Promise<GameSummary[]> {
  // One request even when both panes of the page ask at the same moment.
  // api() throws on failure, so the rejection reaches every caller's own
  // catch instead of caching an undefined list.
  inFlight ??= api<{ games: GameSummary[] }>('/api/games')
    .then(({ games }) => {
      cache = games;
      try {
        localStorage.setItem(NONEMPTY_KEY, games.length > 0 ? '1' : '0');
      } catch {
        /* the session still has the list; only the next cold start loses it */
      }
      return games;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
