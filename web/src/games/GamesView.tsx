import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Globe,
  Info,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  BookOpen,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cachedCollection, forgetCollection, loadCollection } from './collection';
import { create } from 'zustand';
import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';
import { Board } from '@/board/Board';
import { sanitizeSegment } from '@shared/vaultNames';
import { cn } from '@/lib/cn';
import { autoFocusField, useMediaQuery } from '@/lib/media';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { StudyView } from '@/studies/StudyView';
import { Button } from '@/ui/Button';
import { KnightIcon } from '@/ui/KnightIcon';
import { Segmented } from '@/ui/Segmented';
import { CloudBoardArt } from '@/ui/CloudBoardArt';
import { EmptyState } from '@/ui/EmptyState';
import { BookmarkArt, CollectionArt, NoMatchArt } from '@/ui/EmptyArt';
import { Select } from '@/ui/Select';
import { Input, SearchInput, TextArea } from '@/ui/Input';
import { SideDot } from '@/ui/SideDot';
import { SkeletonGameRows, useSlowLoad } from '@/ui/Skeleton';
import { Panel, PanelHeader } from '@/ui/Panel';
import { Modal } from '@/ui/Modal';
import { CreateControl, FabSpacer } from '@/ui/Fab';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { SwipeTrack, useSwipeRow } from '@/ui/SwipeRow';
import { UndoBar } from '@/ui/UndoBar';
import { useUndoable } from '@/ui/useUndoable';
import { PromptSheet } from '@/ui/PromptSheet';
import { t } from '@/lib/i18n';

export interface GameSummary {
  file: string;
  index: number;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: string;
  date: string;
  timeControl: string | null;
  eco: string | null;
  link: string | null;
  opening: { eco: string; name: string } | null;
  finalFen: string | null;
  userSide: 'white' | 'black' | null;
  annotated: boolean;
}

interface ArchiveMonth {
  month: string;
  cached: boolean;
  games: number | null;
}

/**
 * The archive browse state lives OUTSIDE the component (a module store), so
 * opening a game and swiping back doesn't wipe the loaded month — the browser
 * remounts GamesView, and local state would reset. This keeps the last browse.
 */
interface ArchiveBrowseState {
  provider: 'chesscom' | 'lichess';
  username: string;
  months: ArchiveMonth[];
  offline: boolean;
  month: string;
  monthGames: GameSummary[];
  /** How many of the newest-first months have been pulled in already. */
  cursor: number;
  /**
   * Months already fetched this session, keyed by provider|user|month.
   *
   * Purely a browsing cache: scrolling back up, flipping to a single
   * month and returning to all dates, or looking the same player up
   * twice all read from here instead of the network. Nothing in it is in
   * the collection — adding a game is still the explicit Add, and this
   * disappears with the tab.
   */
  cache: Record<string, GameSummary[]>;
}
const useArchiveBrowse = create<ArchiveBrowseState>(() => ({
  provider: 'chesscom',
  username: localStorage.getItem('chess-vault:chesscom-user') ?? '',
  months: [],
  offline: false,
  month: '',
  monthGames: [],
  cursor: 0,
  cache: {},
}));

/**
 * How many games a page of "all dates" is worth fetching for.
 *
 * Browsing used to mean every month the account has, newest to oldest,
 * one request each, before the list settled — a decade is dozens of round
 * trips and tens of thousands of rows for a question usually answered by
 * the last fortnight. Months are pulled newest-first until this many
 * games are in hand, and the next batch waits until the reader scrolls
 * far enough to want it.
 */
const PAGE_GAMES = 40;

/** Fetched months, per provider and player, for this session. */
const monthKey = (provider: string, user: string, month: string): string =>
  `${provider}|${user.toLowerCase()}|${month}`;

const gameKey = (g: Pick<GameSummary, 'file' | 'index'>): string => `${g.file}#${g.index}`;

/** Sentinel month meaning "every month this player has". */
const ALL_MONTHS = '*';

/**
 * How many archive rows to put in the DOM at once.
 *
 * "All dates" over a decade is tens of thousands of games, and rendering
 * every one freezes the tab for seconds. The cap is display only —
 * selecting all still selects every game that was loaded, so nothing the
 * user asked for is withheld, and the count below the list says so.
 */
const MAX_ROWS = 1000;

/** Collection file -> document id (the path the studies-style API speaks). */
const docId = (g: Pick<GameSummary, 'file'>): string =>
  g.file.replace(/^collection\//, '').replace(/\.pgn$/, '');

const isCoarsePointer = (): boolean => window.matchMedia('(pointer: coarse)').matches;

/** PGN results with the proper half glyph: 1/2-1/2 → ½-½. */
const fmtResult = (result: string): string => result.replaceAll('1/2', '½');

interface Preview {
  fen: string;
  orientation: 'white' | 'black';
  top: number;
  left: number;
  /** Tapped open on a touch device: show a centred overlay with a scrim
      instead of a popover beside the row (which would cover the row). */
  pinned?: boolean;
}

/** The final-position preview. A hover popover on fine pointers; a centred,
    dismissable overlay when tapped open on touch. Shared by both game lists.
    Any click outside the preview dismisses it (in either mode). */
function GamePreview({ preview, onClose }: { preview: Preview | null; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!preview) return;
    // Capture-phase click: fires BEFORE the game row's own onClick, so a
    // click outside the preview dismisses it AND is swallowed — otherwise
    // the click behind the preview also opened the game.
    const onClick = (e: MouseEvent): void => {
      if (!card.current?.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [preview, onClose]);

  if (!preview) return null;
  if (preview.pinned) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center p-8">
        <div className="bg-scrim absolute inset-0" />
        <div ref={card} className="border-line bg-surface relative w-64 max-w-[80vw] rounded-xl border p-1.5 shadow-[var(--shadow-pop)]">
          <Board fen={preview.fen} orientation={preview.orientation} viewOnly coordinates={false} className="rounded-lg" />
        </div>
      </div>
    );
  }
  return (
    <div
      ref={card}
      style={{ top: preview.top, left: preview.left }}
      className="border-line bg-surface pointer-events-none fixed z-50 w-44 rounded-lg border p-1 shadow-[var(--shadow-pop)]"
    >
      <Board fen={preview.fen} orientation={preview.orientation} viewOnly coordinates={false} className="rounded" />
    </div>
  );
}

/**
 * chess.com TimeControl headers are raw seconds: "600" (10 min), "180+2"
 * (3 min + 2 s increment), or "1/86400" (daily, one move per N seconds).
 */
function formatTimeControl(tc: string | null): string | null {
  if (!tc) return null;
  const daily = tc.match(/^1\/(\d+)$/);
  if (daily) {
    const days = Number(daily[1]) / 86_400;
    return days === 1 ? 'daily' : `daily ${days}d`;
  }
  const live = tc.match(/^(\d+)(?:\+(\d+))?$/);
  if (!live) return tc;
  const minutes = Number(live[1]) / 60;
  const base = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return live[2] !== undefined ? `${base}+${live[2]}` : `${base} min`;
}

/** Router shell: the collection list, or one collected game open for study. */
export function GamesView({ params }: { params: string[] }) {
  // 'elite' is reserved for the reference-games browser; everything else
  // is a collection document id.
  if (params[0] === 'elite') return <EliteGames variant="page" />;
  const id = params[0] ? decodeURIComponent(params[0]) : null;
  return id ? <StudyView id={id} kind="game" /> : <CollectionView />;
}

interface RefGame {
  id: number;
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: string;
  date: string | null;
  event: string | null;
  eco: string | null;
  opening: string | null;
}

/**
 * Browse the reference database (data/refgames.sqlite — Lichess Elite or
 * whatever PGN collections were indexed). Click a game to open it on the
 * analysis board.
 *
 * Three shapes, one component, because it is one thing:
 *
 * `column` — the second half of the column that finds games, behind the
 * tab beside Online archives. Where it belongs on a desktop: the archive
 * and the reference database answer the same question, so they take turns
 * in one panel rather than each taking a box.
 *
 * `window` — below lg, where there is no column. A bottom sheet on a
 * phone, like the archive. It used to navigate to a page of its own,
 * which loses the collection you were about to add to.
 *
 * `page` — its own route, still reachable and still where a 2M-row
 * browser has the most room. The only shape that draws its own frame, its
 * own title and a way back.
 */
