import { BookOpen, Download, ExternalLink, Loader2, Swords } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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

export function GamesView() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
  }, [load]);

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
      const name = `${game.white} vs ${game.black} ${game.date.replaceAll('.', '-')}`;
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
  const visible = needle
    ? games.filter((g) =>
        `${g.white} ${g.black} ${g.eco ?? ''} ${g.date}`.toLowerCase().includes(needle),
      )
    : games;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Games</h1>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by player, ECO, date…"
          className={cn(
            'bg-surface border-line text-fg h-8 w-56 rounded-md border px-2.5 text-sm',
            'outline-none focus:border-line-strong',
          )}
        />
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
            title={`${total.toLocaleString()} games${needle ? ` · ${visible.length} shown` : ''}`}
          />
          <ul className="divide-line min-h-0 divide-y overflow-y-auto">
            {visible.map((game) => (
              <GameRow
                key={`${game.file}#${game.index}`}
                game={game}
                busy={busy === `${game.file}#${game.index}`}
                onOpen={() => void openInAnalysis(game)}
                onStudy={() => void saveAsStudy(game)}
              />
            ))}
          </ul>
          {games.length < total && !needle && (
            <div className="border-line flex justify-center border-t p-2">
              <Button variant="ghost" size="sm" onClick={() => void load(games.length)}>
                Load more ({(total - games.length).toLocaleString()} left)
              </Button>
            </div>
          )}
        </Panel>
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
  onOpen,
  onStudy,
}: {
  game: GameSummary;
  busy: boolean;
  onOpen: () => void;
  onStudy: () => void;
}) {
  return (
    <li
      onClick={onOpen}
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
        <p className="text-subtle text-xs">
          {game.date}
          {game.eco ? ` · ${game.eco}` : ''}
          {game.timeControl ? ` · ${game.timeControl}` : ''}
        </p>
      </div>
      <span className="text-muted w-12 shrink-0 text-right font-mono text-xs">{game.result}</span>
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
