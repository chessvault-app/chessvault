import {
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  NotebookPen,
  Plus,
  Star,
  Swords,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Board } from '@/board/Board';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { StudyView } from '@/studies/StudyView';
import { Button } from '@/ui/Button';
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
  const id = params[0] ? decodeURIComponent(params[0]) : null;
  return id ? <StudyView id={id} kind="game" /> : <CollectionView />;
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

  const needle = query.trim().toLowerCase();
  const visible = games.filter((g) => {
    if (starredOnly && !bookmarks.has(gameKey(g))) return false;
    if (!needle) return true;
    return `${g.white} ${g.black} ${g.eco ?? ''} ${g.opening?.name ?? ''} ${g.date}`
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
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search collection…"
            className={cn(
              'bg-surface border-line text-fg h-8 w-56 rounded-md border px-2.5 text-sm',
              'outline-none focus:border-line-strong',
            )}
          />
        </div>
      </header>

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
          <PanelHeader title={`Collection · ${visible.length}`} />
          <ul className="divide-line min-h-0 divide-y overflow-y-auto">
            {visible.map((game) => (
              <GameRow
                key={gameKey(game)}
                game={game}
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
                          'opacity-0 transition-opacity group-hover:opacity-100',
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
                    <TwoStepDelete onConfirm={() => void removeGame(game)} />
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

function TwoStepDelete({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <Button
        variant="danger"
        size="sm"
        className="shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onConfirm();
        }}
      >
        Delete?
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Remove from the collection"
      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      onClick={(e) => {
        e.stopPropagation();
        setConfirming(true);
        setTimeout(() => setConfirming(false), 3000);
      }}
    >
      <Trash2 className="size-3.5" />
    </Button>
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
      const res = await fetch(`/api/games/archive/months?user=${encodeURIComponent(user)}`);
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
        `/api/games/archive/month?user=${encodeURIComponent(username.trim())}&month=${m}`,
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
        navigate('analysis');
      }
    } catch {
      setError('could not load that game');
    }
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
        title="Browse chess.com"
        actions={
          months.length > 0 ? (
            <div className="relative">
              <select
                value={month}
                onChange={(e) => void loadMonth(e.target.value)}
                aria-label="Archive month"
                className={cn(
                  'bg-surface-2 text-fg border-line h-7 appearance-none rounded-md border',
                  'pl-2 pr-7 text-xs outline-none',
                )}
              >
                {months.map((m) => (
                  <option key={m.month} value={m.month}>
                    {m.month}
                    {m.cached ? ` · ${m.games} ✓` : offline ? ' · needs internet' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-subtle pointer-events-none absolute right-1.5 top-1.5 size-3.5" />
            </div>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <Download className="text-subtle size-4 shrink-0" />
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && username.trim()) void loadMonths();
          }}
          placeholder="chess.com username"
          className={cn(
            'bg-surface-inset border-line text-fg h-8 w-48 rounded-md border px-2.5',
            'font-mono text-xs outline-none focus:border-line-strong',
          )}
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
                      className="shrink-0"
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
}: {
  game: GameSummary;
  onOpen: () => void;
  onPreview: (preview: Preview | null) => void;
  actions: React.ReactNode;
}) {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The preview triggers from the row's text area only — hovering the action
  // buttons (star, delete, add) must not pop a board over them.
  const showPreview = (e: React.MouseEvent<HTMLElement>): void => {
    if (!game.finalFen) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fen = game.finalFen;
    const orientation = game.userSide ?? 'white';
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      const top = Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200);
      onPreview({ fen, orientation, top, left: Math.max(rect.right - 96, 8) });
    }, 250);
  };

  const hidePreview = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    onPreview(null);
  };

  const openingLabel = game.opening
    ? `${game.opening.name} · ${game.opening.eco}`
    : (game.eco ?? '');

  return (
    <li
      onClick={onOpen}
      className="group hover:bg-surface-2 flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-100"
    >
      <div
        onMouseEnter={showPreview}
        onMouseLeave={hidePreview}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <ResultDot result={game.result} userSide={game.userSide} />
        <div className="min-w-0 flex-1">
          <p className="text-fg truncate text-sm">
            <span className={cn('font-medium', game.userSide === 'white' && 'text-primary')}>
              {game.white}
            </span>
            {game.whiteElo ? <span className="text-subtle text-xs"> {game.whiteElo}</span> : null}
            <span className="text-subtle"> vs </span>
            <span className={cn('font-medium', game.userSide === 'black' && 'text-primary')}>
              {game.black}
            </span>
            {game.blackElo ? <span className="text-subtle text-xs"> {game.blackElo}</span> : null}
            {game.annotated && (
              <NotebookPen className="text-info ml-1.5 inline size-3" aria-label="Annotated" />
            )}
          </p>
          <p className="text-subtle truncate text-xs" title={openingLabel}>
            {game.date}
            {openingLabel ? ` · ${openingLabel}` : ''}
            {game.timeControl ? ` · ${formatTimeControl(game.timeControl)}` : ''}
          </p>
        </div>
        <span className="text-muted w-12 shrink-0 text-right font-mono text-xs">{game.result}</span>
      </div>
      {actions}
      {game.link && (
        <a
          href={game.link}
          target="_blank"
          rel="noreferrer"
          title="View on chess.com (needs internet)"
          onClick={(e) => e.stopPropagation()}
          className="text-subtle hover:text-fg shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </li>
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
  let className = 'bg-surface-3';
  if (userSide) {
    const won = (result === '1-0' && userSide === 'white') || (result === '0-1' && userSide === 'black');
    const lost = (result === '1-0' && userSide === 'black') || (result === '0-1' && userSide === 'white');
    className = won ? 'bg-good' : lost ? 'bg-bad' : 'bg-surface-3';
  } else if (result === '1-0') {
    className = 'border-black/40 bg-[#f2f2f2] border';
  } else if (result === '0-1') {
    className = 'border-white/50 bg-[#1a1a1a] border';
  }
  return <span title={result} className={cn('size-2 shrink-0 rounded-full', className)} />;
}
