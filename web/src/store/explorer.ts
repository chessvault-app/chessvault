import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

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

interface ExplorerState {
  /** Pane visibility switch (persisted). */
  enabled: boolean;
  /**
   * The selected source (persisted): a `refdb:` database, a `lichess:`
   * database, or MY_GAMES. Null falls back to the first reference
   * database, then to My games.
   */
  book: string | null;
  dbsLoaded: boolean;
  /** Filters, applied only while MY_GAMES is the source. */
  myFilters: MyGamesFilters;
  /** The reference databases that can also answer (see REF_DB). */
  refDbs: RefDbSummary[];
  /** Filters, applied only while a reference database is the source. */
  refFilters: RefDbFilters;
  /** False when the chosen reference database has no position index yet. */
  refIndexed: boolean;
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
  setRefFilters: (patch: Partial<RefDbFilters>) => void;
  refreshMyStats: () => Promise<void>;
  /** Fetch the reference databases the switcher can offer. */
  refreshDbs: () => Promise<void>;
  /** Debounced lookup for the position on screen. */
  lookup: (fen: string) => void;
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

/**
 * A reference database as an explorer source — the unified index.
 *
 * The same file the elite browser reads games from carries a position
 * index (see server/refgamesIndex.ts), so it answers the explorer's
 * question too, and answers it FILTERED — which the summed-away books
 * never could. Addressed as `refdb:<name>` through the same switcher.
 */
export const REF_DB = 'refdb:';

export const isRefDb = (name: string | null): boolean => name !== null && name.startsWith(REF_DB);

export const refDbName = (book: string): string => book.slice(REF_DB.length);

export interface RefDbSummary {
  name: string;
  games: number;
  /** Whether the position index has been built into this database. */
  indexed: boolean;
  positions: number;
}

/** What to count when exploring a reference database. */
export interface RefDbFilters {
  result?: '1-0' | '0-1' | '1/2-1/2';
  /** A floor under BOTH players' ratings. */
  minElo?: number;
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string;
  to?: string;
}

export function hasRefFilters(f: RefDbFilters): boolean {
  return Boolean(f.result || f.minElo || f.from || f.to);
}

function refFilterQuery(f: RefDbFilters): string {
  const query = new URLSearchParams();
  if (f.result) query.set('result', f.result);
  if (f.minElo) query.set('minElo', String(f.minElo));
  if (f.from) query.set('from', f.from);
  if (f.to) query.set('to', f.to);
  return query.toString();
}

/**
 * A book's NAME is a filename-safe id (`lichess_elite_2025-11`); what a
 * picker shows should not read as the database showing through. Underscores
 * become spaces; the id itself stays what the API and the manager use.
 */
export const bookLabel = (name: string): string => name.replace(/_/g, ' ');

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
export function activeBook(s: Pick<ExplorerState, 'book' | 'refDbs'>): string | null {
  if (isRemoteDb(s.book) || isMyGames(s.book)) return s.book;
  if (isRefDb(s.book) && s.refDbs.some((d) => `${REF_DB}${d.name}` === s.book)) return s.book;
  // A stale refdb choice (deleted, or first run) falls to the first
  // database there is, and a vault with none explores its own games.
  const first = s.refDbs[0];
  return first ? `${REF_DB}${first.name}` : MY_GAMES;
}

// Debounce machinery lives outside the store: timers and AbortControllers are
// not state. Arrow-key navigation fires lookups faster than they're worth
// sending; only the position the user settles on gets fetched.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let latestFen: string | null = null;
let controller: AbortController | null = null;
/** Ordering token for refreshMyStats — see the note there. */
let myStatsSeq = 0;

export const useExplorer = create<ExplorerState>()(
  persist(
    (set, get) => {
      const doLookup = async (fen: string): Promise<void> => {
        controller?.abort();
        // Kept in a local too: `controller` is module state a newer lookup
        // reassigns, and the abort test below has to ask about THIS request.
        const own = new AbortController();
        controller = own;
        const book = activeBook(get());
        const url = isMyGames(book)
          ? `/api/mygames?${myGamesQuery(fen, get().myFilters)}`
          : isRefDb(book)
            ? `/api/refgames/explore?db=${encodeURIComponent(refDbName(book!))}&fen=${encodeURIComponent(fen)}&${refFilterQuery(get().refFilters)}`
            : `/api/explorer/${book!.slice('lichess:'.length)}?fen=${encodeURIComponent(fen)}`;
        try {
          const body = await api<{
            opening?: Opening | null;
            moves?: ExplorerMove[];
            topGames?: TopGame[];
            indexed?: boolean;
          }>(url, { signal: own.signal });
          if (fen !== latestFen) return; // user has moved on
          set((s) => ({
            refIndexed: !isRefDb(book) || body.indexed !== false,
            resultFen: fen,
            moves: body.moves ?? [],
            topGames: body.topGames ?? [],
            opening: body.opening ?? null,
            openingsSeen: body.opening
              ? { ...s.openingsSeen, [fen]: body.opening }
              : s.openingsSeen,
            loading: false,
            error: null,
          }));
        } catch (error) {
          // api() folds an abort into ApiError status 0, so the signal —
          // not the error — is what says this request was superseded
          // rather than failed. Superseded stays silent, as ever.
          if (own.signal.aborted) return;
          if (fen !== latestFen) return;
          set({
            loading: false,
            error:
              error instanceof ApiError && error.status !== 0
                ? error.message
                : t('explorer server unreachable'),
          });
        }
      };

      return {
        enabled: false,
        book: null,
        dbsLoaded: false,
        myFilters: {},
        refDbs: [],
        refFilters: {},
        refIndexed: true,
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

        setRefFilters: (patch) => {
          const next = { ...get().refFilters, ...patch };
          for (const key of Object.keys(next) as (keyof RefDbFilters)[]) {
            if (next[key] === undefined) delete next[key];
          }
          set({ refFilters: next });
          if (latestFen) get().lookup(latestFen);
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
          // Ordered like the main lookup: rapid filter taps fire several of
          // these, and a slow early answer landing last showed a count that
          // did not match the chips on screen.
          const seq = ++myStatsSeq;
          try {
            // With the filters: the count in the filter window answers "how
            // many games are these chips letting through", which is the
            // question being asked while they are being tapped.
            const stats = await api<{ games: number; positions: number; matching: number }>(
              `/api/mygames/status?${myFilterQuery(get().myFilters)}`,
            );
            if (seq !== myStatsSeq) return;
            set({ myStats: stats });
          } catch {
            // The footer line simply does not appear.
          }
        },

        refreshDbs: async () => {
          try {
            const body = await api<{
              databases?: { name: string; games: number; indexed?: boolean; positions?: number }[];
            }>('/api/refgames');
            set({
              refDbs: (body.databases ?? []).map((d) => ({
                name: d.name,
                games: d.games,
                indexed: d.indexed === true,
                positions: d.positions ?? 0,
              })),
              dbsLoaded: true,
              error: null,
            });
          } catch {
            set({ dbsLoaded: true, error: t('explorer server unreachable') });
          }
        },

        lookup: (fen) => {
          latestFen = fen;
          if (!get().enabled) return;
          set({ loading: true });
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => void doLookup(fen), 120);
        },

      };
    },
    {
      name: 'chess-vault:explorer',
      // The source and its filters persist — visibility is session state,
      // and the app aims to be stateless apart from data (lanph3re's call).
      // A filter is a question the user asked, so it outlives the tab.
      partialize: (s) => ({ book: s.book, myFilters: s.myFilters, refFilters: s.refFilters }),
    },
  ),
);