function EliteGames({ variant = 'window' }: { variant?: 'page' | 'window' | 'column' }) {
  const page = variant === 'page';
  const [meta, setMeta] = useState<{ ready: boolean; games?: number; sources?: string } | null>(
    null,
  );
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RefGame[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Nothing for the first moment — a search that answers in 40 ms should
  // not flash a skeleton on the way past.
  const searching = useSlowLoad(loading && rows.length === 0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string, offset: number) => {
    setLoading(true);
    const res = await fetch(
      `/api/refgames/search?q=${encodeURIComponent(q)}&offset=${offset}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { total: number | null; rows: RefGame[] };
      // Only the first page of a search carries a total — counting matches
      // means scanning, and every later page would count the same thing.
      if (data.total !== null) setTotal(data.total);
      setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetch('/api/refgames')
      .then((r) => r.json())
      .then((d: { ready: boolean; games?: number; sources?: string }) => {
        setMeta(d);
        if (d.ready) void search('', 0);
      });
  }, [search]);

  const onQuery = (q: string): void => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(q, 0), 250);
  };

  // Infinite scroll: a sentinel row near the list's end pulls the next
  // page as it approaches the viewport.
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || loading || rows.length === 0 || rows.length >= total) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void search(query, rows.length);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, total, loading, query, search]);

  const openGame = async (game: RefGame): Promise<void> => {
    const res = await fetch(`/api/refgames/${game.id}/pgn`);
    if (!res.ok) return;
    const { pgn } = (await res.json()) as { pgn: string };
    if (useAnalysis.getState().loadPgn(pgn)) {
      useAnalysis.setState({ handoff: true });
      navigate('analysis');
    }
  };

  // Keeping an elite game: its PGN becomes a collection document like any
  // promoted chess.com game — annotatable, searchable, yours. The
  // collection keys make already-kept games read 'Added' across reloads,
  // and the server refuses duplicates besides.
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [collectionKeys, setCollectionKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    void loadCollection()
      .then((games) => setCollectionKeys(new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`))))
      .catch(() => {});
  }, []);
  const inCollection = (g: RefGame): boolean =>
    added.has(g.id) || collectionKeys.has(`${g.white}|${g.black}|${g.date ?? ''}`);
  const collect = async (game: RefGame): Promise<void> => {
    const res = await fetch(`/api/refgames/${game.id}/pgn`);
    if (!res.ok) return;
    const { pgn } = (await res.json()) as { pgn: string };
    const posted = await fetch('/api/games/collect-pgn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pgn }),
    });
    // 409 = already there; either way this game is now in the collection.
    if (posted.ok) forgetCollection();
    if (posted.ok || posted.status === 409) setAdded((prev) => new Set(prev).add(game.id));
  };

  // Preview eye, matching the collection rows: the DB stores movetext,
  // not positions, so the final fen is derived lazily from the game's
  // PGN (cached per id). Coarse pointers tap it open, fine ones hover.
  const [preview, setPreview] = useState<Preview | null>(null);
  const fenCache = useRef<Map<number, string>>(new Map());
  const previewSeq = useRef(0);
  const previewFor = useRef<number | null>(null);
  const showPreview = async (game: RefGame, anchor: Element, viaTap = false): Promise<void> => {
    const seq = ++previewSeq.current;
    let fen = fenCache.current.get(game.id);
    if (!fen) {
      const res = await fetch(`/api/refgames/${game.id}/pgn`);
      if (!res.ok) return;
      const { pgn } = (await res.json()) as { pgn: string };
      try {
        const first = pgnToChapters(pgn)[0];
        if (!first) return;
        const lastId = mainlineFrom(first.tree, first.tree.rootId).at(-1) ?? first.tree.rootId;
        fen = getNode(first.tree, lastId).fen;
      } catch {
        return;
      }
      fenCache.current.set(game.id, fen);
    }
    if (seq !== previewSeq.current) return;
    const rect = anchor.getBoundingClientRect();
    setPreview({
      fen,
      orientation: 'white',
      top: Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200),
      left: Math.max(rect.left - 192, 8),
      // Touch opens the centred overlay (its scrim dismisses it), exactly
      // like the collection rows — a beside-row popover on a phone is
      // pointer-events-none AND covers the row it describes.
      ...(viaTap ? { pinned: true } : {}),
    });
  };
  const hidePreview = (): void => {
    previewSeq.current += 1;
    previewFor.current = null;
    setPreview(null);
  };
  const coarse = isCoarsePointer;

  if (meta && !meta.ready) {
    return (
      <div className={cn('grid place-items-center p-8', page && 'h-full')}>
        <div className="max-w-md text-center">
          <p className="text-fg mb-2 text-sm font-semibold">{t('No reference games yet')}</p>
          <p className="text-muted text-xs leading-relaxed">
            {t('Drop PGN collections (Lichess Elite months, TWIC, Lumbra exports) into vault/sources and index them once:')}
          </p>
          <code className="bg-surface-inset border-line text-subtle mt-3 block rounded-md border p-3 text-left font-mono text-[0.6875rem]">
            npm run build:refgames
          </code>
        </div>
      </div>
    );
  }

  const count =
    loading && rows.length === 0
      ? t('Searching…')
      : t('{n} games', { n: total.toLocaleString() });

  const list = (
    <>
      {searching && <SkeletonGameRows rows={8} />}
      {/* The same stripe the collection list has: at three lines a row is
          tall enough that a hairline between rows disappears. */}
      <ul className="divide-line min-h-0 flex-1 divide-y overflow-y-auto [&>li:nth-child(even)]:bg-fg/[0.022]">
          {rows.map((g) => (
            <li key={g.id} className="group hover:bg-surface-2 flex items-center gap-1 pr-2 transition-colors duration-100">
              {/* Mirrors the collection's GameRow — same bold names, same
                  ECO badge, same result tag — so the two lists read as one
                  family rather than as two takes on a game list. */}
              <button
                type="button"
                onClick={() => void openGame(g)}
                title={t('Open on the analysis board')}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="white" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-semibold">{g.white}</span>{' '}
                    <span className="text-subtle text-xs">{g.white_elo}</span>
                  </span>
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="black" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-semibold">{g.black}</span>{' '}
                    <span className="text-subtle text-xs">{g.black_elo}</span>
                  </span>
                  <span className="text-subtle block truncate text-xs">
                    {g.eco ? <OpeningTag eco={g.eco} name={g.opening} /> : g.opening}
                    {(g.eco || g.opening) && g.date ? ' · ' : ''}
                    {g.date ?? ''}
                  </span>
                </span>
                <ResultScore result={g.result} userSide={null} />
              </button>

              {/* The eye lives outside the row's own button — a button
                  inside a button is not markup a browser will keep — and
                  in the same hover tray the collection rows use. Add stays
                  put: it is the point of this page, not a quick action. */}
              <span
                className={cn(
                  'flex shrink-0 items-center rounded-lg p-0.5 transition-opacity duration-100',
                  'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                  'group-hover:bg-surface-3/70 pointer-coarse:opacity-100',
                )}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('Preview the final position')}
                  onMouseEnter={(e) => {
                    if (!coarse()) void showPreview(g, e.currentTarget);
                  }}
                  onMouseLeave={() => {
                    if (!coarse()) hidePreview();
                  }}
                  onClick={(e) => {
                    if (!coarse()) return;
                    e.stopPropagation();
                    if (previewFor.current === g.id) {
                      hidePreview();
                    } else {
                      previewFor.current = g.id;
                      void showPreview(g, e.currentTarget, true);
                    }
                  }}
                >
                  <Eye className="size-3.5" />
                </Button>
              </span>

              {/* w-16 and a bare word when it is done, exactly like the
                  archive's rows: the two lists now take turns in one 210px
                  column, and 20 characters of player name is worth more
                  than a tick beside a word that is already past tense. */}
              <Button
                variant={inCollection(g) ? 'ghost' : 'secondary'}
                size="sm"
                className="w-16 shrink-0"
                disabled={inCollection(g)}
                onClick={() => void collect(g)}
              >
                {inCollection(g) ? (
                  t('Added')
                ) : (
                  <>
                    <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
                    {t('Add')}
                  </>
                )}
              </Button>
            </li>
          ))}
          {rows.length < total && (
            <li ref={sentinel} className="flex items-center justify-center p-3">
              <Loader2 className="text-subtle size-4 animate-spin" />
            </li>
          )}
      </ul>
    </>
  );

  // In the column the panel and the tab that named it are already drawn:
  // this is only the field and the list, laid out like the archive's own
  // body so the two read as one panel that changed its mind.
  if (variant === 'column') {
    return (
      <>
        <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
          <SearchInput
            inputSize="sm"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('Search players, openings, or ECO')}
            spellCheck={false}
            className="w-full"
          />
        </div>
        <div className="border-line text-subtle shrink-0 border-t px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
          {count}
        </div>
        {list}
        <GamePreview preview={preview} onClose={hidePreview} />
      </>
    );
  }

  const body = (
    <>
      <SearchInput
        inputSize="lg"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('Search players, openings, or ECO (e.g. Najdorf, B90)…')}
        spellCheck={false}
        className="w-full shrink-0"
      />

      {/* A page gives this the height it has left and the list scrolls
          inside it. A window has no height to give — it is as tall as what
          is in it, up to a cap — so the panel takes its natural size below
          sm and the window scrolls instead. Exactly what the archive
          browser does in the same window. */}
      <Panel flush className={page ? 'mt-1 min-h-0 flex-1' : 'shrink-0 sm:min-h-0 sm:flex-1'}>
        <PanelHeader title={count} />
        {list}
      </Panel>
      <GamePreview preview={preview} onClose={hidePreview} />
    </>
  );

  // In a window the frame and the title belong to the window; only a page
  // has to draw its own, and a page is also the only one of the three that
  // needs a way back to where it came from.
  if (!page) return body;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" title={t('Back to games')} onClick={() => navigate('games')}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
          {meta?.games
            ? `${t('Elite games')} (${t('{n} games', { n: meta.games.toLocaleString() })})`
            : t('Elite games')}
        </h1>
      </div>
      {body}
    </div>
  );
}

/** The two places a game can be found, and the column's two tabs. */
type SourceId = 'archive' | 'elite';
const SOURCES: { id: SourceId; label: string }[] = [
  { id: 'archive', label: 'Online archives' },
  { id: 'elite', label: 'Elite games' },
];

/**
 * The collection: games deliberately kept for reference, each annotatable.
 * chess.com history is browsed month by month below and promoted per game.
 */
