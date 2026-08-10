import {
  ChevronLeft,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  NotebookPen,
  Pencil,
  Plus,
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
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { StudyView } from '@/studies/StudyView';
import { Button } from '@/ui/Button';
import { ChipRow } from '@/ui/ChipRow';
import { FilterChip } from '@/ui/FilterChip';
import { Select } from '@/ui/Select';
import { Input, SearchInput, TextArea } from '@/ui/Input';
import { SideDot } from '@/ui/SideDot';
import { RowMenu } from '@/ui/RowMenu';
import { SkeletonListRows, useSlowLoad } from '@/ui/Skeleton';
import { Panel, PanelHeader } from '@/ui/Panel';

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
          <p className="text-fg mb-2 text-sm font-semibold">No reference games yet</p>
          <p className="text-muted text-xs leading-relaxed">
            Drop PGN collections (Lichess Elite months, TWIC, Lumbra exports) into
            vault/sources and index them once:
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
        <Button variant="ghost" size="icon-sm" title="Back to games" onClick={() => navigate('games')}>
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
        placeholder="Search players, openings, or ECO (e.g. Najdorf, B90)…"
        spellCheck={false}
        className="w-full shrink-0"
      />

      <Panel flush className="min-h-0 flex-1">
        <PanelHeader title={loading && rows.length === 0 ? 'Searching…' : `${total.toLocaleString()} games`} />
        {searching && <SkeletonListRows rows={8} action />}
        <ul className="divide-line min-h-0 flex-1 divide-y overflow-y-auto">
          {rows.map((g) => (
            <li key={g.id} className="flex items-center gap-3 pr-2">
              {/* Mirrors the collection's GameRow layout so the two lists
                  read as one family. */}
              <button
                type="button"
                onClick={() => void openGame(g)}
                title="Open on the analysis board"
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
                    aria-label="Preview the final position"
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
                  'Added'
                ) : (
                  <>
                    <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
                    Add
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
      setError('vault server unreachable');
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
      .catch(() => setError('vault server unreachable'));
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

  // Inline rename, like notes/studies: the doc id IS the file name.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
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
      setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'rename failed');
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
    const autoPrefix = `${g.white} vs ${g.black}`.replace(/[^A-Za-z0-9 _.-]/g, '').trim();
    return name.startsWith(autoPrefix) ? null : name;
  };

  const needle = query.trim().toLowerCase();
  const visible = games.filter((g) => {
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
        <h1 className="text-lg font-semibold tracking-tight">Games</h1>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            active={starredOnly}
            title={starredOnly ? 'Show all games' : 'Show bookmarked games only'}
            onClick={() => setStarredOnly((v) => !v)}
          >
            <Star className={cn('size-3.5', starredOnly && 'fill-current')} />
          </Button>
          <SearchInput
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search collection…"
            className="w-56 max-[500px]:w-auto max-[500px]:min-w-0 max-[500px]:flex-1"
          />
          <Button variant="primary" size="sm" active={importing} onClick={() => setImporting((v) => !v)}>
            <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
            Import
          </Button>
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
            title={`Collection · ${visible.length}`}
            actions={
              <Button
                variant="ghost"
                size="sm"
                title="Browse the indexed reference games"
                onClick={() => navigate('games', 'elite')}
              >
                <Trophy className="size-3.5" />
                Elite games
              </Button>
            }
          />
          {loaded && games.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <BookOpen className="text-subtle size-6" strokeWidth={1.5} />
              <p className="text-muted max-w-md text-sm leading-relaxed">
                Your collection is empty. It's meant to hold the games worth keeping — each one
                annotatable like a study. Browse your chess.com history below and add the ones
                you want to study.
              </p>
            </div>
          ) : (
          <ul className="divide-line min-h-0 divide-y overflow-y-auto sm:max-h-[38dvh]">
            {visible.map((game) => (
              <GameRow
                key={gameKey(game)}
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
                      title={bookmarks.has(gameKey(game)) ? 'Remove bookmark' : 'Bookmark'}
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
                      ariaLabel="Game actions"
                      triggerClassName="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100"
                      items={[
                        {
                          label: 'Rename',
                          icon: Pencil,
                          onSelect: () => setRenamingKey(gameKey(game)),
                        },
                        ...(game.link
                          ? [{ label: 'View online', icon: ExternalLink, href: game.link }]
                          : []),
                        {
                          label: 'Remove',
                          icon: Trash2,
                          confirm: 'Remove this game from the collection?',
                          onSelect: () => void removeGame(game),
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
        if (body.months[0]) await loadMonth(body.months[0].month);
      }
    } catch {
      setError('vault server unreachable');
    } finally {
      setLoading(null);
    }
  };

  const loadMonth = async (m: string): Promise<void> => {
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
      setError('vault server unreachable');
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
      setError('could not load that game');
    }
  };

  const [sideFilter, setSideFilter] = useState<'any' | 'white' | 'black'>('any');
  const [resultFilter, setResultFilter] = useState<'any' | '1-0' | '0-1' | '1/2-1/2'>('any');
  const visibleMonthGames = monthGames.filter(
    (g) =>
      (sideFilter === 'any' || g.userSide === sideFilter) &&
      (resultFilter === 'any' || g.result === resultFilter),
  );

  const switchProvider = (next: 'chesscom' | 'lichess'): void => {
    if (next === provider) return;
    setProvider(next);
    setMonths([]);
    setMonth('');
    setMonthGames([]);
    setError(null);
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
      setError(body?.error ?? 'could not add that game');
    }
  };

  return (
    <Panel flush className="shrink-0 sm:min-h-0 sm:flex-1">
      {/* Narrow screens can't fit tabs + username + Browse on one line;
          the band relaxes its fixed height and lets the actions wrap. */}
      <PanelHeader
        className="max-[560px]:h-auto max-[560px]:min-h-10 max-[560px]:flex-wrap max-[560px]:py-1.5"
        title={
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
                      <svg viewBox="4.5 5 36 36" className="size-3.5 fill-current" aria-hidden>
                        <path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18 Z M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10 Z" />
                      </svg>
                    )}
                    Browse {label}
                  </span>
                }
                active={provider === id}
                onClick={() => switchProvider(id)}
              />
            ))}
          </span>
        }
        actions={
          <>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && username.trim()) void loadMonths();
              }}
              placeholder={provider === 'chesscom' ? 'chess.com username' : 'Lichess username'}
              className="w-40 shrink-0 font-mono max-[560px]:w-auto max-[560px]:flex-1"
              inputSize="sm"
            />
            <Button
              variant="secondary"
              size="icon-sm"
              title="Browse this player's online archive"
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
        <ChipRow className="border-line border-t px-3 py-2">
          <Select
            value={month}
            onChange={(m) => void loadMonth(m)}
            ariaLabel="Archive month"
            size="sm"
            className="shrink-0"
            groups={[
              {
                options: months.map((m) => ({
                  value: m.month,
                  label: `${m.month}${m.cached ? ` · ${m.games} games` : offline ? ' · needs internet' : ''}`,
                })),
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
            <FilterChip key={id} label={label} active={sideFilter === id} onClick={() => setSideFilter(id)} />
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
            <FilterChip key={id} label={label} active={resultFilter === id} onClick={() => setResultFilter(id)} />
          ))}
        </ChipRow>
      )}
      {((offline && months.length > 0) || error) && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          {offline && months.length > 0 && (
            <span className="text-warn text-xs">offline — cached months only</span>
          )}
          {error && <span className="text-bad text-xs">{error}</span>}
        </div>
      )}

      {month && (
        <ul className="divide-line max-h-96 min-h-0 divide-y overflow-y-auto border-t border-line sm:max-h-none sm:flex-1">
          {loading === 'games' ? (
            // Rows, not a spinner on an empty box. Fetching a month used to
            // take the games away and leave one line of text where the list
            // had been, so the panel appeared to close and reopen.
            <li>
              <SkeletonListRows rows={6} action />
            </li>
          ) : (
            visibleMonthGames.map((game) => {
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
                        'Added'
                      ) : (
                        <>
                          <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
                          Add
                        </>
                      )}
                    </Button>
                  }
                />
              );
            })
          )}
        </ul>
      )}

      {/* Nothing browsed yet: fill the panel with a prompt instead of
          leaving a bare bar over blank space. */}
      {!month && loading !== 'months' && (
        <div className="border-line flex flex-col items-center justify-center gap-3 border-t px-6 py-14 text-center">
          <Globe className="text-subtle size-8" strokeWidth={1.5} />
          <p className="text-muted max-w-xs text-sm leading-relaxed">
            Browse your games. Type your {provider === 'chesscom' ? 'chess.com' : 'Lichess'} username
            above and pick a month — then add the ones worth keeping to your collection.
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
}) {
  // The eye pops the final position. Fine pointers hover a popover beside
  // the row; coarse pointers TAP for a centred overlay (dismissed by its
  // scrim) — a beside-row popover on a phone would cover the row itself.
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
      className="group hover:bg-surface-2 flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-100"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              inputSize="sm"
              defaultValue={customName ?? docId(game)}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => onRename?.(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') onRename?.('');
              }}
              className="w-full max-w-sm text-sm"
            />
          ) : customName ? (
            // A renamed game leads with its given name; the matchup joins
            // the detail line so nothing is lost.
            <p className="text-fg truncate text-sm font-medium">
              {customName}
              {game.annotated && (
                <NotebookPen className="text-info ml-1.5 inline size-3" aria-label="Annotated" />
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
                  <NotebookPen className="text-info ml-1.5 inline size-3" aria-label="Annotated" />
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
              aria-label="Preview the final position"
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
          title="View on chess.com (needs internet)"
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
      setFailure(body?.error ?? 'could not import that game');
    }
  };

  return (
    <>
      <div className="bg-scrim fixed inset-0 z-40" onClick={onCancel} />
      <div className="fixed inset-x-4 top-[8dvh] z-50 mx-auto max-h-[84dvh] max-w-lg overflow-y-auto rounded-xl">
    <Panel flush className="shrink-0">
      <PanelHeader title="Import a game" />
      <div className="flex flex-col gap-2 p-3">
        <TextArea
          autoFocus
          value={pgn}
          onChange={(e) => setPgn(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={'Paste a PGN \u2014 or just moves: 1. e4 e5 2. Nf3 \u2026'}
          className="w-full resize-none font-mono placeholder:font-sans"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Input value={white} onChange={(e) => setWhite(e.target.value)} placeholder="White (optional)" />
          <Input value={black} onChange={(e) => setBlack(e.target.value)} placeholder="Black (optional)" />
          <Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="Date, e.g. 2026-08-08" />
          <Input value={whiteElo} onChange={(e) => setWhiteElo(e.target.value)} placeholder="White rating" inputMode="numeric" />
          <Input value={blackElo} onChange={(e) => setBlackElo(e.target.value)} placeholder="Black rating" inputMode="numeric" />
          <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="Event / tournament (optional)" />
          {/* Segmented, not a dropdown: four states, all visible at once. */}
          <div className="flex gap-1" role="radiogroup" aria-label="Result">
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
                title={hint}
                className="min-w-0 flex-1 whitespace-nowrap px-0 font-mono"
                onClick={() => setResult(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        {failure && <p className="text-bad text-xs">{failure}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={busy || !pgn.trim()} onClick={() => void submit()}>
            <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
            Add to collection
          </Button>
        </div>
      </div>
    </Panel>
      </div>
    </>
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
