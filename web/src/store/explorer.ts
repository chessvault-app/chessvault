import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { t } from '@/lib/i18n';

export interface BookInfo {
  name: string;
  sources: string[];
  bytes: number;
  games: number;
  positions: number;
  maxPly: number;
  minGames: number;
  builtAt: string | null;
}

export interface ExplorerMove {
  uci: string;
  san: string;
  w: number;
  d: number;
  b: number;
  total: number;
}

export interface TopGame {
  uci: string;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: string;
  date: string | null;
  site: string | null;
  /** Set only for your own games: where the game lives in the vault. */
  file?: string;
  index?: number;
}

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';

/**
 * What to count when exploring your own games.
 *
 * Persisted alongside the source choice: a filter you set is a question you
 * are asking, and it should still be the question after a reload. Every
 * field absent means "all of them" — the filter set has no default state to
 * get out of step with.
 */
export interface MyGamesFilters {
  side?: 'white' | 'black';
  outcome?: 'win' | 'loss' | 'draw';
  speeds?: Speed[];
  collectionOnly?: boolean;
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string;
  to?: string;
}

export interface Opening {
  eco: string;
  name: string;
}

export interface BuildStatus {
  running: boolean;
  name?: string;
  exitCode?: number | null;
  seconds?: number;
  log?: string[];
}

interface ExplorerState {
  /** Pane visibility switch (persisted). */
  enabled: boolean;
  /**
   * The selected source (persisted): a book name, a `lichess:` database, or
   * MY_GAMES. Null falls back to the first book.
   */
  book: string | null;
  books: BookInfo[];
  booksLoaded: boolean;
  /** Filters, applied only while MY_GAMES is the source. */
  myFilters: MyGamesFilters;
  /** How much the index holds, for the pane's footer. Null until asked. */
  myStats: { games: number; positions: number; matching: number } | null;

  /** FEN the current results belong to; guards against stale responses. */
  resultFen: string | null;
  moves: ExplorerMove[];
  topGames: TopGame[];
  opening: Opening | null;
  /**
   * Every named position seen this session, keyed by FEN. Deep positions have
   * no name of their own, so the pane walks the current line's ancestors
   * through this cache to keep showing "Sicilian Najdorf" past the book.
   */
  openingsSeen: Record<string, Opening>;
  loading: boolean;
  error: string | null;

  toggle: () => void;
  selectBook: (name: string) => void;
  setMyFilters: (patch: Partial<MyGamesFilters>) => void;
  refreshMyStats: () => Promise<void>;
  refreshBooks: () => Promise<void>;
  /** Debounced lookup for the position on screen. */
  lookup: (fen: string) => void;
  deleteBook: (name: string) => Promise<string | null>;
  startBuild: (req: { name: string; sources: string[] }) => Promise<string | null>;
  fetchBuildStatus: () => Promise<BuildStatus | null>;
}

/**
 * Remote Lichess databases, addressable through the same switcher as local
 * books. They go through the server proxy, which caches responses on disk —
 * needs a token in vault/config.json and (the first time) a connection.
 */
export const REMOTE_DBS = [
  { id: 'lichess:masters', label: 'Masters · lichess' },
  { id: 'lichess:lichess', label: 'Players · lichess' },
] as const;

export const isRemoteDb = (name: string | null): boolean =>
  name !== null && name.startsWith('lichess:');

/**
 * The vault's own games, as a source the switcher can select.
 *
 * Not a book, and not in `books`: there is nothing to build, nothing to
 * rebuild and nothing to delete. It is always available, because the games
 * are always there — a vault with no games answers "no games from this
 * position" the same way an unhelpful book does.
 */
export const MY_GAMES = 'vault:mine';

export const isMyGames = (name: string | null): boolean => name === MY_GAMES;

/** Turn the filter set into the query the server reads. */
function myGamesQuery(fen: string, f: MyGamesFilters): string {
  return new URLSearchParams({ fen, ...Object.fromEntries(new URLSearchParams(myFilterQuery(f))) }).toString();
}

/** The filter half of that query, for the endpoints that take no position. */
function myFilterQuery(f: MyGamesFilters): string {
  const query = new URLSearchParams();
  if (f.side) query.set('side', f.side);
  if (f.outcome) query.set('outcome', f.outcome);
  if (f.speeds?.length) query.set('speeds', f.speeds.join(','));
  if (f.from) query.set('from', f.from);
  if (f.to) query.set('to', f.to);
  if (f.collectionOnly) query.set('collection', '1');
  return query.toString();
}

/** True when anything is narrowing the count, for the "clear" affordance. */
export function hasMyFilters(f: MyGamesFilters): boolean {
  return Boolean(f.side || f.outcome || f.speeds?.length || f.from || f.to || f.collectionOnly);
}

