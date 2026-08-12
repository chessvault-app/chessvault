import {
  ChevronLeft,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Star,
  BookOpen,
  Trash2,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cachedCollection, forgetCollection, loadCollection } from './collection';
import { create } from 'zustand';
import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';
import { Board } from '@/board/Board';
import { sanitizeSegment } from '@shared/vaultNames';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { StudyView } from '@/studies/StudyView';
import { Button } from '@/ui/Button';
import { KnightIcon } from '@/ui/KnightIcon';
import { ChipRow } from '@/ui/ChipRow';
import { FilterChip } from '@/ui/FilterChip';
import { Select } from '@/ui/Select';
import { Input, SearchInput, TextArea } from '@/ui/Input';
import { SideDot } from '@/ui/SideDot';
import { RowMenu } from '@/ui/RowMenu';
import { SkeletonGameRows, useSlowLoad } from '@/ui/Skeleton';
import { Panel, PanelHeader } from '@/ui/Panel';
import { Modal } from '@/ui/Modal';
import { CreateControl } from '@/ui/Fab';
import { SwipeTrack, useSwipeAway } from '@/ui/SwipeRow';
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
}
const useArchiveBrowse = create<ArchiveBrowseState>(() => ({
  provider: 'chesscom',
  username: localStorage.getItem('chess-vault:chesscom-user') ?? '',
  months: [],
  offline: false,
  month: '',
  monthGames: [],
}));

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
  if (params[0] === 'elite') return <EliteBrowser />;
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
 */
