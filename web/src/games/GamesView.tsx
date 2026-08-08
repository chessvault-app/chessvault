import {
  ArrowLeft,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  NotebookPen,
  Plus,
  Star,
  Swords,
  Trash2,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Board } from '@/board/Board';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { StudyView } from '@/studies/StudyView';
import { Button } from '@/ui/Button';
import { ConfirmPopover } from '@/ui/ConfirmPopover';
import { FilterChip } from '@/ui/FilterChip';
import { Select } from '@/ui/Select';
import { Input, SearchInput, TextArea } from '@/ui/Input';
import { SideDot } from '@/ui/SideDot';
import { SkeletonRows } from '@/ui/Skeleton';
import { Panel, PanelHeader } from '@/ui/Panel';

interface GameSummary {
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

const gameKey = (g: Pick<GameSummary, 'file' | 'index'>): string => `${g.file}#${g.index}`;

/** PGN results with the proper half glyph: 1/2-1/2 → ½-½. */
const fmtResult = (result: string): string => result.replaceAll('1/2', '½');

interface Preview {
  fen: string;
  orientation: 'white' | 'black';
  top: number;
  left: number;
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
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string, offset: number) => {
    setLoading(true);
    const res = await fetch(
      `/api/refgames/search?q=${encodeURIComponent(q)}&offset=${offset}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { total: number; rows: RefGame[] };
      setTotal(data.total);
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
    void fetch('/api/games')
      .then((r) => r.json() as Promise<{ games: GameSummary[] }>)
      .then((d) => setCollectionKeys(new Set(d.games.map((g) => `${g.white}|${g.black}|${g.date}`))))
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
    if (posted.ok || posted.status === 409) setAdded((prev) => new Set(prev).add(game.id));
  };

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
          <ArrowLeft className="size-3.5" />
        </Button>
        <h1 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
          Elite games{meta?.games ? ` · ${meta.games.toLocaleString()}` : ''}
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
        {loading && rows.length === 0 && <SkeletonRows rows={8} />}
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
                <ResultDot result={g.result} userSide={null} />
                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="white" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-medium">{g.white}</span>{' '}
                    <span className="text-subtle text-xs">{g.white_elo}</span>
                    <span className="text-subtle"> vs </span>
                    <SideDot side="black" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-medium">{g.black}</span>{' '}
                    <span className="text-subtle text-xs">{g.black_elo}</span>
                  </span>
                  <span className="text-subtle block truncate text-xs">
                    {g.date ?? ''}
                    {g.eco || g.opening ? ` · ${g.eco ?? ''} ${g.opening ?? ''}` : ''}
                  </span>
                </span>
                <span className="text-muted w-12 shrink-0 text-right font-mono text-xs">
                  {fmtResult(g.result)}
                </span>
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
                    <Plus className="mr-1 size-3.5" />
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

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/games');
      const body = (await res.json()) as { games: GameSummary[] };
      setGames(body.games);
      setLoaded(true);
    } catch {
      setError('vault server unreachable');
    }
  }, []);

  useEffect(() => {
    void load();
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

  const removeGame = async (game: GameSummary): Promise<void> => {
    const id = game.file.replace(/^collection\//, '').replace(/\.pgn$/, '');
    await fetch(`/api/games/docs/${encodeURIComponent(id)}`, { method: 'DELETE' });
    void load();
  };

  const openGame = (game: GameSummary): void => {
    const id = game.file.replace(/^collection\//, '').replace(/\.pgn$/, '');
    navigate('games', encodeURIComponent(id));
  };

  // A rename in the open-game view changes the document's file name; when
  // it no longer matches the auto "White vs Black date" pattern, that name
  // IS the title the user chose — lead with it.
  const customName = (g: GameSummary): string | null => {
    const name = g.file.replace(/^collection\//, '').replace(/\.pgn$/, '');
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
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Games</h1>
        <div className="flex items-center gap-2">
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
            className="w-56"
          />
          <Button variant="primary" size="sm" active={importing} onClick={() => setImporting((v) => !v)}>
            <Plus className="mr-1 size-3.5" />
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
        />
      )}

      {error && <p className="text-bad text-xs">{error}</p>}

      {loaded && games.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Swords className="text-subtle size-6" strokeWidth={1.5} />
          <p className="text-muted max-w-md text-sm leading-relaxed">
            Your collection is empty. It's meant to hold the games worth keeping — each one
            annotatable like a study. Browse your chess.com history below and add the ones
            you want to study.
          </p>
        </div>
      ) : (
        <Panel flush>
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
          <ul className="divide-line min-h-0 divide-y overflow-y-auto">
            {visible.map((game) => (
              <GameRow
                key={gameKey(game)}
                game={game}
                customName={customName(game)}
                onOpen={() => openGame(game)}
                onPreview={setPreview}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={bookmarks.has(gameKey(game)) ? 'Remove bookmark' : 'Bookmark'}
                      className={cn(
                        'shrink-0',
                        !bookmarks.has(gameKey(game)) &&
                          'opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100',
                      )}
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
                    <ConfirmPopover
                      icon={Trash2}
                      triggerTitle="Remove from the collection"
                      triggerClassName="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100"
                      question="Remove this game from the collection?"
                      confirmLabel="Remove"
                      onConfirm={() => void removeGame(game)}
                    />
                  </>
                }
              />
            ))}
          </ul>
        </Panel>
      )}

      <ArchiveBrowser collectionKeys={new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`))} onCollected={() => void load()} onPreview={setPreview} />

      {preview && (
        <div
          style={{ top: preview.top, left: preview.left }}
          className={cn(
            'border-line bg-surface pointer-events-none fixed z-50 w-44 rounded-lg border p-1',
            'shadow-[var(--shadow-pop)]',
          )}
        >
          <Board fen={preview.fen} orientation={preview.orientation} viewOnly coordinates={false} className="rounded" />
        </div>
      )}
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
  const [username, setUsername] = useState(() => localStorage.getItem('chess-vault:chesscom-user') ?? '');
  const [provider, setProvider] = useState<'chesscom' | 'lichess'>('chesscom');
  const apiBase = provider === 'chesscom' ? '/api/games/archive' : '/api/games/lichess';
  const [months, setMonths] = useState<ArchiveMonth[]>([]);
  const [offline, setOffline] = useState(false);
  const [month, setMonth] = useState('');
  const [monthGames, setMonthGames] = useState<GameSummary[]>([]);
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
    <Panel flush>
      <PanelHeader
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
                label={`Browse ${label}`}
                active={provider === id}
                onClick={() => switchProvider(id)}
              />
            ))}
          </span>
        }
        actions={
          months.length > 0 ? (
            <Select
              value={month}
              onChange={(m) => void loadMonth(m)}
              ariaLabel="Archive month"
              size="sm"
              align="end"
              groups={[
                {
                  options: months.map((m) => ({
                    value: m.month,
                    label: `${m.month}${m.cached ? ` · ${m.games} saved` : offline ? ' · needs internet' : ''}`,
                  })),
                },
              ]}
            />
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <Download className="text-subtle size-4 shrink-0" />
        <Input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && username.trim()) void loadMonths();
          }}
          placeholder={provider === 'chesscom' ? 'chess.com username' : 'Lichess username'}
          className="w-48 font-mono"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={loading !== null || !username.trim()}
          onClick={() => void loadMonths()}
        >
          {loading === 'months' ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
          Browse
        </Button>
        {offline && months.length > 0 && (
          <span className="text-warn text-xs">offline — cached months only</span>
        )}
        {error && <span className="text-bad text-xs">{error}</span>}
      </div>

      {month && (
        <ul className="divide-line max-h-96 min-h-0 divide-y overflow-y-auto border-t border-line">
          {loading === 'games' ? (
            <li className="text-subtle flex items-center gap-2 px-3 py-3 text-xs">
              <Loader2 className="size-3.5 animate-spin" /> fetching {month}…
            </li>
          ) : (
            monthGames.map((game) => {
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
                          <Plus className="mr-1 size-3.5" />
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
    </Panel>
  );
}

function GameRow({
  game,
  onOpen,
  onPreview,
  actions,
  customName,
}: {
  game: GameSummary;
  onOpen: () => void;
  onPreview: (preview: Preview | null) => void;
  actions: React.ReactNode;
  /** A user-chosen document name (in-game rename), shown instead of the matchup. */
  customName?: string | null;
}) {
  // The eye pops the final position beside the row — an explicit target
  // (matching the dashboard's puzzle previews) instead of the old
  // whole-row hover. Touch devices have no hover, so nothing fires there.
  const showPreview = (e: React.MouseEvent<Element>): void => {
    if (!game.finalFen) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const top = Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200);
    onPreview({
      fen: game.finalFen,
      orientation: game.userSide ?? 'white',
      top,
      left: Math.max(rect.left - 192, 8),
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
        <ResultDot result={game.result} userSide={game.userSide} />
        <div className="min-w-0 flex-1">
          {customName ? (
            // A renamed game leads with its given name; the matchup joins
            // the detail line so nothing is lost.
            <p className="text-fg truncate text-sm font-medium">
              {customName}
              {game.annotated && (
                <NotebookPen className="text-info ml-1.5 inline size-3" aria-label="Annotated" />
              )}
            </p>
          ) : (
            <p className="text-fg truncate text-sm">
              <SideDot side="white" className="mr-1.5 inline-block align-[-1px]" />
              <span className={cn('font-medium', game.userSide === 'white' && 'text-primary')}>
                {game.white}
              </span>
              {game.whiteElo ? <span className="text-subtle text-xs"> {game.whiteElo}</span> : null}
              <span className="text-subtle"> vs </span>
              <SideDot side="black" className="mr-1.5 inline-block align-[-1px]" />
              <span className={cn('font-medium', game.userSide === 'black' && 'text-primary')}>
                {game.black}
              </span>
              {game.blackElo ? <span className="text-subtle text-xs"> {game.blackElo}</span> : null}
              {game.annotated && (
                <NotebookPen className="text-info ml-1.5 inline size-3" aria-label="Annotated" />
              )}
            </p>
          )}
          <p className="text-subtle truncate text-xs" title={openingLabel}>
            {customName ? `${game.white} vs ${game.black} · ` : ''}
            {game.date}
            {openingLabel ? ` · ${openingLabel}` : ''}
            {game.timeControl ? ` · ${formatTimeControl(game.timeControl)}` : ''}
          </p>
        </div>
        {game.finalFen ? (
          <Eye
            className="text-subtle hover:text-fg size-3.5 shrink-0"
            aria-label="Preview the final position"
            onMouseEnter={showPreview}
            onMouseLeave={hidePreview}
          />
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden />
        )}
        <span className="text-muted w-12 shrink-0 text-right font-mono text-xs">
          {fmtResult(game.result)}
        </span>
      </div>
      {actions}
      {!game.link && <span className="w-[1.375rem] shrink-0" aria-hidden />}
      {game.link && (
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
function ImportGamePanel({ onDone }: { onDone: () => void }) {
  const [pgn, setPgn] = useState('');
  const [white, setWhite] = useState('');
  const [black, setBlack] = useState('');
  const [whiteElo, setWhiteElo] = useState('');
  const [blackElo, setBlackElo] = useState('');
  const [date, setDate] = useState('');
  const [event, setEvent] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <Panel flush>
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
          <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="Event (optional)" />
        </div>
        {failure && <p className="text-bad text-xs">{failure}</p>}
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={busy || !pgn.trim()} onClick={() => void submit()}>
            <Plus className="mr-1 size-3.5" />
            Add to collection
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function ResultDot({
  result,
  userSide,
}: {
  result: string;
  userSide: 'white' | 'black' | null;
}) {
  // From the user's perspective when known: green won, red lost, gray draw.
  if (userSide) {
    const won =
      (result === '1-0' && userSide === 'white') || (result === '0-1' && userSide === 'black');
    const lost =
      (result === '1-0' && userSide === 'black') || (result === '0-1' && userSide === 'white');
    return (
      <span
        title={result}
        className={cn(
          'size-2 shrink-0 rounded-full',
          won ? 'bg-good' : lost ? 'bg-bad' : 'bg-surface-3',
        )}
      />
    );
  }
  // Otherwise the dot shows which side won, in the pieces' own colours.
  if (result === '1-0' || result === '0-1') {
    return <SideDot side={result === '1-0' ? 'white' : 'black'} shape="circle" title={result} />;
  }
  return <span title={result} className="bg-surface-3 size-2 shrink-0 rounded-full" />;
}