function CollectionView() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [markedOnly, setMarkedOnly] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importing, setImporting] = useState(false);
  /** The archive browser as a window — below lg, where it has no column. */
  const [browsing, setBrowsing] = useState(false);
  /** The reference browser as a window, for the same reason. */
  const [elite, setElite] = useState(false);
  /** Which of the two the column is showing. */
  const [source, setSource] = useState<SourceId>('archive');
  // Not a class: `lg:hidden` on a menu ITEM still leaves a menu of that
  // many items, so at lg the Add games button drew a chevron and a popover
  // to offer a single row. The list has to know the width, not just the
  // rows in it.
  const wide = useMediaQuery('(min-width: 64rem)');

  // A write invalidates, so `load` always goes to the server; the cached
  // copy is what fills the screen while it does.
  const load = useCallback(async (): Promise<void> => {
    forgetCollection();
    try {
      setGames(await loadCollection());
      setLoaded(true);
    } catch {
      setError(t('vault server unreachable'));
    }
  }, []);

  useEffect(() => {
    const cached = cachedCollection();
    if (cached) {
      setGames(cached);
      setLoaded(true);
    }
    void loadCollection()
      .then((games) => {
        setGames(games);
        setLoaded(true);
      })
      .catch(() => setError(t('vault server unreachable')));
    void fetch('/api/games/bookmarks')
      .then((r) => r.json() as Promise<{ keys: string[] }>)
      .then((b) => setBookmarks(new Set(b.keys)))
      .catch(() => {});
  }, [load]);

  const toggleBookmark = async (game: GameSummary): Promise<void> => {
    const res = await fetch('/api/games/bookmarks/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: game.file, index: game.index }),
    });
    if (!res.ok) return;
    const { key, bookmarked } = (await res.json()) as { key: string; bookmarked: boolean };
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (bookmarked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  // Renaming, like notes and studies: a prompt sheet, and the doc id IS
  // the file name. An empty value is the sheet closing without an answer.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  // Right-click opens the same actions the ⋯ offers, where the pointer is.
  const [context, setContext] = useState<{ game: GameSummary; x: number; y: number } | null>(null);
  // The row goes at once; the DELETE waits for the undo to expire.
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const dropGame = (game: GameSummary): void => {
    const key = gameKey(game);
    const unhide = (): void =>
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    setHidden((prev) => new Set(prev).add(key));
    undoable.remove(customName(game) ?? docId(game), () => void removeGame(game).then(unhide), unhide);
  };
  const renameGame = async (game: GameSummary, to: string): Promise<void> => {
    setRenamingKey(null);
    const from = docId(game);
    const next = to.trim();
    if (!next || next === from) return;
    const res = await fetch('/api/games/docs/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: next }),
    });
    if (!res.ok) {
      setError(
        t(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'rename failed'),
      );
    }
    void load();
  };

  const removeGame = async (game: GameSummary): Promise<void> => {
    const id = docId(game);
    await fetch(`/api/games/docs/${encodeURIComponent(id)}`, { method: 'DELETE' });
    void load();
  };

  const openGame = (game: GameSummary): void => {
    const id = docId(game);
    navigate('games', encodeURIComponent(id));
  };


  // A rename in the open-game view changes the document's file name; when
  // it no longer matches the auto "White vs Black date" pattern, that name
  // IS the title the user chose — lead with it.
  const customName = (g: GameSummary): string | null => {
    const name = docId(g);
    // The same rule the server named the file with — see shared/vaultNames.
    const autoPrefix = sanitizeSegment(`${g.white} vs ${g.black}`, '');
    // Compared loosely on punctuation and case. A file written as
    // "Firouzja A vs Vaishali R 2026-12-24" from a header that reads
    // "Firouzja, A" did not match its own auto name, so every reference
    // game in the collection claimed to have been renamed — and led with
    // its filename instead of showing the two players on their own lines.
    const loose = (s: string): string => s.replace(/[,.]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return loose(name).startsWith(loose(autoPrefix)) ? null : name;
  };

  // Built once and shared: the archive renders twice (beside the
  // collection, and in the phone's window) and each copy needs it.
  const collectionKeys = new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`));

  const needle = query.trim().toLowerCase();
  const visible = games.filter((g) => {
    if (hidden.has(gameKey(g))) return false;
    if (markedOnly && !bookmarks.has(gameKey(g))) return false;
    if (!needle) return true;
    return `${customName(g) ?? ''} ${g.white} ${g.black} ${g.eco ?? ''} ${g.opening?.name ?? ''} ${g.date}`
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 scrollbar-hidden sm:overflow-hidden lg:max-w-7xl lg:p-6">
      {/* flex-wrap + the search field's narrow flex-1: phones drop the
          controls onto their own full-width line instead of clipping. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{t('Games')}</h1>
        {/* Wraps below sm: a focused search field takes the whole line there. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          <SearchInput
            type="text"
            inputSize="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search collection…')}
            className="w-56 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
          />
          {/* Search, then filter, then create — the order the two shelves
              use, so the three toolbars are one toolbar in three places.
              Icon only, like theirs: the word Bookmarked beside it was the
              only label in any of them, and a pressed state says the same
              thing without asking for the width. */}
          <Button
            variant="secondary"
            size="icon-sm"
            active={markedOnly}
            aria-pressed={markedOnly}
            title={markedOnly ? t('Show all games') : t('Show bookmarked games only')}
            className="shrink-0"
            onClick={() => setMarkedOnly((v) => !v)}
          >
            <Bookmark className={cn('size-3.5', markedOnly && 'fill-warn text-warn')} />
          </Button>
          {/* Every way to get a game, in one place — but only while there
              is nowhere better for them. At lg the two browsers live in
              the column to the right, where they are on screen rather
              than behind a press, and offering a window over a panel you
              can already see is worse than not offering it. So at lg this
              is what it says on it: import a game. */}
          <CreateControl
            label="Add games"
            actions={[
              { label: 'Import a game', icon: Plus, onSelect: () => setImporting(true) },
              ...(wide
                ? []
                : [
                    { label: 'Browse an online archive', icon: Globe, onSelect: () => setBrowsing(true) },
                    { label: 'Elite games', icon: Trophy, onSelect: () => setElite(true) },
                  ]),
            ]}
          />
        </div>
      </header>

      {importing && (
        <ImportGamePanel
          onDone={() => {
            setImporting(false);
            void load();
          }}
          onCancel={() => setImporting(false)}
        />
      )}

      {error && <p className="text-bad text-xs">{error}</p>}

      {/* Two columns on a desktop: the collection is the page and takes the
          full height (it showed four rows when the archive browser sat
          under it), and the browser is a tool beside it. One under the
          other below lg, where there is no width to split. */}
      {/* minmax(0,…), not a bare 7fr/3fr: an fr track is min-content wide
          at its narrowest, so the column silently widened to fit the
          longest opening name in whichever list it was showing — the two
          panels changed width when the tab was switched.

          And a FLOOR under the right one. minmax(0,3fr) let it shrink to
          226px at a 1024 window, which is less than this row's own
          furniture: the text box reached ZERO width, and the ratings and
          the result badge — both shrink-0 — spilled out of it and painted
          over each other. 20rem is the narrowest the list is legible at;
          the collection gives up the difference, having the easier job. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(20rem,3fr)] lg:items-stretch">
      {
        // shrink-0 below lg: loading an archive month must not squeeze this
        // panel — the page column scrolls instead.
        <Panel flush className="shrink-0 sm:min-h-0 lg:min-h-0 lg:shrink lg:self-stretch">
          {/* No Elite games button here any more: it is one of the ways to
              ADD a game, and every one of those is behind the header's
              Add games now. A panel header should say what the panel
              holds, not offer a way somewhere else. */}
          <PanelHeader title={`${t('Collection')} · ${visible.length}`} />
          {loaded && games.length === 0 ? (
            <EmptyState
              // Centred in the PANEL, not parked under its header: an empty
              // state pinned to the top of a full-height box is the thing
              // that leaves a reader looking at dead space below it.
              className="min-h-0 flex-1"
              art={<CollectionArt />}
              title="Your collection is empty"
              body="The collection holds the games worth keeping — each one annotatable like a study. Import one, or browse your online archive and add the games you want to study."
              action={
                <Button variant="primary" size="sm" onClick={() => setImporting(true)}>
                  <Plus className="mr-1 size-3.5" />
                  {t('Import a game')}
                </Button>
              }
            />
          ) : loaded && visible.length === 0 ? (
            /* The collection HAS games; this search or the bookmark toggle
               just matches none of them. Saying so beats a box with nothing
               under its header, which reads as the collection having been
               emptied. Each of these ends on the press that undoes it —
               an empty state whose only advice is "go and do something
               else" leaves the reader looking at dead space. */
            markedOnly && !needle ? (
              <EmptyState
                className="min-h-0 flex-1"
                art={<BookmarkArt />}
                title="No bookmarked games yet"
                body="Bookmark a game from the list and it is kept here, one press from wherever you are."
                action={
                  <Button variant="primary" size="sm" onClick={() => setMarkedOnly(false)}>
                    <BookOpen className="mr-1 size-3.5" />
                    {t('Browse all games')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                className="min-h-0 flex-1"
                art={<NoMatchArt />}
                title="Nothing matches that search"
                body={
                  markedOnly
                    ? 'No bookmarked game in your collection matches it. Clearing the search shows every bookmark again.'
                    : 'No game in your collection matches it. Clearing the search shows the whole collection again.'
                }
                action={
                  <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                    <X className="mr-1 size-3.5" />
                    {t('Clear search')}
                  </Button>
                }
              />
            )
          ) : (
          // Dividers AND a faint stripe on every other row: at two lines a
          // row is tall enough that a hairline alone left the list reading
          // as one block of text. The stripe is 2% of the foreground —
          // enough to group the two lines that belong together, not enough
          // to read as a highlight.
          <ul className="divide-line min-h-0 flex-1 divide-y overflow-y-auto [&>li:nth-child(even)]:bg-fg/[0.022] sm:max-h-[38dvh] lg:max-h-none">
            {visible.map((game) => (
              <GameRow
                key={gameKey(game)}
                onSwipeAway={() => dropGame(game)}
                onBookmark={() => void toggleBookmark(game)}
                bookmarked={bookmarks.has(gameKey(game))}
                game={game}
                customName={customName(game)}
                renaming={renamingKey === gameKey(game)}
                onRename={(to) => void renameGame(game, to)}
                onOpen={() => openGame(game)}
                onPreview={setPreview}
                onContext={(x, y) => setContext({ game, x, y })}
                actions={
                  // The star is a CONTROL, so it lives where controls live:
                  // in the hover tray on a desktop, and not on a phone at
                  // all, where the row is swiped right or its ⋯ is used.
                  // What a bookmarked game says for itself is the amber
                  // edge down its left — which costs no width at all, and
                  // a lit star standing permanently at the end of a 390px
                  // row cost the player names about 36px of theirs.
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={bookmarks.has(gameKey(game)) ? t('Remove bookmark') : t('Bookmark')}
                    className="pointer-coarse:hidden shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleBookmark(game);
                    }}
                  >
                    <Bookmark
                      className={cn(
                        'size-3.5',
                        bookmarks.has(gameKey(game)) && 'fill-warn text-warn',
                      )}
                    />
                  </Button>
                }
                menu={[
                  {
                    // Same rule as the preview: on a desktop the mark is
                    // already in the row's tray, and repeating it here
                    // just makes the menu longer to read.
                    label: bookmarks.has(gameKey(game)) ? 'Remove bookmark' : 'Bookmark',
                    icon: Bookmark,
                    className: 'pointer-fine:hidden',
                    onSelect: () => void toggleBookmark(game),
                  },
                  { label: 'Rename', icon: Pencil, onSelect: () => setRenamingKey(gameKey(game)) },
                  ...(game.link
                    ? [
                        {
                          label: 'View online',
                          icon: ExternalLink,
                          onSelect: () => window.open(game.link!, '_blank', 'noreferrer'),
                        },
                      ]
                    : []),
                  { label: 'Remove', icon: Trash2, danger: true, onSelect: () => dropGame(game) },
                ]}
                showLink={false}
              />
            ))}
          </ul>
          )}
        </Panel>
      }

      {/* Where a game comes from, as ONE panel with two answers: the games
          you have played, and the games masters have. They are the same
          question — find a game worth keeping — so they take turns in one
          box rather than each taking a box and halving the other's height.
          Beside the collection where there is width for it, and nowhere at
          all below lg, where both open from Add games as windows. */}
      <div className="hidden min-h-0 lg:flex lg:flex-col">
        <Panel flush className="min-h-0 flex-1">
          {/* The panel's TITLE is the switch. A pill track here would be
              the second one in this panel — the provider tabs are eight
              pixels below it — and two stacked tracks read as one
              two-storey control. Naming the panel is what a header does,
              so the live tab is the header's own rule, thickened and lit
              under the name that is showing. */}
          <header
            role="tablist"
            aria-label={t('Where to find a game')}
            className="border-line flex h-10 shrink-0 items-center gap-1 border-b px-2"
          >
            {SOURCES.map(({ id, label }) => {
              const on = source === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSource(id)}
                  // No icon, and not the header's uppercase micro-caps:
                  // measured, the pair came to 256px that way and this
                  // column is 210px wide at the narrowest lg. Plain text
                  // at text-xs is 178. min-w-0 so a longer translation
                  // truncates rather than pushing the second tab out.
                  className={cn(
                    'relative flex h-10 min-w-0 items-center px-1.5 text-xs font-semibold',
                    'transition-colors duration-100',
                    on
                      ? 'text-fg after:bg-primary after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full'
                      : 'text-subtle hover:text-fg',
                  )}
                >
                  <span className="truncate">{t(label)}</span>
                </button>
              );
            })}
          </header>

          {source === 'archive' ? (
            <ArchiveBrowser
              framed={false}
              collectionKeys={collectionKeys}
              onCollected={() => void load()}
              onPreview={setPreview}
            />
          ) : (
            <EliteGames variant="column" />
          )}
        </Panel>
      </div>
      </div>

      {/* No lg:hidden on the window itself: that would hide the CARD and
          leave its scrim behind, dimming the page with nothing on it and
          nothing to press. The menu item is what disappears at lg — see
          below — so this can only be opened where it belongs, and a
          window left open across a resize stays usable. */}
      {browsing && (
        <Modal title="Online archives" onClose={() => setBrowsing(false)} full>
          {/* Unframed here too: the window's own title bar already says
              Online archives, and the panel said it again directly under
              it. A window that names itself twice is a window with a
              wasted line and a reader wondering what the difference is. */}
          <ArchiveBrowser
            framed={false}
            collectionKeys={collectionKeys}
            onCollected={() => void load()}
            onPreview={setPreview}
          />
        </Modal>
      )}

      {elite && (
        <Modal title="Elite games" onClose={() => setElite(false)} full>
          <EliteGames />
        </Modal>
      )}

      {context && (
        <ActionSheet
          title={customName(context.game) ?? docId(context.game)}
          point={{ x: context.x, y: context.y }}
          onClose={() => setContext(null)}
          actions={[
            {
              label: 'Rename',
              icon: Pencil,
              onSelect: () => setRenamingKey(gameKey(context.game)),
            },
            {
              label: bookmarks.has(gameKey(context.game)) ? 'Remove bookmark' : 'Bookmark',
              icon: Bookmark,
              onSelect: () => void toggleBookmark(context.game),
            },
            { label: 'Remove', icon: Trash2, danger: true, onSelect: () => dropGame(context.game) },
          ]}
        />
      )}

      <GamePreview preview={preview} onClose={() => setPreview(null)} />

      {undoable.pending && (
        <UndoBar
          label={undoable.pending.label}
          leaving={undoable.pending.leaving}
          onUndo={undoable.undo}
        />
      )}

      <FabSpacer />
    </div>
  );
}

/**
 * Month-by-month browser over a chess.com account. Months are cached on disk
 * the first time they are opened, so revisiting works offline; games are
 * added to the collection one by one.
 */
function ArchiveBrowser({
  collectionKeys,
  onCollected,
  onPreview,
  framed = true,
}: {
  collectionKeys: Set<string>;
  onCollected: () => void;
  onPreview: (p: Preview | null) => void;
  /** Off in the column, where it shares a panel with Elite games. */
  framed?: boolean;
}) {
  // Browse state persists across remounts (see useArchiveBrowse); setters
  // mirror the useState API so the call sites below are unchanged.
  const { provider, username, months, offline, month, monthGames, cursor } = useArchiveBrowse();
  const setUsername = (v: string | ((p: string) => string)): void =>
    useArchiveBrowse.setState((s) => ({ username: typeof v === 'function' ? v(s.username) : v }));
  const setProvider = (v: 'chesscom' | 'lichess'): void => useArchiveBrowse.setState({ provider: v });
  const setMonths = (v: ArchiveMonth[]): void => useArchiveBrowse.setState({ months: v });
  const setOffline = (v: boolean): void => useArchiveBrowse.setState({ offline: v });
  const setMonth = (v: string): void => useArchiveBrowse.setState({ month: v });
  const setMonthGames = (v: GameSummary[]): void => useArchiveBrowse.setState({ monthGames: v });
  // First run on a device: fall back to the profile usernames from Settings.
  useEffect(() => {
    if (username.trim()) return;
    void fetch('/api/settings')
      .then((r) => (r.ok ? (r.json() as Promise<{ profile?: { chesscom?: string; lichess?: string } }>) : null))
      .then((s) => {
        const fromProfile = provider === 'chesscom' ? s?.profile?.chesscom : s?.profile?.lichess;
        if (fromProfile) setUsername((current) => (current.trim() ? current : fromProfile));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
  const apiBase = provider === 'chesscom' ? '/api/games/archive' : '/api/games/lichess';
  /**
   * The handles looked up before, on THIS provider, kept on the device.
   * Typing a username is the one thing this panel asks for over and over,
   * and until an archive is loaded the space below it does nothing.
   */
  const recentsKey = `chess-vault:recent-${provider}`;
  const [recents, setRecents] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recentsKey) ?? '[]') as unknown;
      return Array.isArray(stored) ? (stored as string[]).slice(0, 4) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recentsKey) ?? '[]') as unknown;
      setRecents(Array.isArray(stored) ? (stored as string[]).slice(0, 4) : []);
    } catch {
      setRecents([]);
    }
  }, [recentsKey]);
  const rememberRecent = (who: string): void => {
    setRecents((prev) => {
      const next = [who, ...prev.filter((p) => p.toLowerCase() !== who.toLowerCase())].slice(0, 4);
      localStorage.setItem(recentsKey, JSON.stringify(next));
      return next;
    });
  };
  /** A mistyped handle should not sit there for the next four searches. */
  const forgetRecent = (who: string): void => {
    setRecents((prev) => {
      const next = prev.filter((p) => p !== who);
      localStorage.setItem(recentsKey, JSON.stringify(next));
      return next;
    });
  };
  const [loading, setLoading] = useState<'months' | 'games' | null>(null);
  // On a phone this panel sits under the collection, so an archive that has
  // just arrived is off the bottom of the screen. Scrolled to, once, when it
  // appears — not on every re-render, which would fight the finger.
  const archiveTop = useRef<HTMLDivElement>(null);
  const hadMonths = useRef(false);
  useEffect(() => {
    if (months.length === 0) {
      hadMonths.current = false;
      return;
    }
    if (hadMonths.current) return;
    hadMonths.current = true;
    archiveTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [months.length]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const loadMonths = async (who?: string): Promise<void> => {
    const user = (who ?? username).trim();
    if (!user) return;
    localStorage.setItem('chess-vault:chesscom-user', user);
    rememberRecent(user);
    setLoading('months');
    setError(null);
    setMonth('');
    setMonthGames([]);
    try {
      const res = await fetch(`${apiBase}/months?user=${encodeURIComponent(user)}`);
      const body = (await res.json()) as
        | { months: ArchiveMonth[]; offline: boolean }
        | { error: string };
      if ('error' in body) setError(body.error);
      else {
        setMonths(body.months);
        setOffline(body.offline);
        // All dates rather than one month — the question people open this
        // page with is "have I played this before" — but only the newest
        // page of it. The rest arrives as it is scrolled to.
        if (body.months.length) await loadAllMonths(body.months, user);
      }
    } catch {
      setError(t('vault server unreachable'));
    } finally {
      setLoading(null);
    }
  };

  /**
   * One month, from the session cache if it has been seen before.
   *
   * Newest game first, which is the order every list here is in. A month
   * that cannot be reached yields nothing rather than throwing: one bad
   * month must not lose the rest of a decade.
   */
  const fetchMonth = async (user: string, m: string): Promise<GameSummary[]> => {
    const key = monthKey(provider, user, m);
    const hit = useArchiveBrowse.getState().cache[key];
    if (hit) return hit;
    try {
      const res = await fetch(`${apiBase}/month?user=${encodeURIComponent(user)}&month=${m}`);
      if (!res.ok) return [];
      const body = (await res.json()) as { games?: GameSummary[] };
      const games = (body.games ?? []).slice().reverse();
      useArchiveBrowse.setState((s) => ({ cache: { ...s.cache, [key]: games } }));
      return games;
    } catch {
      return [];
    }
  };

  /** The months this account has, newest first — the order they load in. */
  const newestFirst = (list: ArchiveMonth[]): string[] =>
    list.map((m) => m.month).sort().reverse();

  /**
   * The newest page of every month, and no more than that.
   *
   * `list` and `who` are taken as arguments because the first call happens
   * in the same tick as setMonths()/setUsername(): reading them off the
   * store there would find the previous lookup's values.
   */
  const loadAllMonths = async (list: ArchiveMonth[] = months, who?: string): Promise<void> => {
    const user = (who ?? username).trim();
    setMonth(ALL_MONTHS);
    setError(null);
    useArchiveBrowse.setState({ monthGames: [], cursor: 0 });
    await loadMore(list, user);
  };

  /**
   * The next months, until a page is in hand or the account runs out.
   *
   * Re-entrancy matters: the sentinel can come back into view while a
   * batch is still in flight, and asking twice for the same months would
   * double every row. The ref is the gate.
   */
  const loadingMore = useRef(false);
  const moreSentinel = useRef<HTMLLIElement>(null);
  const loadMore = async (list: ArchiveMonth[] = months, who?: string): Promise<void> => {
    if (loadingMore.current) return;
    const user = (who ?? username).trim();
    const all = newestFirst(list);
    if (useArchiveBrowse.getState().cursor >= all.length) return;
    loadingMore.current = true;
    setLoading('games');
    try {
      let added = 0;
      while (added < PAGE_GAMES) {
        const { cursor } = useArchiveBrowse.getState();
        if (cursor >= all.length) break;
        const games = await fetchMonth(user, all[cursor]!);
        added += games.length;
        useArchiveBrowse.setState((s) => ({
          monthGames: [...s.monthGames, ...games],
          cursor: s.cursor + 1,
        }));
      }
    } finally {
      loadingMore.current = false;
      setLoading(null);
    }
  };

  /**
   * The next page, when the bottom of the list comes into view.
   *
   * `rootMargin` fires it a screenful early, so scrolling is continuous
   * rather than stopping at a spinner and waiting. Re-armed whenever the
   * cursor moves, because the sentinel is a new element each time.
   */
  useEffect(() => {
    const node = moreSentinel.current;
    if (!node || month !== ALL_MONTHS || cursor >= months.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '400px' },
    );
    io.observe(node);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, cursor, months.length]);

  const loadMonth = async (m: string): Promise<void> => {
    if (m === ALL_MONTHS) return loadAllMonths();
    setMonth(m);
    setLoading('games');
    setError(null);
    // Through the same cache as the paged path, so flipping between a
    // single month and all dates costs nothing after the first look.
    setMonthGames(await fetchMonth(username.trim(), m));
    setLoading(null);
  };

  // Row click: look at the game in Analysis (from the player's side) without
  // committing it to the collection — Add is the explicit action.
  const openInAnalysis = async (game: GameSummary): Promise<void> => {
    try {
      const res = await fetch(
        `/api/games/pgn?file=${encodeURIComponent(game.file)}&index=${game.index}`,
      );
      const { pgn } = (await res.json()) as { pgn: string };
      const { loadPgn } = useAnalysis.getState();
      if (loadPgn(pgn)) {
        if (game.userSide) useAnalysis.setState({ orientation: game.userSide });
        useAnalysis.setState({ handoff: true });
        navigate('analysis');
      }
    } catch {
      setError(t('could not load that game'));
    }
  };

  // Selection is a MODE, not a permanent column: a checkbox on every row
  // is clutter for the common case, which is picking out one game.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [addProgress, setAddProgress] = useState<{ done: number; total: number } | null>(null);
  const [sideFilter, setSideFilter] = useState<'any' | 'white' | 'black'>('any');
  const [resultFilter, setResultFilter] = useState<'any' | '1-0' | '0-1' | '1/2-1/2'>('any');
  const visibleMonthGames = monthGames.filter(
    (g) =>
      (sideFilter === 'any' || g.userSide === sideFilter) &&
      (resultFilter === 'any' || g.result === resultFilter),
  );

  /**
   * Everything the current filters show. Any row can be ticked, including
   * one already collected — adding a game twice writes a "(2)" file rather
   * than overwriting anything, and refusing silently is worse than a
   * duplicate the user can delete.
   */
  const pickable = visibleMonthGames;

  /**
   * What "Select all" takes: the ones not already collected.
   *
   * Not a refusal — each of those rows still has a working checkbox, and
   * ticking one is how you deliberately take a second copy. It is about
   * what ONE click should mean. Under All dates, "all" spans a decade, and
   * a Select all that included everything already imported would re-add an
   * entire history as "(2)" files from a single press.
   */
  const uncollected = visibleMonthGames.filter(
    (g) => !added.has(gameKey(g)) && !collectionKeys.has(`${g.white}|${g.black}|${g.date}`),
  );

  const switchProvider = (next: 'chesscom' | 'lichess'): void => {
    if (next === provider) return;
    setProvider(next);
    setMonths([]);
    setMonth('');
    setMonthGames([]);
    setError(null);
  };

  /**
   * Add many games in one request.
   *
   * One call rather than one per game: a month is hundreds of games, and
   * the server parses the archive file once for the whole batch. `all`
   * means the whole file, whatever the current filters show — it is sent
   * as explicit indexes so what you ticked is what you get.
   */
  const collectMany = async (games: GameSummary[]): Promise<void> => {
    if (!games.length) return;
    setBusy(true);
    setError(null);

    // Grouped by archive file: under "All dates" a selection spans many
    // months, and the server parses one file per request. One request per
    // month, not one per game.
    const byFile = new Map<string, GameSummary[]>();
    for (const g of games) byFile.set(g.file, [...(byFile.get(g.file) ?? []), g]);

    const done: GameSummary[] = [];
    let failure: string | null = null;
    for (const [file, group] of byFile) {
      // Adding a hundred games is still one request per month, so the
      // button counts them off rather than sitting on "Adding…" for a
      // minute with nothing to show it is alive.
      setAddProgress({ done: done.length, total: games.length });
      const res = await fetch('/api/games/collect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, indexes: group.map((g) => g.index) }),
      });
      if (res.ok) done.push(...group);
      else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        failure = body?.error ?? t('could not add those games');
      }
    }

    setAddProgress(null);
    setBusy(false);
    setAdded((prev) => {
      const next = new Set(prev);
      for (const g of done) next.add(gameKey(g));
      return next;
    });
    setPicked(new Set());
    setSelecting(false);
    onCollected();
    if (failure) setError(failure);
  };

  const collect = async (game: GameSummary): Promise<void> => {
    const res = await fetch('/api/games/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: game.file, index: game.index }),
    });
    if (res.ok) {
      setAdded((prev) => new Set(prev).add(gameKey(game)));
      onCollected();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(t(body?.error ?? 'could not add that game'));
    }
  };

  const body = (
    <>
      {/* pt-3, not flush under the header's rule: the tab bar is a raised
          control and sitting it straight against the line made the two
          read as one stuck-together thing. */}
      <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
        {/* One track, one lit segment. As two chips it was impossible to
            tell by looking whether they were a choice or two independent
            toggles — and both being unlit is not a state this has. */}
        <Segmented
          value={provider}
          onChange={switchProvider}
          ariaLabel="Which site to browse"
          className="w-full"
          segments={[
            {
              value: 'chesscom',
              // Each site answers in its own colour when it is the live
              // one: chess.com's green, Lichess's near-white.
              accent: '#8fbb5c',
              label: (
                <>
                  {/* chess.com's pawn, in its brand green */}
                  <svg viewBox="5 4.5 35 37" className="size-3.5 shrink-0" fill="#7fa650" aria-hidden>
                    <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" />
                  </svg>
                  <span className="truncate">chess.com</span>
                </>
              ),
            },
            {
              value: 'lichess',
              accent: '#f2f2f0',
              label: (
                <>
                  {/* lichess's knight mark */}
                  <KnightIcon className="size-3.5 shrink-0 fill-current" />
                  <span className="truncate">Lichess</span>
                </>
              ),
            },
          ]}
        />

        <div className="flex items-center gap-1">
          <Input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && username.trim()) void loadMonths();
            }}
            placeholder={provider === 'chesscom' ? t('chess.com username') : t('Lichess username')}
            className="w-auto min-w-0 flex-1 font-mono"
            inputSize="sm"
          />
          <Button
            variant="secondary"
            size="icon-sm"
            title={t("Browse this player's online archive")}
            disabled={loading !== null || !username.trim()}
            onClick={() => void loadMonths()}
          >
            {loading === 'months' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Globe className="size-3.5" />
            )}
          </Button>
        </div>

        {/* Who you have looked up before, on this provider. Typing a handle
            again is the one thing this panel asks for repeatedly, and the
            empty space under it was doing nothing. A list of names with no
            heading read as a result, not as history — and there was no way
            to drop one that had been mistyped. */}
        {months.length === 0 && recents.length > 0 && (
          <div className="mt-1 flex flex-col gap-1.5">
            <p className="text-subtle text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
              {t('Recent searches')}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {recents.map((who) => (
                <span
                  key={who}
                  className="border-line text-muted hover:border-line-strong hover:text-fg group/recent flex w-fit shrink-0 items-center rounded-full border pl-2.5 transition-colors duration-100"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setUsername(who);
                      void loadMonths(who);
                    }}
                    className="max-w-[9rem] truncate py-1 font-mono text-xs"
                  >
                    {who}
                  </button>
                  <button
                    type="button"
                    title={t('Forget this search')}
                    aria-label={t('Forget this search')}
                    onClick={() => forgetRecent(who)}
                    className="text-subtle hover:text-bad grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Second row, only once an archive is loaded: month + quick filters. */}
      {months.length > 0 && (
        <div ref={archiveTop}>
        {/* Three selects, not eight chips on a rail.
            Seven chips and a select never fit the 30% column this panel
            lives in, so the row scrolled sideways behind a pair of arrows
            — which hides filters behind a gesture and gives no clue what
            is currently set without scrolling to look. A select states
            its own value, takes one line whatever the options are, and
            wraps onto a second when the column is narrow. */}
        <div className="border-line flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
          <Select
            value={month}
            onChange={(m) => void loadMonth(m)}
            ariaLabel={t('Archive month')}
            size="sm"
            className="min-w-0 flex-1"
            groups={[
              {
                options: [
                  { value: ALL_MONTHS, label: t('All dates') },
                  ...months.map((m) => ({
                    value: m.month,
                    label: `${m.month}${
                      m.cached
                        ? ` · ${t('{n} games', { n: m.games ?? 0 })}`
                        : offline
                          ? ` · ${t('needs internet')}`
                          : ''
                    }`,
                    // The month alone once it is chosen: how many games it
                    // holds is what you needed while picking one.
                    short: m.month,
                  })),
                ],
              },
            ]}
          />
          <Select
            value={sideFilter}
            onChange={(v) => setSideFilter(v as typeof sideFilter)}
            ariaLabel={t('Side')}
            size="sm"
            className="min-w-0 flex-1"
            groups={[
              {
                options: [
                  { value: 'any', label: t('Either side') },
                  { value: 'white', label: t('As White') },
                  { value: 'black', label: t('As Black') },
                ],
              },
            ]}
          />
          <Select
            value={resultFilter}
            onChange={(v) => setResultFilter(v as typeof resultFilter)}
            ariaLabel={t('Outcome')}
            size="sm"
            className="min-w-0 flex-1"
            groups={[
              {
                options: [
                  { value: 'any', label: t('Any result') },
                  { value: '1-0', label: t('White won') },
                  { value: '0-1', label: t('Black won') },
                  { value: '1/2-1/2', label: t('Drawn') },
                ],
              },
            ]}
          />
        </div>
        </div>
      )}
      {((offline && months.length > 0) || error) && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          {offline && months.length > 0 && (
            <span className="text-warn text-xs">{t('offline — cached months only')}</span>
          )}
          {error && <span className="text-bad text-xs">{error}</span>}
        </div>
      )}

      {month && visibleMonthGames.length > 0 && (
        <div className="border-line flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs">
          {!selecting ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={pickable.length === 0}
                onClick={() => setSelecting(true)}
              >
                {t('Select…')}
              </Button>
              {/* How much of the archive is in hand. It used to be all of
                  it, so there was nothing to say; now the list grows as it
                  is scrolled and the count is the only thing that tells
                  you Select all does not mean the whole decade. */}
              {month === ALL_MONTHS && (
                <span className="text-subtle tabular-nums">
                  {cursor >= months.length
                    ? t('{n} games · all {total} months', {
                        n: visibleMonthGames.length,
                        total: months.length,
                      })
                    : t('{n} games · {at} of {total} months', {
                        n: visibleMonthGames.length,
                        at: cursor,
                        total: months.length,
                      })}
                </span>
              )}
            </>
          ) : (
            /* What is selected on the left, what to do with it on the
               right. Four controls in one wrapping run gave the count the
               same weight as the buttons and put Cancel wherever the text
               happened to end. */
            <>
              <label className="flex min-w-0 cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-primary shrink-0"
                  checked={uncollected.length > 0 && picked.size === uncollected.length}
                  // Indeterminate is the honest state for a partial
                  // selection: an unchecked box next to eight ticked rows
                  // reads as a bug.
                  ref={(el) => {
                    if (el) el.indeterminate = picked.size > 0 && picked.size < uncollected.length;
                  }}
                  onChange={(e) =>
                    setPicked(e.target.checked ? new Set(uncollected.map(gameKey)) : new Set())
                  }
                />
                <span className="text-muted truncate">{t('Select all new')}</span>
              </label>
              {/* A badge, not another grey sentence: it is the one number
                  that changes as you tick rows. */}
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums',
                  picked.size > 0 ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-subtle',
                )}
              >
                {t('{n} selected', { n: picked.size })}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelecting(false);
                    setPicked(new Set());
                  }}
                >
                  {t('Cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={picked.size === 0}
                  onClick={() => void collectMany(pickable.filter((g) => picked.has(gameKey(g))))}
                >
                  {busy
                    ? addProgress
                      ? t('Adding {done}/{total}…', addProgress)
                      : t('Adding…')
                    : t('Add selected')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* The list is a container, so its rows can answer to the width they
          actually have rather than to the window's. Named, so the rules
          only fire here — the collection's rows are the same component in
          a column with twice the room. */}
      {month && (
        <ul className="@container/arc divide-line max-h-96 min-h-0 divide-y overflow-y-auto border-t border-line sm:max-h-none sm:flex-1">
          {loading === 'games' && visibleMonthGames.length === 0 ? (
            // Rows, not a spinner on an empty box. Fetching a month used to
            // take the games away and leave one line of text where the list
            // had been, so the panel appeared to close and reopen.
            <li>
              <SkeletonGameRows rows={6} />
            </li>
          ) : (
            visibleMonthGames.slice(0, MAX_ROWS).map((game) => {
              const inCollection =
                added.has(gameKey(game)) ||
                collectionKeys.has(`${game.white}|${game.black}|${game.date}`);
              return (
                <GameRow
                  key={gameKey(game)}
                  game={game}
                  onOpen={() => void openInAnalysis(game)}
                  onPreview={onPreview}
                  actions={
                    <>
                    {selecting && (
                      <input
                        type="checkbox"
                        className="accent-primary mr-1 shrink-0"
                        aria-label={t('Select this game')}
                        checked={picked.has(gameKey(game))}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(gameKey(game));
                          else next.delete(gameKey(game));
                          setPicked(next);
                        }}
                      />
                    )}
                    <Button
                      variant={inCollection ? 'ghost' : 'secondary'}
                      size="sm"
                      disabled={inCollection}
                      className="w-16 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        void collect(game);
                      }}
                    >
                      {inCollection ? (
                        t('Added')
                      ) : (
                        <>
                          <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
                          {t('Add')}
                        </>
                      )}
                    </Button>
                    </>
                  }
                />
              );
            })
          )}

          {/* The end of the list asks for the next months. Older play is
              reached by scrolling towards it, which is the same gesture
              that used to be a minute of waiting before anything showed. */}
          {month === ALL_MONTHS && cursor < months.length && (
            <li ref={moreSentinel} className="flex items-center justify-center gap-2 p-3">
              <Loader2 className="text-subtle size-4 animate-spin" />
              <span className="text-subtle text-xs">
                {t('Loading older games…')}
              </span>
            </li>
          )}
        </ul>
      )}

      {month && visibleMonthGames.length > MAX_ROWS && (
        // The short version on the line, the whole sentence on hover. It
        // was two clauses of body text across the foot of the panel, which
        // reads as an error rather than as a footnote about a list that is
        // longer than its box — and the reassuring half ("Select all new
        // still takes every one") was the half nobody finished reading.
        <p
          className="text-subtle border-line flex items-center gap-1.5 border-t px-3 py-2 text-[0.6875rem]"
          title={t('Showing the first {shown} of {total}. Select all new still takes every one.', {
            shown: MAX_ROWS,
            total: visibleMonthGames.length,
          })}
        >
          <Info className="size-3 shrink-0" />
          <span className="truncate">
            {t('First {shown} of {total}', { shown: MAX_ROWS, total: visibleMonthGames.length })}
          </span>
        </p>
      )}

      {/* Looking one up is a wait, and the wait used to EMPTY the panel:
          the prompt vanished, the panel collapsed to its bar, and the
          results arrived somewhere below the fold. Rows in the same box
          instead, so the panel keeps its size and its place. */}
      {!month && loading === 'months' && (
        <div className="border-line min-h-0 flex-1 border-t">
          <SkeletonGameRows rows={6} />
        </div>
      )}

      {/* Nothing browsed yet: fill the panel with a prompt instead of
          leaving a bare bar over blank space. */}
      {!month && loading !== 'months' && (
        <div className="border-line flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border-t px-6 py-14 text-center">
          {/* What the panel does, drawn — rather than the same globe that
              is already on the button two inches above it.

              shrink-0, or the column crushes it: an SVG with a width and
              an automatic height is a flex item that will give up every
              pixel of that height before the paragraph beside it gives up
              one. In a sheet shortened by the keyboard it went to exactly
              0 and appeared to have been hidden on purpose. It is hidden
              on purpose NOW — a picture is the first thing to go when
              there is no room, and the sentence is the part that was
              doing the work. */}
          <CloudBoardArt className="keyboard:hidden w-20 shrink-0" />
          <p className="text-muted max-w-xs text-sm leading-relaxed">
            {t(
              'Browse your games. Type your {site} username above and pick a month — then add the ones worth keeping to your collection.',
              { site: provider === 'chesscom' ? 'chess.com' : 'Lichess' },
            )}
          </p>
        </div>
      )}
    </>
  );

  // In the column it shares a panel with Elite games, and the tab that
  // switched to it has already said which one this is. Everywhere else it
  // brings its own box and its own title.
  if (!framed) return body;

  return (
    <Panel flush className="shrink-0 sm:min-h-0 sm:flex-1">
      {/* A plain title, the same h-10 the collection's header is: the two
          panels sit side by side, and a header that grew to fit its
          controls started this one's contents 35px below the other's. The
          controls live in the body instead, stacked, which is also what
          a 30%-wide column wants. */}
      <PanelHeader title={t('Online archives')} />
      {body}
    </Panel>
  );
}

function GameRow({
  game,
  onOpen,
  onPreview,
  actions,
  customName,
  renaming = false,
  onRename,
  showLink = true,
  onSwipeAway,
  onBookmark,
  bookmarked = false,
  onContext,
  menu,
}: {
  game: GameSummary;
  onOpen: () => void;
  onPreview: (preview: Preview | null) => void;
  /**
   * The row's secondary actions, folded into one ⋯.
   *
   * A sheet from the bottom on a phone, a popover under the ⋯ on a
   * desktop — the same ActionSheet the studies and notes shelves use. A
   * phone gets ONLY this: three 36px icon buttons standing permanently at
   * the end of a 390px row left the two player names about half the width
   * they need.
   */
  menu?: SheetAction[];
  actions: React.ReactNode;
  /** A user-chosen document name (in-game rename), shown instead of the matchup. */
  customName?: string | null;
  renaming?: boolean;
  onRename?: (to: string) => void;
  /** Collection rows fold the external link into their row menu. */
  showLink?: boolean;
  /** Touch: swiping the row's contents left removes it (undoably). */
  onSwipeAway?: () => void;
  /** Touch: swiping right marks it. Omitted where a row cannot be marked. */
  onBookmark?: () => void;
  bookmarked?: boolean;
  /** Desktop: a right-click asks for the row's actions at the pointer. */
  onContext?: (x: number, y: number) => void;
}) {
  // The eye pops the final position. Fine pointers hover a popover beside
  // the row; coarse pointers TAP for a centred overlay (dismissed by its
  // scrim) — a beside-row popover on a phone would cover the row itself.
  const swipe = useSwipeRow({ onRemove: () => onSwipeAway?.(), onBookmark });
  const coarse = isCoarsePointer;
  const row = useRef<HTMLLIElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const showPreviewAt = (rect: DOMRect, viaTap: boolean): void => {
    if (!game.finalFen) return;
    const top = Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200);
    onPreview({
      fen: game.finalFen,
      orientation: game.userSide ?? 'white',
      top,
      left: Math.max(rect.left - 192, 8),
      pinned: viaTap,
    });
  };
  const showPreview = (e: React.MouseEvent<Element>, viaTap = false): void => {
    if (!game.finalFen) return;
    if (!viaTap && coarse()) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const top = Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200);
    onPreview({
      fen: game.finalFen,
      orientation: game.userSide ?? 'white',
      top,
      left: Math.max(rect.left - 192, 8),
      pinned: viaTap,
    });
  };

  const hidePreview = (): void => onPreview(null);

  const openingLabel = game.opening
    ? `${game.opening.eco} ${game.opening.name}`
    : (game.eco ?? '');

  return (
    <li
      ref={row}
      onClick={onOpen}
      onContextMenu={
        onContext
          ? (e) => {
              e.preventDefault();
              onContext(e.clientX, e.clientY);
            }
          : undefined
      }
      {...(onSwipeAway ? swipe.handlers : {})}
      // flex-wrap, with a floor under the text: everything to the right of
      // the names — result, eye, Add, ⋯, link — is shrink-0 by necessity,
      // so in a narrow enough box they used to eat the text box down to
      // nothing and then overflow it. Now the text keeps 9rem and the
      // furniture drops to a line of its own instead. It costs a taller
      // row at widths the layout should never reach, which beats a row of
      // numbers printed on top of each other at widths it did.
      className={cn(
        'group hover:bg-surface-2 relative flex cursor-pointer flex-wrap items-center gap-3',
        'overflow-hidden px-3 py-2 transition-colors duration-100',
        // The whole indicator that a game is kept: a warm edge down the
        // left, which costs no width. The lit star that used to stand at
        // the end of the row cost about 36px of two player names on every
        // phone, to say what this says for nothing.
        //
        // Painted, not bordered. `divide-line` on the list sets
        // border-color on every child through `.divide-line > *`, which
        // outranks a plain `border-l-warn` on the row — the edge came out
        // the same grey as the hairlines between rows.
        bookmarked && 'before:bg-warn before:absolute before:inset-y-0 before:left-0 before:w-0.5',
      )}
    >
      {onSwipeAway && <SwipeTrack dx={swipe.dx} bookmarked={bookmarked} />}
      <div className="flex min-w-[8rem] flex-1 items-center gap-3" style={swipe.style}>
        {/* The name is asked for in a sheet, like every other rename; the
            row keeps showing what it is called meanwhile. */}
        {renaming && (
          <PromptSheet
            label={t('Rename this game')}
            initial={customName ?? docId(game)}
            onSubmit={(value) => onRename?.(value)}
            onClose={() => onRename?.('')}
          />
        )}
        <div className="min-w-0 flex-1">
          {customName ? (
            // A renamed game leads with its given name; the matchup joins
            // the detail line so nothing is lost.
            <p className="text-fg truncate text-sm font-semibold">
              {customName}
              {game.annotated && (
                <NotebookPen className="text-info ml-1.5 inline size-3" aria-label={t('Annotated')} />
              )}
            </p>
          ) : (
            // One line per player: names never fight each other for width,
            // so narrow screens truncate each side independently.
            <>
              {/* A flex row, not one inline run: with the rating inline
                  after the name, `truncate` on the line clipped whichever
                  came last — so an archive of long handles showed two
                  names and no ratings at all. The name is the only part
                  that gives way. */}
              <p className="text-fg flex items-baseline gap-1.5 text-sm">
                <SideDot side="white" className="shrink-0 translate-y-[-1px]" />
                <span
                  className={cn(
                    'min-w-0 truncate font-semibold',
                    game.userSide === 'white' && 'text-primary',
                  )}
                >
                  {game.white}
                </span>
                {game.whiteElo ? (
                  <span className="text-subtle shrink-0 text-xs tabular-nums">{game.whiteElo}</span>
                ) : null}
                {game.annotated && (
                  <NotebookPen className="text-info size-3 shrink-0" aria-label={t('Annotated')} />
                )}
              </p>
              <p className="text-fg flex items-baseline gap-1.5 text-sm">
                <SideDot side="black" className="shrink-0 translate-y-[-1px]" />
                <span
                  className={cn(
                    'min-w-0 truncate font-semibold',
                    game.userSide === 'black' && 'text-primary',
                  )}
                >
                  {game.black}
                </span>
                {game.blackElo ? (
                  <span className="text-subtle shrink-0 text-xs tabular-nums">{game.blackElo}</span>
                ) : null}
              </p>
            </>
          )}
          {/* The opening leads the detail line, because the code is what a
              long list is scanned by; the date and the clock follow it in
              the quietest colour on the row. */}
          <p className="text-subtle truncate text-xs" title={openingLabel}>
            {customName ? `${game.white} vs ${game.black} · ` : ''}
            {game.opening ? (
              <OpeningTag eco={game.opening.eco} name={game.opening.name} />
            ) : game.eco ? (
              <OpeningTag eco={game.eco} />
            ) : null}
            {(game.opening || game.eco) && ' · '}
            {game.date}
            {game.timeControl ? ` · ${formatTimeControl(game.timeControl)}` : ''}
          </p>
        </div>
        <ResultScore result={game.result} userSide={game.userSide} />
      </div>

      {/* One strip, not three loose icons: the eye used to sit inside the
          text block and the star and … outside it, so they read as three
          unrelated marks rather than as this row's controls. They share a
          tray now, which appears under the pointer and stays put on touch
          — the space is reserved either way, so nothing shifts. */}
      <div
        style={swipe.style}
        className={cn(
          // ml-auto so it stays against the right edge on the line it
          // wraps to, rather than following the text it left behind.
          'ml-auto flex shrink-0 items-center gap-0.5 rounded-lg p-0.5 transition-opacity duration-100',
          'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          'group-hover:bg-surface-3/70 pointer-coarse:opacity-100',
        )}
      >
        {/* Hidden on touch, where it lives in the ⋯ sheet instead: it is a
            HOVER affordance, and a phone cannot hover. */}
        {game.finalFen && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Preview the final position')}
            // Gone in a narrow list as well as on a phone. In the games
            // column it is 28px of hover convenience taken off the player
            // names, which are the row. 21.5rem is where the row stops
            // fitting with it: 8rem of text + the badge + the tray + the
            // link is 340px. `/arc` is the archive list's own container —
            // a query with no named container never matches, so this
            // reads as "always shown" everywhere else.
            className="shrink-0 pointer-coarse:hidden @max-[21.5rem]/arc:hidden"
            // Guarded like the other preview eyes: an unguarded mouseenter
            // trips iOS's sticky-hover heuristic (first tap hovers only).
            onMouseEnter={(e) => {
              if (!coarse()) showPreview(e);
            }}
            onMouseLeave={() => {
              if (!coarse()) hidePreview();
            }}
            // A hover preview goes when the mouse does; clicking pins it,
            // which is the difference between glancing at a position and
            // looking at one. It used to do nothing at all here — the
            // handler returned early on a fine pointer, and the click went
            // on to open the game.
            onClick={(e) => {
              e.stopPropagation();
              showPreview(e, true);
            }}
          >
            <Eye className="size-3.5" />
          </Button>
        )}
        {actions}
        {menu && menu.length > 0 && (
          <Button
            ref={menuTrigger}
            variant="ghost"
            size="icon-sm"
            title={t('Game actions')}
            active={menuOpen}
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(true);
            }}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        )}
      </div>

      {menuOpen && menu && (
        <ActionSheet
          title={customName ?? `${game.white} vs ${game.black}`}
          anchor={menuTrigger}
          onClose={() => setMenuOpen(false)}
          actions={[
            // The preview the eye gives a mouse, for a finger — and ONLY
            // for a finger: on a desktop the eye is on the row, two
            // centimetres from the ⋯ that opened this, and a menu that
            // repeats the icons beside it is a menu nobody reads. Anchored
            // to the row rather than to the ⋯, because by the time it
            // opens the sheet is gone and the row is what was being
            // looked at.
            ...(game.finalFen
              ? [
                  {
                    label: 'Preview the board',
                    icon: Eye,
                    className: 'pointer-fine:hidden',
                    onSelect: () => {
                      const rect = row.current?.getBoundingClientRect();
                      if (rect) showPreviewAt(rect, true);
                    },
                  },
                ]
              : []),
            ...menu,
          ]}
        />
      )}
      {/* Same container rule as the eye: in a narrow column this is 22px
          spent on a link out of the app, and the row it is taking them
          from is the reason anyone is looking. */}
      {showLink && !game.link && (
        <span className="w-[1.375rem] shrink-0 @max-[21.5rem]/arc:hidden" aria-hidden />
      )}
      {showLink && game.link && (
        <a
          href={game.link}
          target="_blank"
          rel="noreferrer"
          title={t('View on chess.com (needs internet)')}
          onClick={(e) => e.stopPropagation()}
          className="text-subtle hover:text-fg shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100 @max-[21.5rem]/arc:hidden"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </li>
  );
}

/**
 * Manual import: paste a PGN (or bare moves) and optionally stamp the
 * metadata headers — provided fields override what the paste carries.
 */
function ImportGamePanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [pgn, setPgn] = useState('');
  const [white, setWhite] = useState('');
  const [black, setBlack] = useState('');
  const [whiteElo, setWhiteElo] = useState('');
  const [blackElo, setBlackElo] = useState('');
  const [date, setDate] = useState('');
  const [event, setEvent] = useState('');
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pgnField = useRef<HTMLTextAreaElement>(null);

  /**
   * iOS scrolls a focused field into view by shoving the whole window,
   * which takes this window's header with it. Asking the field to centre
   * itself inside the window's own scroller means there is nothing left
   * for the browser to do.
   */
  const scrollFocusIntoView = (e: React.FocusEvent<HTMLElement>): void => {
    const field = e.currentTarget;
    setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /**
   * A pasted PGN already says who played, when, and how it ended — so the
   * fields fill themselves from its headers rather than asking for what is
   * sitting in the box above them. Only EMPTY fields are filled: anything
   * typed is the person's own answer and outranks the paste, which is the
   * rule submit() already applies when it writes the headers back.
   */
  const readHeaders = (text: string): void => {
    const header = (key: string): string => {
      const found = new RegExp('^\\[' + key + '\\s+"([^"]*)"\\]', 'm').exec(text);
      return found?.[1]?.trim() ?? '';
    };
    const fill = (value: string, current: string, set: (v: string) => void): void => {
      // "?" and "*" are PGN's own way of writing "unknown" — not answers.
      if (current.trim() || !value || value === '?' || value === '*') return;
      set(value);
    };
    fill(header('White'), white, setWhite);
    fill(header('Black'), black, setBlack);
    fill(header('WhiteElo'), whiteElo, setWhiteElo);
    fill(header('BlackElo'), blackElo, setBlackElo);
    fill(header('UTCDate') || header('Date'), date, setDate);
    fill(header('Event'), event, setEvent);
    const outcome = header('Result');
    if (!result && ['1-0', '0-1', '1/2-1/2'].includes(outcome)) setResult(outcome);
    if (text.includes('[White ') || text.includes('[Event ')) setDetailsOpen(true);
  };

  const submit = async (): Promise<void> => {
    const withHeader = (text: string, key: string, value: string): string => {
      if (!value.trim()) return text;
      const line = `[${key} "${value.trim().replace(/"/g, '')}"]`;
      const re = new RegExp(`^\\[${key}\\s+"[^"]*"\\]\\s*$`, 'm');
      return re.test(text) ? text.replace(re, line) : `${line}\n${text}`;
    };
    let text = pgn.trim();
    if (!text) return;
    // Bare moves get a header block; a full PGN gets its headers overridden.
    if (!text.startsWith('[')) text = `\n${text}`;
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
    text = withHeader(text, 'Result', result);
    text = withHeader(text, 'Event', event);
    text = withHeader(text, 'BlackElo', blackElo);
    text = withHeader(text, 'WhiteElo', whiteElo);
    text = withHeader(text, 'Date', date.trim() ? date.replaceAll('-', '.') : today);
    text = withHeader(text, 'Black', black.trim() || 'Black');
    text = withHeader(text, 'White', white.trim() || 'White');

    setBusy(true);
    setFailure(null);
    const res = await fetch('/api/games/collect-pgn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pgn: text }),
    });
    setBusy(false);
    if (res.ok) {
      onDone();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setFailure(t(body?.error ?? 'could not import that game'));
    }
  };

  return (
    <Modal
      title="Import a game"
      onClose={onCancel}
      full
      // Full screen on a phone; on a desktop a plain centred window of the
      // width a form of this shape wants — a 4xl sheet was mostly margin.
      className="sm:max-w-[37.5rem]"
    >
      <TextArea
        autoFocus={autoFocusField()}
        ref={pgnField}
        value={pgn}
        onChange={(e) => {
          setPgn(e.target.value);
          readHeaders(e.target.value);
        }}
        // The paste is read directly as well as through onChange: a paste
        // is the moment the headers arrive, and reading them here means
        // the fields are filled before the change has even settled.
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (text.includes('[')) readHeaders(text);
        }}
        onFocus={scrollFocusIntoView}
        rows={6}
        spellCheck={false}
        placeholder={t('Paste a PGN \u2014 or just moves: 1. e4 e5 2. Nf3 \u2026')}
        className="w-full resize-none font-mono placeholder:font-sans"
      />

      {/* Everything a pasted PGN already knows lives behind one line. It
          opens itself when a paste fills something in, so what was read
          off the text is seen rather than taken on trust. */}
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        className="text-subtle hover:text-fg flex items-center gap-1.5 self-start text-xs transition-colors duration-100"
      >
        <ChevronRight
          className={cn('size-3.5 transition-transform duration-150', detailsOpen && 'rotate-90')}
        />
        {t('Advanced details')}
      </button>

      {detailsOpen && (
        <div className="flex flex-col gap-2">
          {/* Paired left to right: the two players, their two ratings, then
              when and where — so each row answers one question twice. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              value={white}
              onChange={(e) => setWhite(e.target.value)}
              onFocus={scrollFocusIntoView}
              placeholder={t('White (optional)')}
            />
            <Input
              value={black}
              onChange={(e) => setBlack(e.target.value)}
              onFocus={scrollFocusIntoView}
              placeholder={t('Black (optional)')}
            />
            <Input
              value={whiteElo}
              onChange={(e) => setWhiteElo(e.target.value)}
              onFocus={scrollFocusIntoView}
              placeholder={t('White rating')}
              inputMode="numeric"
            />
            <Input
              value={blackElo}
              onChange={(e) => setBlackElo(e.target.value)}
              onFocus={scrollFocusIntoView}
              placeholder={t('Black rating')}
              inputMode="numeric"
            />
            <Input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onFocus={scrollFocusIntoView}
              placeholder={t('Date, e.g. 2026-08-08')}
            />
            <Input
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              onFocus={scrollFocusIntoView}
              placeholder={t('Event / tournament (optional)')}
            />
          </div>

          {/* Segmented, not a dropdown: four states, all visible at once.
              Auto is the default and stays quiet — a blue chip beside a
              blue Add button made the form look like it had two answers
              waiting. */}
          <div className="flex gap-1" role="radiogroup" aria-label={t('Result')}>
            {(
              [
                ['', 'Auto', 'Result from the pasted moves'],
                ['1-0', '1-0', 'White won'],
                ['0-1', '0-1', 'Black won'],
                ['1/2-1/2', '\u00bd-\u00bd', 'Draw'],
              ] as const
            ).map(([value, label, hint]) => (
              <Button
                key={value}
                size="sm"
                variant="secondary"
                active={result === value}
                title={t(hint)}
                className="min-w-0 flex-1 whitespace-nowrap px-0 font-mono"
                onClick={() => setResult(value)}
              >
                {t(label)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {failure && <p className="text-bad text-xs">{failure}</p>}

      {/* Sticky, so the keyboard cannot push the only way to submit off
          the bottom of a phone screen. */}
      <div className="bg-surface sticky bottom-0 -mb-1 flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={busy || !pgn.trim()} onClick={() => void submit()}>
          <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
          {t('Add to collection')}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * The result stacked one score per line, mirroring the player lines it
 * sits beside. The winner's digit carries the outcome colour from the
 * user's perspective (green won, red lost) and is bold either way, so
 * the signal isn't colour-only; games without a known side just
 * brighten the winner. This replaced the old leading result dot — same
 * information, no extra column.
 */
function ResultScore({
  result,
  userSide,
}: {
  result: string;
  userSide: 'white' | 'black' | null;
}) {
  const parts = result.split('-');
  const winner = result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;
  // Read at a glance, in one tag, instead of two faint characters stacked
  // in a 24px column: at that size neither the score nor which side got it
  // survived, and the pair read as one smudge down the side of the list.
  // Tinted from the player's own point of view where there is one — a win
  // and a loss are not the same fact, and the list is mostly their games.
  const tone =
    parts.length !== 2 || !winner
      ? 'bg-surface-3 text-muted'
      : !userSide
        ? 'bg-surface-3 text-fg'
        : userSide === winner
          ? 'bg-good/15 text-good'
          : 'bg-bad/15 text-bad';
  return (
    <span
      title={fmtResult(result)}
      className={cn(
        'w-11 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[0.6875rem] font-semibold',
        'tabular-nums leading-4',
        tone,
      )}
    >
      {fmtResult(result)}
    </span>
  );
}

/**
 * Which opening, as a code you can scan a list by.
 *
 * The ECO letter is the family — A flank, B semi-open, C open and French,
 * D closed, E Indian — so the badge takes its hue from the letter and the
 * same family is the same colour everywhere. That is the whole point of a
 * code in a list of two hundred games: you find the Sicilians by colour
 * before you have read a word.
 */
const ECO_HUE: Record<string, number> = { A: 285, B: 232, C: 195, D: 152, E: 65 };

function OpeningTag({ eco, name }: { eco: string; name?: string | null }) {
  const hue = ECO_HUE[eco[0]?.toUpperCase() ?? ''] ?? 264;
  return (
    <>
      <span
        className="mr-1.5 inline-block shrink-0 rounded px-1 py-px align-[1px] font-mono text-[0.625rem] font-semibold leading-4"
        style={{ color: `oklch(80% 0.08 ${hue})`, backgroundColor: `oklch(80% 0.08 ${hue} / 15%)` }}
      >
        {eco}
      </span>
      {name && <span style={{ color: `oklch(72% 0.045 ${hue})` }}>{name}</span>}
    </>
  );
}