function EliteBrowser() {
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
      <div className="grid h-full place-items-center p-8">
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

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-3xl flex-col gap-3 p-4">
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" title={t('Back to games')} onClick={() => navigate('games')}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
          Elite games{meta?.games ? ` (${meta.games.toLocaleString()} games)` : ''}
        </h1>
      </div>

      <SearchInput
        inputSize="lg"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('Search players, openings, or ECO (e.g. Najdorf, B90)…')}
        spellCheck={false}
        className="w-full shrink-0"
      />

      <Panel flush className="min-h-0 flex-1">
        <PanelHeader title={loading && rows.length === 0 ? t('Searching…') : t('{n} games', { n: total.toLocaleString() })} />
        {searching && <SkeletonGameRows rows={8} />}
        <ul className="divide-line min-h-0 flex-1 divide-y overflow-y-auto">
          {rows.map((g) => (
            <li key={g.id} className="flex items-center gap-3 pr-2">
              {/* Mirrors the collection's GameRow layout so the two lists
                  read as one family. */}
              <button
                type="button"
                onClick={() => void openGame(g)}
                title={t('Open on the analysis board')}
                className="hover:bg-surface-2 flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition-colors duration-100"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="white" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-medium">{g.white}</span>{' '}
                    <span className="text-subtle text-xs">{g.white_elo}</span>
                  </span>
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="black" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-medium">{g.black}</span>{' '}
                    <span className="text-subtle text-xs">{g.black_elo}</span>
                  </span>
                  <span className="text-subtle block truncate text-xs">
                    {g.date ?? ''}
                    {g.eco || g.opening ? ` · ${g.eco ?? ''} ${g.opening ?? ''}` : ''}
                  </span>
                </span>
                <span className="grid size-7 shrink-0 place-items-center">
                  <Eye
                    className="text-subtle hover:text-fg size-3.5 pointer-coarse:size-4.5"
                    aria-label={t('Preview the final position')}
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
                  />
                </span>
                <ResultScore result={g.result} userSide={null} />
              </button>
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
      </Panel>
      <GamePreview preview={preview} onClose={hidePreview} />
    </div>
  );
}

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
  const [starredOnly, setStarredOnly] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importing, setImporting] = useState(false);

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
    return name.startsWith(autoPrefix) ? null : name;
  };

  const needle = query.trim().toLowerCase();
  const visible = games.filter((g) => {
    if (hidden.has(gameKey(g))) return false;
    if (starredOnly && !bookmarks.has(gameKey(g))) return false;
    if (!needle) return true;
    return `${customName(g) ?? ''} ${g.white} ${g.black} ${g.eco ?? ''} ${g.opening?.name ?? ''} ${g.date}`
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 scrollbar-hidden sm:overflow-hidden lg:p-6">
      {/* flex-wrap + the search field's narrow flex-1: phones drop the
          controls onto their own full-width line instead of clipping. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{t('Games')}</h1>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            active={starredOnly}
            title={starredOnly ? t('Show all games') : t('Show bookmarked games only')}
            onClick={() => setStarredOnly((v) => !v)}
          >
            <Star className={cn('size-3.5', starredOnly && 'fill-current')} />
          </Button>
          <SearchInput
            type="text"
            inputSize="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search collection…')}
            className="w-56 max-[500px]:w-auto max-[500px]:min-w-0 max-[500px]:flex-1"
          />
          <CreateControl
            label="Import"
            actions={[{ label: 'Import a game', icon: Plus, onSelect: () => setImporting(true) }]}
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

      {/* The collection panel is ALWAYS there — an empty collection shows its
          placeholder inside the box, the same way the browser box below holds
          its own idle prompt. */}
      {
        // shrink-0: loading an archive month below must not squeeze this
        // panel — the page column scrolls instead.
        <Panel flush className="shrink-0 sm:min-h-0">
          <PanelHeader
            title={`${t('Collection')} · ${visible.length}`}
            actions={
              <Button
                variant="ghost"
                size="sm"
                title={t('Browse the indexed reference games')}
                onClick={() => navigate('games', 'elite')}
              >
                <Trophy className="size-3.5" />
                {t('Elite games')}
              </Button>
            }
          />
          {loaded && games.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <BookOpen className="text-subtle size-6" strokeWidth={1.5} />
              <p className="text-muted max-w-md text-sm leading-relaxed">
                {t(
                  "Your collection is empty. It's meant to hold the games worth keeping — each one annotatable like a study. Browse your chess.com history below and add the ones you want to study.",
                )}
              </p>
            </div>
          ) : loaded && visible.length === 0 ? (
            /* The collection HAS games; this search or the bookmark toggle
               just matches none of them. Saying so beats a box with nothing
               under its header, which reads as the collection having been
               emptied. */
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              {starredOnly && !needle ? (
                <>
                  <Star className="text-subtle size-6" strokeWidth={1.5} />
                  <p className="text-muted max-w-md text-sm leading-relaxed">
                    {t('No bookmarked games yet — the star on a row keeps it here.')}
                  </p>
                </>
              ) : (
                <>
                  <Search className="text-subtle size-6" strokeWidth={1.5} />
                  <p className="text-muted max-w-md text-sm leading-relaxed">
                    {starredOnly
                      ? t('No bookmarked game matches “{query}”.', { query: query.trim() })
                      : t('No game in your collection matches “{query}”.', { query: query.trim() })}
                  </p>
                </>
              )}
            </div>
          ) : (
          <ul className="divide-line min-h-0 divide-y overflow-y-auto sm:max-h-[38dvh]">
            {visible.map((game) => (
              <GameRow
                key={gameKey(game)}
                onSwipeAway={() => dropGame(game)}
                game={game}
                customName={customName(game)}
                renaming={renamingKey === gameKey(game)}
                onRename={(to) => void renameGame(game, to)}
                onOpen={() => openGame(game)}
                onPreview={setPreview}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={bookmarks.has(gameKey(game)) ? t('Remove bookmark') : t('Bookmark')}
                      className="shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleBookmark(game);
                      }}
                    >
                      <Star
                        className={cn(
                          'size-3.5',
                          bookmarks.has(gameKey(game)) && 'fill-warn text-warn',
                        )}
                      />
                    </Button>
                    {/* The … menu closes the line (lanph3re's call). */}
                    <RowMenu
                      ariaLabel={t('Game actions')}
                      triggerClassName="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100"
                      items={[
                        {
                          label: t('Rename'),
                          icon: Pencil,
                          onSelect: () => setRenamingKey(gameKey(game)),
                        },
                        ...(game.link
                          ? [{ label: 'View online', icon: ExternalLink, href: game.link }]
                          : []),
                        {
                          label: t('Remove'),
                          icon: Trash2,
                          onSelect: () => dropGame(game),
                        },
                      ]}
                    />
                  </>
                }
                showLink={false}
              />
            ))}
          </ul>
          )}
        </Panel>
      }

      <ArchiveBrowser collectionKeys={new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`))} onCollected={() => void load()} onPreview={setPreview} />

      <GamePreview preview={preview} onClose={() => setPreview(null)} />

      {undoable.pending && <UndoBar label={undoable.pending.label} onUndo={undoable.undo} />}
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
}: {
  collectionKeys: Set<string>;
  onCollected: () => void;
  onPreview: (p: Preview | null) => void;
}) {
  // Browse state persists across remounts (see useArchiveBrowse); setters
  // mirror the useState API so the call sites below are unchanged.
  const { provider, username, months, offline, month, monthGames } = useArchiveBrowse();
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

  const loadMonths = async (): Promise<void> => {
    const user = username.trim();
    if (!user) return;
    localStorage.setItem('chess-vault:chesscom-user', user);
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
        // All dates, not the newest month: the question people open this
        // page with is "have I played this before", which one month cannot
        // answer. Months are cached server-side after the first pass, and
        // the counter below the list has a Stop while it runs.
        if (body.months.length) await loadAllMonths(body.months);
      }
    } catch {
      setError(t('vault server unreachable'));
    } finally {
      setLoading(null);
    }
  };

  /**
   * Every month at once.
   *
   * Newest first, so the list opens on recent play; each month is fetched
   * in turn and the server caches it, so a second visit is instant. The
   * count climbs as they arrive rather than showing nothing for a minute —
   * a decade is dozens of requests.
   */
  const loadAllMonths = async (list: ArchiveMonth[] = months): Promise<void> => {
    setMonth(ALL_MONTHS);
    setError(null);
    stopRef.current = false;
    const user = username.trim();
    // Taken as an argument because the first call happens in the same tick
    // as setMonths(): reading `months` there would find the previous list.
    const newestFirst = list.map((m) => m.month).sort().reverse();
    const all: GameSummary[] = [];
    for (const [at, m] of newestFirst.entries()) {
      if (stopRef.current) break;
      setBulk({ month: at + 1, months: newestFirst.length, added: all.length });
      try {
        const res = await fetch(`${apiBase}/month?user=${encodeURIComponent(user)}&month=${m}`);
        if (!res.ok) continue;
        const body = (await res.json()) as { games?: GameSummary[] };
        all.push(...(body.games ?? []).slice().reverse());
        setMonthGames([...all]);
      } catch {
        // One unreachable month should not lose the rest of a decade.
      }
    }
    setBulk(null);
  };

  const loadMonth = async (m: string): Promise<void> => {
    if (m === ALL_MONTHS) return loadAllMonths();
    setMonth(m);
    setLoading('games');
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/month?user=${encodeURIComponent(username.trim())}&month=${m}`,
      );
      const body = (await res.json()) as { games: GameSummary[] } | { error: string };
      if ('error' in body) setError(body.error);
      else setMonthGames(body.games.slice().reverse()); // newest first
    } catch {
      setError(t('vault server unreachable'));
    } finally {
      setLoading(null);
    }
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
  const [bulk, setBulk] = useState<{ month: number; months: number; added: number } | null>(null);
  const stopRef = useRef(false);
  const [busy, setBusy] = useState(false);
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
      setBulk({ month: byFile.size - [...byFile.keys()].indexOf(file), months: byFile.size, added: done.length });
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

    setBulk(null);
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

  return (
    <Panel flush className="shrink-0 sm:min-h-0 sm:flex-1">
      {/* Narrow screens can't fit tabs + username + Browse on one line;
          the band relaxes its fixed height and lets the actions wrap. */}
      <PanelHeader
        className="max-[560px]:h-auto max-[560px]:min-h-10 max-[560px]:flex-wrap max-[560px]:py-1.5"
        title={
          /* The two provider chips stay on one line together — they are the
             choice being made. What moves to a second line on a narrow
             screen is the username field below them (actionsClassName). */
          <span className="flex items-center gap-1 normal-case tracking-normal">
            {(
              [
                ['chesscom', 'chess.com'],
                ['lichess', 'Lichess'],
              ] as const
            ).map(([id, label]) => (
              <FilterChip
                key={id}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {id === 'chesscom' ? (
                      /* chess.com's pawn, in its brand green */
                      <svg viewBox="5 4.5 35 37" className="size-3.5" fill="#7fa650" aria-hidden>
                        <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" />
                      </svg>
                    ) : (
                      /* lichess's knight mark */
                      <KnightIcon className="size-3.5 fill-current" />
                    )}
                    {t('Browse {site}', { site: label })}
                  </span>
                }
                active={provider === id}
                onClick={() => switchProvider(id)}
              />
            ))}
          </span>
        }
        actionsClassName="max-[560px]:w-full max-[560px]:justify-start"
        actions={
          <>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && username.trim()) void loadMonths();
              }}
              placeholder={
                provider === 'chesscom' ? t('chess.com username') : t('Lichess username')
              }
              className="w-40 shrink-0 font-mono max-[560px]:w-auto max-[560px]:flex-1"
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
          </>
        }
      />

      {/* Second row, only once an archive is loaded: month + quick filters. */}
      {months.length > 0 && (
        <div ref={archiveTop}>
        <ChipRow className="border-line border-t px-3 py-2">
          <Select
            value={month}
            onChange={(m) => void loadMonth(m)}
            ariaLabel={t('Archive month')}
            size="sm"
            className="shrink-0"
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
                  })),
                ],
              },
            ]}
          />
          <span className="bg-line mx-1 h-4 w-px" />
          {(
            [
              ['any', 'Any'],
              ['white', 'White'],
              ['black', 'Black'],
            ] as const
          ).map(([id, label]) => (
            <FilterChip key={id} label={t(label)} active={sideFilter === id} onClick={() => setSideFilter(id)} />
          ))}
          <span className="bg-line mx-1 h-4 w-px" />
          {(
            [
              ['any', 'All'],
              ['1-0', '1-0'],
              ['0-1', '0-1'],
              ['1/2-1/2', '½-½'],
            ] as const
          ).map(([id, label]) => (
            <FilterChip key={id} label={t(label)} active={resultFilter === id} onClick={() => setResultFilter(id)} />
          ))}
        </ChipRow>
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

      {month && visibleMonthGames.length > 0 && loading !== 'games' && (
        <div className="border-line flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs">
          {!selecting ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={pickable.length === 0 || bulk !== null}
                onClick={() => setSelecting(true)}
              >
                {t('Select…')}
              </Button>
              {bulk && (
                <>
                  <span className="text-muted tabular-nums">
                    {t('Month {at} of {total} · {added} added', {
                      at: bulk.month,
                      total: bulk.months,
                      added: bulk.added,
                    })}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => (stopRef.current = true)}>
                    {t('Stop')}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-primary"
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
                <span className="text-muted">{t('Select all new')}</span>
              </label>
              <span className="text-subtle tabular-nums">
                {t('{n} selected', { n: picked.size })}
              </span>
              <Button
                variant="primary"
                size="sm"
                disabled={picked.size === 0}
                onClick={() => void collectMany(pickable.filter((g) => picked.has(gameKey(g))))}
              >
                {busy ? t('Adding…') : t('Add selected')}
              </Button>
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
            </>
          )}
        </div>
      )}

      {month && (
        <ul className="divide-line max-h-96 min-h-0 divide-y overflow-y-auto border-t border-line sm:max-h-none sm:flex-1">
          {loading === 'games' ? (
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
        </ul>
      )}

      {month && visibleMonthGames.length > MAX_ROWS && (
        <p className="text-subtle border-line border-t px-3 py-1.5 text-xs">
          {t('Showing the first {shown} of {total}. Select all new still takes every one.', {
            shown: MAX_ROWS,
            total: visibleMonthGames.length,
          })}
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
          <Globe className="text-subtle size-8" strokeWidth={1.5} />
          <p className="text-muted max-w-xs text-sm leading-relaxed">
            {t(
              'Browse your games. Type your {site} username above and pick a month — then add the ones worth keeping to your collection.',
              { site: provider === 'chesscom' ? 'chess.com' : 'Lichess' },
            )}
          </p>
        </div>
      )}
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
}: {
  game: GameSummary;
  onOpen: () => void;
  onPreview: (preview: Preview | null) => void;
  actions: React.ReactNode;
  /** A user-chosen document name (in-game rename), shown instead of the matchup. */
  customName?: string | null;
  renaming?: boolean;
  onRename?: (to: string) => void;
  /** Collection rows fold the external link into their row menu. */
  showLink?: boolean;
  /** Touch: swiping the row's contents left removes it (undoably). */
  onSwipeAway?: () => void;
}) {
  // The eye pops the final position. Fine pointers hover a popover beside
  // the row; coarse pointers TAP for a centred overlay (dismissed by its
  // scrim) — a beside-row popover on a phone would cover the row itself.
  const swipe = useSwipeAway(() => onSwipeAway?.());
  const coarse = isCoarsePointer;
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
      onClick={onOpen}
      {...(onSwipeAway ? swipe.handlers : {})}
      className="group hover:bg-surface-2 relative flex cursor-pointer items-center gap-3 overflow-hidden px-3 py-2 transition-colors duration-100"
    >
      {onSwipeAway && <SwipeTrack dx={swipe.dx} />}
      <div className="flex min-w-0 flex-1 items-center gap-3" style={swipe.style}>
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
            <p className="text-fg truncate text-sm font-medium">
              {customName}
              {game.annotated && (
                <NotebookPen className="text-info ml-1.5 inline size-3" aria-label={t('Annotated')} />
              )}
            </p>
          ) : (
            // One line per player: names never fight each other for width,
            // so narrow screens truncate each side independently.
            <>
              <p className="text-fg truncate text-sm">
                <SideDot side="white" className="mr-1.5 inline-block align-[-1px]" />
                <span className={cn('font-medium', game.userSide === 'white' && 'text-primary')}>
                  {game.white}
                </span>
                {game.whiteElo ? <span className="text-subtle text-xs"> {game.whiteElo}</span> : null}
                {game.annotated && (
                  <NotebookPen className="text-info ml-1.5 inline size-3" aria-label={t('Annotated')} />
                )}
              </p>
              <p className="text-fg truncate text-sm">
                <SideDot side="black" className="mr-1.5 inline-block align-[-1px]" />
                <span className={cn('font-medium', game.userSide === 'black' && 'text-primary')}>
                  {game.black}
                </span>
                {game.blackElo ? <span className="text-subtle text-xs"> {game.blackElo}</span> : null}
              </p>
            </>
          )}
          <p className="text-subtle truncate text-xs" title={openingLabel}>
            {customName ? `${game.white} vs ${game.black} · ` : ''}
            {game.date}
            {openingLabel ? ` · ${openingLabel}` : ''}
            {game.timeControl ? ` · ${formatTimeControl(game.timeControl)}` : ''}
          </p>
        </div>
        <ResultScore result={game.result} userSide={game.userSide} />
        {/* The eye borrows the icon-sm footprint so the gaps to the star
            and … buttons read evenly. */}
        {game.finalFen ? (
          <span className="grid size-7 shrink-0 place-items-center pointer-coarse:size-9">
            <Eye
              className="text-subtle hover:text-fg size-3.5 pointer-coarse:size-5"
              aria-label={t('Preview the final position')}
              // Guarded like the other preview eyes: an unguarded mouseenter
              // trips iOS's sticky-hover heuristic (first tap hovers only).
              onMouseEnter={(e) => {
                if (!coarse()) showPreview(e);
              }}
              onMouseLeave={() => {
                if (!coarse()) hidePreview();
              }}
              onClick={(e) => {
                if (!coarse()) return;
                // Touch: open the centred overlay; its scrim dismisses it.
                e.stopPropagation();
                showPreview(e, true);
              }}
            />
          </span>
        ) : (
          <span className="size-7 shrink-0 pointer-coarse:size-9" aria-hidden />
        )}
      </div>
      {actions}
      {showLink && !game.link && <span className="w-[1.375rem] shrink-0" aria-hidden />}
      {showLink && game.link && (
        <a
          href={game.link}
          target="_blank"
          rel="noreferrer"
          title={t('View on chess.com (needs internet)')}
          onClick={(e) => e.stopPropagation()}
          className="text-subtle hover:text-fg shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100"
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
    <Modal title="Import a game" onClose={onCancel} full>
      <TextArea
        autoFocus
        value={pgn}
        onChange={(e) => {
          setPgn(e.target.value);
          readHeaders(e.target.value);
        }}
        rows={5}
        spellCheck={false}
        placeholder={t('Paste a PGN \u2014 or just moves: 1. e4 e5 2. Nf3 \u2026')}
        className="w-full resize-none font-mono placeholder:font-sans"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Input value={white} onChange={(e) => setWhite(e.target.value)} placeholder={t('White (optional)')} />
        <Input value={black} onChange={(e) => setBlack(e.target.value)} placeholder={t('Black (optional)')} />
        <Input value={date} onChange={(e) => setDate(e.target.value)} placeholder={t('Date, e.g. 2026-08-08')} />
        <Input value={whiteElo} onChange={(e) => setWhiteElo(e.target.value)} placeholder={t('White rating')} inputMode="numeric" />
        <Input value={blackElo} onChange={(e) => setBlackElo(e.target.value)} placeholder={t('Black rating')} inputMode="numeric" />
        <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder={t('Event / tournament (optional)')} />
        {/* Segmented, not a dropdown: four states, all visible at once. */}
        <div className="flex gap-1" role="radiogroup" aria-label={t('Result')}>
          {(
            [
              ['', 'Auto', 'Result from the pasted moves'],
              ['1-0', '1-0', 'White won'],
              ['0-1', '0-1', 'Black won'],
              ['1/2-1/2', '½-½', 'Draw'],
            ] as const
          ).map(([value, label, hint]) => (
            <Button
              key={value}
              size="sm"
              variant={result === value ? 'primary' : 'secondary'}
              title={t(hint)}
              className="min-w-0 flex-1 whitespace-nowrap px-0 font-mono"
              onClick={() => setResult(value)}
            >
              {t(label)}
            </Button>
          ))}
        </div>
      </div>
      {failure && <p className="text-bad text-xs">{failure}</p>}
      <div className="flex justify-end gap-2">
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
  if (parts.length !== 2) {
    return (
      <span title={result} className="text-muted w-6 shrink-0 text-center font-mono text-xs">
        {result}
      </span>
    );
  }
  const winner = result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;
  const cls = (side: 'white' | 'black'): string => {
    if (side !== winner) return 'text-muted';
    if (!userSide) return 'text-fg font-semibold';
    return cn('font-semibold', userSide === winner ? 'text-good' : 'text-bad');
  };
  return (
    <span title={fmtResult(result)} className="w-6 shrink-0 text-center font-mono text-xs leading-5">
      <span className={cn('block', cls('white'))}>{fmtResult(parts[0]!)}</span>
      <span className={cn('block', cls('black'))}>{fmtResult(parts[1]!)}</span>
    </span>
  );
}
