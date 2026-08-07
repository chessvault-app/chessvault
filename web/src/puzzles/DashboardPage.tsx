import { ArrowLeft, BookMarked, Check, ChevronRight, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '@/lib/router';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';

/**
 * Training overview: counters, results by difficulty band, and the recent
 * attempt log — all derived from vault/puzzles/history.jsonl. Counted
 * attempts only in the aggregates; review (practice) attempts show in the
 * log with a tag but don't skew the numbers.
 */

interface HistoryEntry {
  id: string;
  win: boolean;
  counted?: boolean;
  puzzleRating: number;
  at: string;
}

interface MetaUser {
  attempts: number;
  wins: number;
  streak: number;
}

interface BookSummary {
  slug: string;
  title: string;
  puzzles: number;
  solved: number;
  failed: number;
}

const BANDS = [
  { id: 'easy', label: 'Easy', min: 0, max: 1399 },
  { id: 'medium', label: 'Medium', min: 1400, max: 1799 },
  { id: 'hard', label: 'Hard', min: 1800, max: 2199 },
  { id: 'expert', label: 'Expert', min: 2200, max: 9999 },
] as const;

type ResultFilter = 'all' | 'solved' | 'review';
type BandFilter = 'any' | (typeof BANDS)[number]['id'];

export function DashboardPage() {
  const [user, setUser] = useState<MetaUser | null>(null);
  const [failed, setFailed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [books, setBooks] = useState<BookSummary[] | null>(null);

  const refresh = useCallback(() => {
    void fetch('/api/puzzles/meta')
      .then((r) => r.json())
      .then((d: { user: MetaUser; failed?: number }) => {
        setUser(d.user);
        setFailed(d.failed ?? 0);
      });
    void fetch('/api/puzzles/history?limit=500')
      .then((r) => r.json())
      .then((d: { attempts: HistoryEntry[] }) => setHistory(d.attempts));
    void fetch('/api/puzzlebooks')
      .then((r) => r.json())
      .then((d: { books: BookSummary[] }) => setBooks(d.books));
  }, []);
  useEffect(() => refresh(), [refresh]);

  const counted = (history ?? []).filter((h) => h.counted !== false);
  const winRate = user && user.attempts > 0 ? Math.round((100 * user.wins) / user.attempts) : null;

  // The puzzle list shows each puzzle ONCE, judged by its latest attempt
  // (history arrives newest-first). Filters cut by outcome and rating band.
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [bandFilter, setBandFilter] = useState<BandFilter>('any');
  const latestById = new Map<string, HistoryEntry>();
  for (const h of history ?? []) {
    if (!latestById.has(h.id)) latestById.set(h.id, h);
  }
  const puzzles = [...latestById.values()].filter((h) => {
    if (resultFilter === 'solved' && !h.win) return false;
    if (resultFilter === 'review' && h.win) return false;
    if (bandFilter !== 'any') {
      const band = BANDS.find((b) => b.id === bandFilter)!;
      if (h.puzzleRating < band.min || h.puzzleRating > band.max) return false;
    }
    return true;
  });

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 pb-8">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Back to training"
            onClick={() => navigate('puzzles')}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg text-base font-semibold">Puzzle dashboard</h1>
          <ResetButton onDone={refresh} />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Solved" value={user ? String(user.wins) : '…'} />
          <StatCard label="Attempts" value={user ? String(user.attempts) : '…'} />
          <StatCard label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
          <StatCard
            label="To review"
            value={String(failed)}
            action={
              failed > 0 ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Review failed puzzles"
                  onClick={() => navigate('puzzles', 'failed')}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              ) : undefined
            }
          />
        </div>

        <Panel flush className="mb-4">
          <PanelHeader title="By difficulty" />
          <div className="grid gap-2.5 p-3">
            {BANDS.map((band) => {
              const inBand = counted.filter(
                (h) => h.puzzleRating >= band.min && h.puzzleRating <= band.max,
              );
              const wins = inBand.filter((h) => h.win).length;
              const losses = inBand.length - wins;
              return (
                <div key={band.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                  <span className="text-muted text-xs">{band.label}</span>
                  <div className="bg-surface-inset flex h-2 overflow-hidden rounded-full">
                    {inBand.length > 0 && (
                      <>
                        <div
                          className="bg-nag-good h-full"
                          style={{ width: `${(100 * wins) / inBand.length}%` }}
                        />
                        <div
                          className="bg-nag-blunder h-full"
                          style={{ width: `${(100 * losses) / inBand.length}%` }}
                        />
                      </>
                    )}
                  </div>
                  <span className="text-subtle w-16 text-right font-mono text-[0.6875rem] tabular-nums">
                    {inBand.length > 0 ? `${wins}/${inBand.length}` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        {books !== null && books.length > 0 && (
          <Panel flush className="mb-4">
            <PanelHeader
              title="Books"
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  title="All puzzle books"
                  onClick={() => navigate('puzzles', 'books')}
                >
                  <BookMarked className="size-3.5" />
                  Shelf
                </Button>
              }
            />
            <ul>
              {books.map((b) => (
                <li key={b.slug} className="border-line border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => navigate('puzzles', 'books', b.slug)}
                    className="hover:bg-surface-2 flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors duration-100"
                  >
                    <span className="text-fg min-w-0 flex-1 truncate font-medium">{b.title}</span>
                    <span className="text-subtle shrink-0 font-mono tabular-nums">
                      {b.solved}/{b.puzzles}
                    </span>
                    {b.puzzles > 0 && (
                      <span className="bg-surface-inset flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full">
                        <span
                          className="bg-nag-good h-full"
                          style={{ width: `${(100 * b.solved) / b.puzzles}%` }}
                        />
                        <span
                          className="bg-nag-blunder h-full"
                          style={{ width: `${(100 * b.failed) / b.puzzles}%` }}
                        />
                      </span>
                    )}
                    <ChevronRight className="text-subtle size-3.5 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel flush>
          <PanelHeader
            title={history === null ? 'Puzzles' : `Puzzles · ${puzzles.length}`}
          />
          {/* Filters: outcome × rating band. Click a row to replay it. */}
          <div className="border-line flex flex-wrap items-center gap-1 border-b px-3 py-2">
            {(
              [
                ['all', 'All'],
                ['solved', 'Solved'],
                ['review', 'To review'],
              ] as [ResultFilter, string][]
            ).map(([id, label]) => (
              <FilterChip
                key={id}
                label={label}
                active={resultFilter === id}
                onClick={() => setResultFilter(id)}
              />
            ))}
            <span className="bg-line mx-1 h-4 w-px" />
            <FilterChip label="Any" active={bandFilter === 'any'} onClick={() => setBandFilter('any')} />
            {BANDS.map((b) => (
              <FilterChip
                key={b.id}
                label={b.label}
                active={bandFilter === b.id}
                onClick={() => setBandFilter(b.id)}
              />
            ))}
          </div>
          {history === null ? (
            <p className="text-subtle px-3 py-3 text-xs">Loading…</p>
          ) : puzzles.length === 0 ? (
            <p className="text-subtle px-3 py-3 text-xs">
              {history.length === 0 ? 'No attempts yet — go solve something.' : 'Nothing matches this filter.'}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {puzzles.slice(0, 200).map((h) => (
                <li key={h.id} className="border-line border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => navigate('puzzles', 'id', h.id)}
                    title={`Replay puzzle #${h.id}`}
                    className="hover:bg-surface-2 flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors duration-100"
                  >
                    {h.win ? (
                      <Check className="text-good size-3.5 shrink-0" aria-label="solved" />
                    ) : (
                      <X className="text-bad size-3.5 shrink-0" aria-label="failed" />
                    )}
                    <span className="text-fg font-mono">#{h.id}</span>
                    <span className="text-subtle font-mono tabular-nums">{h.puzzleRating}</span>
                    {!h.win && (
                      <span className="bg-surface-2 text-subtle rounded px-1.5 py-0.5 text-[0.625rem]">
                        to review
                      </span>
                    )}
                    <span className="text-subtle ml-auto tabular-nums" title={h.at}>
                      {when(h.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * Two-step confirm instead of a browser dialog: first click arms it, the
 * second (within 4 s) wipes counters + history. Everything about past
 * attempts is gone — including the review pool — so it stays deliberate.
 */
function ResetButton({ onDone }: { onDone: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const click = async (): Promise<void> => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    await fetch('/api/puzzles/reset', { method: 'POST' });
    onDone();
  };

  return (
    <Button
      variant={armed ? 'primary' : 'ghost'}
      size="sm"
      className={armed ? 'ml-auto' : 'text-subtle ml-auto'}
      title="Wipe attempts, history and the review pool"
      onClick={() => void click()}
    >
      <Trash2 className="size-3.5" />
      {armed ? 'Really reset everything?' : 'Reset'}
    </Button>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'bg-primary-soft text-primary rounded-md px-2 py-1 text-[0.6875rem] font-semibold'
          : 'text-muted hover:bg-surface-2 hover:text-fg rounded-md px-2 py-1 text-[0.6875rem] transition-colors duration-100'
      }
    >
      {label}
    </button>
  );
}

function StatCard({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-surface border-line flex items-center justify-between rounded-xl border px-3 py-2.5">
      <div>
        <div className="text-subtle text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
          {label}
        </div>
        <div className="text-fg font-mono text-xl font-bold tabular-nums">{value}</div>
      </div>
      {action}
    </div>
  );
}

/** "14:03" today, "Aug 6" earlier this year, "11/2/2025" before that.
    Locale pinned to English — the OS locale must not leak in (see lib/dates). */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US');
}
