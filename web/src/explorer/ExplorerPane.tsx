import { BookOpen, Compass, ExternalLink, Hammer, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getNode, pathTo } from '@shared/tree';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';
import { useStudy } from '@/store/study';
import {
  activeBook,
  isRemoteDb,
  REMOTE_DBS,
  useExplorer,
  type BookInfo,
  type BuildStatus,
  type ExplorerMove,
  type Opening,
  type TopGame,
} from '@/store/explorer';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Input } from '@/ui/Input';
import { Panel, PanelHeader } from '@/ui/Panel';
import { SideDot } from '@/ui/SideDot';
import { ConfirmPopover } from '@/ui/ConfirmPopover';
import { Switch } from '@/ui/Switch';
import { t } from '@/lib/i18n';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat('en');

/** Continuations shown before the list folds behind “show all”. */
const MOVE_LIMIT = 8;

export function ExplorerPane({
  className,
  resizeKey,
}: {
  className?: string;
  resizeKey?: string;
}) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const playUci = useAnalysis((s) => s.playUci);

  const enabled = useExplorer((s) => s.enabled);
  const toggle = useExplorer((s) => s.toggle);
  const books = useExplorer((s) => s.books);
  const booksLoaded = useExplorer((s) => s.booksLoaded);
  const selectedBook = useExplorer((s) => s.book);
  const selectBook = useExplorer((s) => s.selectBook);
  const refreshBooks = useExplorer((s) => s.refreshBooks);
  const lookup = useExplorer((s) => s.lookup);
  const resultFen = useExplorer((s) => s.resultFen);
  const moves = useExplorer((s) => s.moves);
  const topGames = useExplorer((s) => s.topGames);
  const opening = useExplorer((s) => s.opening);
  const openingsSeen = useExplorer((s) => s.openingsSeen);
  const loading = useExplorer((s) => s.loading);
  const error = useExplorer((s) => s.error);

  const [showManager, setShowManager] = useState(false);
  // Rare continuations are noise most of the time — show the top handful
  // and keep the pane's room for the reference games below.
  const [allMoves, setAllMoves] = useState(false);

  const node = getNode(tree, cursorId);
  const book = activeBook({ book: selectedBook, books });

  useEffect(() => {
    void refreshBooks();
  }, [refreshBooks]);

  useEffect(() => {
    if (enabled) lookup(node.fen);
  }, [node.fen, enabled, book, lookup]);

  // The name shown is the deepest *named* position on the current line: deep
  // middlegames keep their opening's name rather than dropping to nothing.
  const lineOpening = useMemo((): Opening | null => {
    if (opening && resultFen === node.fen) return opening;
    for (const id of [...pathTo(tree, cursorId)].reverse()) {
      const seen = openingsSeen[getNode(tree, id).fen];
      if (seen) return seen;
    }
    return null;
  }, [opening, resultFen, node.fen, tree, cursorId, openingsSeen]);

  const fresh = resultFen === node.fen;

  return (
    // While the explorer is off there is nothing to size: no resize grip,
    // no default height — the panel collapses to its header. The compact
    // default (when on) shows the top handful of moves; drag for more.
    <Panel
      flush
      className={className}
      resizeKey={enabled ? resizeKey : undefined}
      defaultHeight={enabled ? 300 : undefined}
    >
      <PanelHeader
        title={t('Explorer')}
        actions={
          <>
            {enabled && (books.length > 0 || isRemoteDb(book)) && (
              <Select
                value={book ?? ''}
                onChange={selectBook}
                ariaLabel={t('Opening book')}
                size="sm"
                align="end"
                className="max-w-[8rem]"
                groups={[
                  { label: 'Local books', options: books.map((b) => ({ value: b.name, label: b.name })) },
                  {
                    label: 'Online (via proxy)',
                    options: REMOTE_DBS.map((db) => ({ value: db.id, label: db.label })),
                  },
                ]}
              />
            )}
            {enabled && (
              <Button
                variant="ghost"
                size="icon-sm"
                active={showManager}
                onClick={() => setShowManager((v) => !v)}
                title={t('Manage books')}
              >
                <BookOpen className="size-3.5" />
              </Button>
            )}
            <Switch
              checked={enabled}
              onToggle={toggle}
              label={t('Explorer on/off')}
              title={enabled ? 'Hide the explorer' : 'Show the explorer'}
            />
          </>
        }
      />

      {enabled && showManager && <BooksManager onClose={() => setShowManager(false)} />}

      {!enabled ? null : !showManager && (
        <>
          <div className="border-line flex h-8 shrink-0 items-center gap-2 border-b px-3">
            {lineOpening ? (
              <>
                <span className="text-subtle shrink-0 font-mono text-[0.6875rem] font-semibold">
                  {lineOpening.eco}
                </span>
                <span
                  className="text-fg min-w-0 truncate text-xs font-medium"
                  title={`${lineOpening.eco} ${lineOpening.name}`}
                >
                  {lineOpening.name}
                </span>
              </>
            ) : (
              <span className="text-subtle text-xs">
                {node.ply === 0 ? 'Starting position' : 'Out of book'}
              </span>
            )}
            {loading && <Loader2 className="text-subtle ml-auto size-3 shrink-0 animate-spin" />}
          </div>

          {error ? (
            <p className="text-bad px-3 py-3 text-xs">{error}</p>
          ) : booksLoaded && books.length === 0 && !isRemoteDb(book) ? (
            <EmptyBooks onOpenManager={() => setShowManager(true)} />
          ) : (
            <div className={cn('min-h-0 overflow-y-auto', !fresh && 'opacity-60')}>
              {moves.length === 0 && fresh ? (
                <p className="text-subtle px-3 py-3 text-xs">
                  No games from this position in “{book}”.
                </p>
              ) : (
                <>
                  <table className="w-full text-xs">
                    <tbody>
                      {(allMoves ? moves : moves.slice(0, MOVE_LIMIT)).map((m) => (
                        <MoveRow key={m.uci} move={m} onPlay={() => playUci(m.uci)} />
                      ))}
                    </tbody>
                  </table>
                  {moves.length > MOVE_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setAllMoves((v) => !v)}
                      className="text-subtle hover:text-fg w-full px-3 py-1 text-left text-[0.6875rem] transition-colors duration-100"
                    >
                      {allMoves ? 'Show fewer moves' : `Show all ${moves.length} moves`}
                    </button>
                  )}
                </>
              )}
              {topGames.length > 0 && <TopGamesList games={topGames} onPlay={playUci} />}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function MoveRow({ move, onPlay }: { move: ExplorerMove; onPlay: () => void }) {
  return (
    <tr
      onClick={onPlay}
      className="hover:bg-surface-2 cursor-pointer transition-colors duration-100"
    >
      <td className="text-fg w-14 py-1 pl-3 pr-1 font-mono font-semibold">{move.san}</td>
      <td
        className="text-muted w-14 py-1 pr-2 text-right font-mono tabular-nums"
        title={`${exact.format(move.total)} games`}
      >
        {compact.format(move.total)}
      </td>
      <td className="py-1 pr-3">
        <ResultBar w={move.w} d={move.d} b={move.b} />
      </td>
    </tr>
  );
}

/** Lichess-style stacked white/draw/black percentage bar. */
function ResultBar({ w, d, b }: { w: number; d: number; b: number }) {
  const total = w + d + b;
  if (total === 0) return null;
  const pct = (n: number): number => (100 * n) / total;
  const segments = [
    { value: pct(w), className: 'bg-eval-white text-on-eval-white' },
    { value: pct(d), className: 'bg-surface-3 text-muted' },
    { value: pct(b), className: 'bg-eval-black text-on-eval-black' },
  ];
  return (
    <div
      className="border-line flex h-4 w-full overflow-hidden rounded-[4px] border font-mono text-[0.5625rem]"
      title={`White ${pct(w).toFixed(1)}% · Draw ${pct(d).toFixed(1)}% · Black ${pct(b).toFixed(1)}%`}
    >
      {segments.map(({ value, className }, i) => (
        <span
          key={i}
          style={{ width: `${value}%` }}
          className={cn('flex items-center justify-center overflow-hidden', className)}
        >
          {value >= 12 ? `${Math.round(value)}%` : ''}
        </span>
      ))}
    </div>
  );
}

function TopGamesList({ games, onPlay }: { games: TopGame[]; onPlay: (uci: string) => boolean }) {
  /**
   * A top game is a reference into the reference-games database when one
   * is built from the same sources: clicking opens the WHOLE game on the
   * board (lanph3re's call). When the game isn't indexed there, fall back to
   * the old behaviour and just play the move.
   */
  const open = async (g: TopGame): Promise<void> => {
    try {
      const query = new URLSearchParams({ white: g.white, black: g.black });
      if (g.date) query.set('date', g.date);
      if (g.result) query.set('result', g.result);
      const found = await fetch(`/api/refgames/find?${query}`);
      if (found.ok) {
        const { id } = (await found.json()) as { id: number };
        const res = await fetch(`/api/refgames/${id}/pgn`);
        if (res.ok) {
          const { pgn } = (await res.json()) as { pgn: string };
          // The explorer also lives inside study/game views, which keep
          // their document in the SAME analysis store with dirty-tracking
          // autosave. Detach (saving real edits) BEFORE loading the elite
          // game, or the autosave would write it over the open document.
          if (useStudy.getState().openId) await useStudy.getState().close();
          if (useAnalysis.getState().loadPgn(pgn)) {
            useAnalysis.setState({ handoff: true });
            navigate('analysis');
            return;
          }
        }
      }
    } catch {
      // offline server hiccup — the fallback below still works
    }
    onPlay(g.uci);
  };

  return (
    <div className="border-line border-t px-1.5 pb-2">
      <p className="text-subtle px-1.5 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
        {t('Top games')}
      </p>
      <ul className="flex flex-col gap-px">
        {games.map((g, i) => {
          const gameUrl = g.site?.startsWith('https://') ? g.site : null;
          return (
            <li key={i} className="flex items-center">
              <button
                type="button"
                onClick={() => void open(g)}
                title={t('Open this game')}
                className={cn(
                  'hover:bg-surface-2 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1',
                  'text-left text-xs transition-colors duration-100',
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <SideDot side="white" className="mr-1 inline-block size-2 align-[-1px]" />
                  <span className="text-fg">{g.white}</span>
                  <span className="text-subtle font-mono text-[0.625rem]"> {g.whiteElo || ''} </span>
                  <span className="text-subtle">v</span>
                  <SideDot side="black" className="mx-1 inline-block size-2 align-[-1px]" />
                  <span className="text-fg">{g.black}</span>
                  <span className="text-subtle font-mono text-[0.625rem]"> {g.blackElo || ''}</span>
                </span>
                <ResultBadge result={g.result} />
              </button>
              {gameUrl && (
                <a
                  href={gameUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`${gameUrl} (needs internet)`}
                  className="text-subtle hover:text-fg shrink-0 p-1"
                >
                  <ExternalLink className="size-3" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  const label = result === '1-0' ? '1-0' : result === '0-1' ? '0-1' : '½';
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 py-px font-mono text-[0.625rem] font-semibold',
        result === '1-0' && 'bg-eval-white text-on-eval-white',
        result === '0-1' && 'bg-eval-black text-on-eval-black',
        result !== '1-0' && result !== '0-1' && 'bg-surface-3 text-muted',
      )}
    >
      {label}
    </span>
  );
}

function EmptyBooks({ onOpenManager }: { onOpenManager: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <Compass className="text-subtle size-5" strokeWidth={1.75} />
      <p className="text-muted text-xs leading-relaxed">
        No opening books yet. Drop PGN files into <code className="font-mono">vault/sources/</code>{' '}
        and build one.
      </p>
      <Button variant="ghost" size="sm" onClick={onOpenManager}>
        <Hammer className="mr-1 size-3.5" />
        {t('Manage books')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Book manager: list/build/delete books over the /api/books endpoints.

function BooksManager({ onClose }: { onClose: () => void }) {
  const books = useExplorer((s) => s.books);
  const refreshBooks = useExplorer((s) => s.refreshBooks);
  const deleteBook = useExplorer((s) => s.deleteBook);
  const startBuild = useExplorer((s) => s.startBuild);
  const fetchBuildStatus = useExplorer((s) => s.fetchBuildStatus);

  const [sources, setSources] = useState<{ name: string; bytes: number }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  useEffect(() => {
    void fetch('/api/sources')
      .then((r) => r.json() as Promise<{ sources: { name: string; bytes: number }[] }>)
      .then((b) => setSources(b.sources))
      .catch(() => setError('could not list vault/sources'));
  }, []);

  // Poll the build while one runs; refresh the shelf when it finishes.
  useEffect(() => {
    const tick = async (): Promise<void> => {
      const s = await fetchBuildStatus();
      setStatus(s);
      if (s?.running) {
        wasRunning.current = true;
      } else if (wasRunning.current) {
        wasRunning.current = false;
        void refreshBooks();
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1500);
    return () => clearInterval(interval);
  }, [fetchBuildStatus, refreshBooks]);

  const build = async (buildName: string, buildSources: string[]): Promise<void> => {
    setError(null);
    const failure = await startBuild({ name: buildName, sources: buildSources });
    if (failure) {
      setError(failure);
      return;
    }
    setStatus({ running: true, name: buildName, log: [] });
    wasRunning.current = true;
  };

  const running = status?.running === true;

  return (
    <div className="border-line bg-surface-inset flex min-h-0 flex-col gap-3 overflow-y-auto border-b px-3 py-3 text-xs">
      {books.length > 0 && (
        <ul className="flex flex-col gap-1">
          {books.map((b) => (
            <BookRow
              key={b.name}
              book={b}
              busy={running}
              onRebuild={() => void build(b.name, b.sources)}
              onDelete={async () => {
                const failure = await deleteBook(b.name);
                if (failure) setError(failure);
              }}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-subtle font-semibold uppercase tracking-[0.08em] text-[0.625rem]">
          {t('Build a book')}
        </p>
        {sources.length === 0 ? (
          <p className="text-muted leading-relaxed">
            No PGN files found. Put game collections (e.g. Lichess Elite months, Lumbra's
            Gigabase exports) into <code className="font-mono">vault/sources/</code>, then come
            back here.
          </p>
        ) : (
          <>
            {sources.map((s) => (
              <label key={s.name} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(s.name)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(s.name);
                    else next.delete(s.name);
                    setPicked(next);
                  }}
                  className="accent-primary"
                />
                <span className="text-fg min-w-0 flex-1 truncate font-mono">{s.name}</span>
                <span className="text-subtle shrink-0 tabular-nums">
                  {(s.bytes / 1e6).toFixed(0)} MB
                </span>
              </label>
            ))}
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="book name"
                inputSize="sm"
                className="flex-1 font-mono"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={running || picked.size === 0 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)}
                onClick={() => void build(name, [...picked])}
              >
                {t('Build')}
              </Button>
            </div>
          </>
        )}
      </div>

      {(running || (status?.log?.length ?? 0) > 0) && (
        <div className="flex flex-col gap-1">
          <p className="text-subtle flex items-center gap-1.5 font-semibold uppercase tracking-[0.08em] text-[0.625rem]">
            {running && <Loader2 className="size-3 animate-spin" />}
            {running
              ? `Building “${status?.name}”…`
              : status?.exitCode === 0
                ? `Built “${status?.name}”`
                : `Build of “${status?.name}” failed`}
          </p>
          <pre className="bg-surface text-subtle max-h-24 overflow-y-auto rounded-md p-2 font-mono text-[0.625rem] leading-relaxed">
            {(status?.log ?? []).slice(-6).join('\n') || '…'}
          </pre>
        </div>
      )}

      {error && <p className="text-bad">{error}</p>}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('Close')}
        </Button>
      </div>
    </div>
  );
}

function BookRow({
  book,
  busy,
  onRebuild,
  onDelete,
}: {
  book: BookInfo;
  busy: boolean;
  onRebuild: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="bg-surface border-line flex items-center gap-2 rounded-md border px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-fg truncate font-mono font-semibold">{book.name}</p>
        <p className="text-subtle tabular-nums">
          {compact.format(book.games)} games · {compact.format(book.positions)} positions ·{' '}
          {(book.bytes / 1e6).toFixed(0)} MB
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy || book.sources.length === 0}
        onClick={onRebuild}
        title={
          book.sources.length > 0
            ? `Rebuild from ${book.sources.join(', ')}`
            : 'Original sources unknown'
        }
      >
        <Hammer className="size-3.5" />
      </Button>
      <ConfirmPopover
        icon={Trash2}
        triggerTitle="Delete this book (the source PGNs stay)"
        question="Delete this opening book?"
        confirmLabel="Delete"
        disabled={busy}
        onConfirm={onDelete}
      />
    </li>
  );
}
