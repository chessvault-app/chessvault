import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  /** Selected book name (persisted). Null falls back to the first book. */
  book: string | null;
  books: BookInfo[];
  booksLoaded: boolean;

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

/** The active book, resolving the persisted choice against what exists. */
export function activeBook(s: Pick<ExplorerState, 'book' | 'books'>): string | null {
  if (isRemoteDb(s.book)) return s.book;
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
        const url = isRemoteDb(book)
          ? `/api/explorer/${book!.slice('lichess:'.length)}?fen=${encodeURIComponent(fen)}`
          : book
            ? `/api/books/${encodeURIComponent(book)}?fen=${encodeURIComponent(fen)}`
            : `/api/opening?fen=${encodeURIComponent(fen)}`;
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (fen !== latestFen) return; // user has moved on
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            set({ loading: false, error: body?.error ?? `explorer request failed (${res.status})` });
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
          set({ loading: false, error: 'explorer server unreachable' });
        }
      };

      return {
        enabled: true,
        book: null,
        books: [],
        booksLoaded: false,
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
          // Refetch the position on screen under the new book.
          if (latestFen) get().lookup(latestFen);
        },

        refreshBooks: async () => {
          try {
            const res = await fetch('/api/books');
            const body = (await res.json()) as { books: BookInfo[] };
            set({ books: body.books, booksLoaded: true, error: null });
          } catch {
            set({ booksLoaded: true, error: 'explorer server unreachable' });
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
      partialize: (s) => ({ enabled: s.enabled, book: s.book }),
    },
  ),
);