/** The active source, resolving the persisted choice against what exists. */
export function activeBook(s: Pick<ExplorerState, 'book' | 'books'>): string | null {
  if (isRemoteDb(s.book) || isMyGames(s.book)) return s.book;
  if (s.book && s.books.some((b) => b.name === s.book)) return s.book;
  return s.books[0]?.name ?? null;
}

// Debounce machinery lives outside the store: timers and AbortControllers are
// not state. Arrow-key navigation fires lookups faster than they're worth
// sending; only the position the user settles on gets fetched.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let latestFen: string | null = null;
let controller: AbortController | null = null;

export const useExplorer = create<ExplorerState>()(
  persist(
    (set, get) => {
      const doLookup = async (fen: string): Promise<void> => {
        controller?.abort();
        controller = new AbortController();
        const book = activeBook(get());
        const url = isMyGames(book)
          ? `/api/mygames?${myGamesQuery(fen, get().myFilters)}`
          : isRemoteDb(book)
            ? `/api/explorer/${book!.slice('lichess:'.length)}?fen=${encodeURIComponent(fen)}`
            : book
              ? `/api/books/${encodeURIComponent(book)}?fen=${encodeURIComponent(fen)}`
              : `/api/opening?fen=${encodeURIComponent(fen)}`;
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (fen !== latestFen) return; // user has moved on
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            set({ loading: false, error: body?.error ?? t('explorer request failed ({status})', { status: res.status }) });
            return;
          }
          const body = (await res.json()) as {
            opening: Opening | null;
            moves?: ExplorerMove[];
            topGames?: TopGame[];
          };
          set((s) => ({
            resultFen: fen,
            moves: body.moves ?? [],
            topGames: body.topGames ?? [],
            opening: body.opening,
            openingsSeen: body.opening
              ? { ...s.openingsSeen, [fen]: body.opening }
              : s.openingsSeen,
            loading: false,
            error: null,
          }));
        } catch (error) {
          if ((error as Error).name === 'AbortError') return;
          if (fen !== latestFen) return;
          set({ loading: false, error: t('explorer server unreachable') });
        }
      };

      return {
        enabled: false,
        book: null,
        books: [],
        booksLoaded: false,
        myFilters: {},
        myStats: null,
        resultFen: null,
        moves: [],
        topGames: [],
        opening: null,
        openingsSeen: {},
        loading: false,
        error: null,

        toggle: () => set((s) => ({ enabled: !s.enabled })),

        selectBook: (name) => {
          set({ book: name });
          // Refetch the position on screen under the new source.
          if (latestFen) get().lookup(latestFen);
          if (isMyGames(name)) void get().refreshMyStats();
        },

        setMyFilters: (patch) => {
          // Undefined means "no longer filtering on this", so the key goes
          // rather than persisting as a key with no value.
          const next = { ...get().myFilters, ...patch };
          for (const key of Object.keys(next) as (keyof MyGamesFilters)[]) {
            const value = next[key];
            if (value === undefined || (Array.isArray(value) && value.length === 0)) {
              delete next[key];
            }
          }
          set({ myFilters: next });
          if (latestFen) get().lookup(latestFen);
          void get().refreshMyStats();
        },

        refreshMyStats: async () => {
          try {
            // With the filters: the count in the filter window answers "how
            // many games are these chips letting through", which is the
            // question being asked while they are being tapped.
            const res = await fetch(`/api/mygames/status?${myFilterQuery(get().myFilters)}`);
            if (!res.ok) return;
            set({
              myStats: (await res.json()) as { games: number; positions: number; matching: number },
            });
          } catch {
            // The footer line simply does not appear.
          }
        },

        refreshBooks: async () => {
          try {
            const res = await fetch('/api/books');
            const body = (await res.json()) as { books: BookInfo[] };
            set({ books: body.books, booksLoaded: true, error: null });
          } catch {
            set({ booksLoaded: true, error: t('explorer server unreachable') });
          }
        },

        lookup: (fen) => {
          latestFen = fen;
          if (!get().enabled) return;
          set({ loading: true });
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => void doLookup(fen), 120);
        },

        deleteBook: async (name) => {
          const res = await fetch(`/api/books/${encodeURIComponent(name)}`, { method: 'DELETE' });
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          await get().refreshBooks();
          if (latestFen) get().lookup(latestFen);
          return res.ok ? null : (body?.error ?? 'delete failed');
        },

        startBuild: async (req) => {
          const res = await fetch('/api/books/build', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(req),
          });
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return res.ok ? null : (body?.error ?? 'build failed to start');
        },

        fetchBuildStatus: async () => {
          try {
            const res = await fetch('/api/books/build/status');
            return (await res.json()) as BuildStatus;
          } catch {
            return null;
          }
        },
      };
    },
    {
      name: 'chess-vault:explorer',
      // The source and its filters persist — visibility is session state,
      // and the app aims to be stateless apart from data (lanph3re's call).
      // A filter is a question the user asked, so it outlives the tab.
      partialize: (s) => ({ book: s.book, myFilters: s.myFilters }),
    },
  ),
);
