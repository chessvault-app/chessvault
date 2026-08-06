import { BookOpen, Download, ExternalLink, Loader2, Star, Swords } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Board } from '@/board/Board';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
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
}

const gameKey = (g: Pick<GameSummary, 'file' | 'index'>): string => `${g.file}#${g.index}`;

interface Preview {
  fen: string;
  top: number;
  left: number;
}

interface ImportStatus {
  running: boolean;
  user?: string;
  monthsDone?: number;
  monthsTotal?: number;
  games?: number;
  error?: string | null;
}

const PAGE = 200;

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

export function GamesView() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [starredOnly, setStarredOnly] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async (offset = 0): Promise<void> => {
    try {
      const res = await fetch(`/api/games?limit=${PAGE}&offset=${offset}`);
      const body = (await res.json()) as { total: number; games: GameSummary[] };
      setTotal(body.total);
      setGames((prev) => (offset === 0 ? body.games : [...prev, ...body.games]));
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

  const openInAnalysis = async (game: GameSummary): Promise<void> => {
    setBusy(`${game.file}#${game.index}`);
    try {
      const res = await fetch(
        `/api/games/pgn?file=${encodeURIComponent(game.file)}&index=${game.index}`,
      );
      const { pgn } = (await res.json()) as { pgn: string };
      if (useAnalysis.getState().loadPgn(pgn)) navigate('analysis');
      else setError('could not parse that game');
    } catch {
      setError('could not load that game');
    } finally {
      setBusy(null);
    }
  };

  const saveAsStudy = async (game: GameSummary): Promise<void> => {
    setBusy(`${game.file}#${game.index}`);
    try {
      const res = await fetch(
        `/api/games/pgn?file=${encodeURIComponent(game.file)}&index=${game.index}`,
      );
      const { pgn } = (await res.json()) as { pgn: string };
      // Studies made from games get filed together in a Games collection.
      const name = `Games/${game.white} vs ${game.black} ${game.date.replaceAll('.', '-')}`;
      const created = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!created.ok) {
        const body = (await created.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'could not create the study');
        return;
      }
      await fetch(`/api/studies/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pgn }),
      });
      navigate('studies', encodeURIComponent(name));
    } catch {
      setError('could not save the study');
    } finally {
      setBusy(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = games.filter((g) => {
    if (starredOnly && !bookmarks.has(gameKey(g))) return false;
    if (!needle) return true;
    return `${g.white} ${g.black} ${g.eco ?? ''} ${g.opening?.name ?? ''} ${g.date}`
      .toLowerCase()
      .includes(needle);
  });
  const filtered = starredOnly || needle.length > 0;

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
            placeholder="Filter by player, opening, date…"
            className={cn(
              'bg-surface border-line text-fg h-8 w-56 rounded-md border px-2.5 text-sm',
              'outline-none focus:border-line-strong',
            )}
          />
        </div>
      </header>

      <ImportPanel onImported={() => void load()} />

      {error && <p className="text-bad text-xs">{error}</p>}

      {games.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Swords className="text-subtle size-6" strokeWidth={1.5} />
          <p className="text-muted max-w-md text-sm leading-relaxed">
            No games in the vault yet. Import your chess.com history above — it lands as plain
            PGN in <code className="font-mono text-xs">vault/games/</code>, one file per month,
            and re-importing only fetches what's new.
          </p>
        </div>
      ) : (
        <Panel flush>
          <PanelHeader
            title={`${total.toLocaleString()} games${filtered ? ` · ${visible.length} shown` : ''}`}
          />
          <ul className="divide-line min-h-0 divide-y overflow-y-auto">
            {visible.map((game) => (
              <GameRow
                key={gameKey(game)}
                game={game}
                busy={busy === gameKey(game)}
                bookmarked={bookmarks.has(gameKey(game))}
                onOpen={() => void openInAnalysis(game)}
                onStudy={() => void saveAsStudy(game)}
                onBookmark={() => void toggleBookmark(game)}
                onPreview={setPreview}
              />
            ))}
          </ul>
          {games.length < total && !filtered && (
            <div className="border-line flex justify-center border-t p-2">
              <Button variant="ghost" size="sm" onClick={() => void load(games.length)}>
                Load more ({(total - games.length).toLocaleString()} left)
              </Button>
            </div>
          )}
        </Panel>
      )}

      {preview && (
        <div
          style={{ top: preview.top, left: preview.left }}
          className={cn(
            'border-line bg-surface pointer-events-none fixed z-50 w-44 rounded-lg border p-1',
            'shadow-[var(--shadow-pop)]',
          )}
        >
          <Board fen={preview.fen} viewOnly coordinates={false} className="rounded" />
        </div>
      )}
    </div>
  );
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  // Poll while an import runs; refresh the table when it finishes.
  useEffect(() => {
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/games/import/status');
        const s = (await res.json()) as ImportStatus;
        setStatus(s);
        if (s.running) {
          wasRunning.current = true;
        } else if (wasRunning.current) {
          wasRunning.current = false;
          onImported();
        }
      } catch {
        /* server gone; the table shows its own error */
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1200);
    return () => clearInterval(interval);
  }, [onImported]);

  const start = async (): Promise<void> => {
    setError(null);
    const res = await fetch('/api/games/import/chesscom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.trim() }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) setError(body?.error ?? 'import failed to start');
    else {
      setStatus({ running: true, user: username.trim(), monthsDone: 0, monthsTotal: 0, games: 0 });
      wasRunning.current = true;
    }
  };

  const running = status?.running === true;

  return (
    <Panel className="shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <Download className="text-subtle size-4 shrink-0" />
        <span className="text-fg text-sm font-medium">Import from chess.com</span>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && username.trim() && !running) void start();
          }}
          placeholder="chess.com username"
          className={cn(
            'bg-surface-inset border-line text-fg h-8 w-48 rounded-md border px-2.5',
            'font-mono text-xs outline-none focus:border-line-strong',
          )}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={running || !username.trim()}
          onClick={() => void start()}
        >
          {running ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
          Import
        </Button>
        {error && <span className="text-bad text-xs">{error}</span>}
        {status && (running || status.error || wasRunning.current) && (
          <span className={cn('text-xs', status.error ? 'text-bad' : 'text-muted')}>
            {status.error
              ? status.error
              : running
                ? `${status.user}: month ${status.monthsDone}/${status.monthsTotal || '…'} · ${status.games ?? 0} new games`
                : null}
          </span>
        )}
        {!running && status?.error == null && status?.monthsTotal ? (
          <span className="text-muted text-xs">
            done — {status.games} new game{status.games === 1 ? '' : 's'} from{' '}
            {status.monthsTotal} month{status.monthsTotal === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

function GameRow({
  game,
  busy,
  bookmarked,
  onOpen,
  onStudy,
  onBookmark,
  onPreview,
}: {
  game: GameSummary;
  busy: boolean;
  bookmarked: boolean;
  onOpen: () => void;
  onStudy: () => void;
  onBookmark: () => void;
  onPreview: (preview: Preview | null) => void;
}) {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPreview = (e: React.MouseEvent<HTMLLIElement>): void => {
    if (!game.finalFen) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fen = game.finalFen;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      // 176px board + padding, clamped into the viewport.
      const top = Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200);
      onPreview({ fen, top, left: Math.max(rect.right - 236, 8) });
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
      onMouseEnter={showPreview}
      onMouseLeave={hidePreview}
      className="group hover:bg-surface-2 flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-100"
    >
      <ResultDot result={game.result} />
      <div className="min-w-0 flex-1">
        <p className="text-fg truncate text-sm">
          <span className="font-medium">{game.white}</span>
          {game.whiteElo ? <span className="text-subtle text-xs"> {game.whiteElo}</span> : null}
          <span className="text-subtle"> vs </span>
          <span className="font-medium">{game.black}</span>
          {game.blackElo ? <span className="text-subtle text-xs"> {game.blackElo}</span> : null}
        </p>
        <p className="text-subtle truncate text-xs" title={openingLabel}>
          {game.date}
          {openingLabel ? ` · ${openingLabel}` : ''}
          {game.timeControl ? ` · ${formatTimeControl(game.timeControl)}` : ''}
        </p>
      </div>
      <span className="text-muted w-12 shrink-0 text-right font-mono text-xs">{game.result}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        title={bookmarked ? 'Remove bookmark' : 'Bookmark this game'}
        className={cn('shrink-0', !bookmarked && 'opacity-0 transition-opacity group-hover:opacity-100')}
        onClick={(e) => {
          e.stopPropagation();
          onBookmark();
        }}
      >
        <Star className={cn('size-3.5', bookmarked && 'fill-warn text-warn')} />
      </Button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {busy && <Loader2 className="text-subtle size-3.5 animate-spin" />}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Save as a study"
          onClick={(e) => {
            e.stopPropagation();
            onStudy();
          }}
        >
          <BookOpen className="size-3.5" />
        </Button>
        {game.link && (
          <a
            href={game.link}
            target="_blank"
            rel="noreferrer"
            title="View on chess.com (needs internet)"
            onClick={(e) => e.stopPropagation()}
            className="text-subtle hover:text-fg p-1"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    </li>
  );
}

function ResultDot({ result }: { result: string }) {
  return (
    <span
      title={result}
      className={cn(
        'size-2 shrink-0 rounded-full',
        result === '1-0' && 'bg-eval-white border-line border',
        result === '0-1' && 'bg-eval-black',
        result !== '1-0' && result !== '0-1' && 'bg-surface-3',
      )}
    />
  );
}
