import { BookMarked, Check, ChevronRight, Eraser, Eye, LayoutGrid, Puzzle, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '@/lib/router';
import { formatAgo, formatWhen } from '@/lib/dates';
import { Board } from '@/board/Board';
import { cn } from '@/lib/cn';
import { positionAt, solverColor, type ApiPuzzle } from './puzzle';
import { Button } from '@/ui/Button';
import { ChipRow } from '@/ui/ChipRow';
import { FilterChip } from '@/ui/FilterChip';
import { Panel, PanelHeader } from '@/ui/Panel';
import { ConfirmPopover } from '@/ui/ConfirmPopover';
import { ProgressBar } from '@/ui/ProgressBar';
import { SkeletonRows } from '@/ui/Skeleton';

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

/** Ratings are internal curation data — users see the band, not the number. */
const bandOf = (rating: number): string =>
  BANDS.find((b) => rating >= b.min && rating <= b.max)?.label ?? '—';

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

  // Hovering a row's eye pops the puzzle's starting position (after the
  // setup move, from the solver's side). Fetched lazily, cached by id.
  const [preview, setPreview] = useState<{
    fen: string;
    orientation: 'white' | 'black';
    top: number;
    left: number;
  } | null>(null);
  const puzzleCache = useRef<Map<string, ApiPuzzle>>(new Map());
  const previewSeq = useRef(0);
  const showPreview = async (id: string, anchor: Element): Promise<void> => {
    const seq = ++previewSeq.current;
    let cached = puzzleCache.current.get(id);
    if (!cached) {
      const res = await fetch(`/api/puzzles/by-id/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      cached = ((await res.json()) as { puzzle: ApiPuzzle }).puzzle;
      puzzleCache.current.set(id, cached);
    }
    if (seq !== previewSeq.current) return; // pointer moved on
    const rect = anchor.getBoundingClientRect();
    setPreview({
      fen: positionAt(cached, 1).fen,
      orientation: solverColor(cached),
      top: Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200),
      left: Math.max(rect.left - 192, 8),
    });
  };
  const hidePreview = (): void => {
    previewSeq.current += 1;
    previewFor.current = null;
    setPreview(null);
  };
  // Coarse pointers can't hover: the eye TAPS the preview open and a
  // second tap (or another row's) dismisses it.
  const previewFor = useRef<string | null>(null);
  const togglePreview = (id: string, anchor: Element): void => {
    if (previewFor.current === id) {
      hidePreview();
    } else {
      previewFor.current = id;
      void showPreview(id, anchor);
    }
  };
  const latestById = new Map<string, HistoryEntry>();
  const trained = new Set<string>();
  for (const h of history ?? []) {
    if (!latestById.has(h.id)) latestById.set(h.id, h);
    if (h.counted !== false) trained.add(h.id);
  }
  // Mirrors the server's pool rule: only trained puzzles are reviewable.
  const toReview = (h: HistoryEntry): boolean => !h.win && trained.has(h.id);
  const puzzles = [...latestById.values()].filter((h) => {
    if (resultFilter === 'solved' && !h.win) return false;
    if (resultFilter === 'review' && !toReview(h)) return false;
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
          <h1 className="text-fg text-base font-semibold">Puzzle dashboard</h1>
          <span className="min-w-0 flex-1" />
          <ResetButton onDone={refresh} />
        </div>

        {/* Phones land HERE from the Puzzles tab (the trainer is one more
            tap), so the three destinations get big, thumbable buttons.
            Desktop reaches them from the sidebar already. */}
        <div className="mb-4 grid grid-cols-3 gap-2 md:hidden">
          {(
            [
              ['Train', Puzzle, () => navigate('puzzles')],
              ['Books', BookMarked, () => navigate('puzzles', 'books')],
              ['Themes', LayoutGrid, () => navigate('puzzles', 'themes')],
            ] as const
          ).map(([label, Icon, go]) => (
            <button
              key={label}
              type="button"
              onClick={go}
              className="bg-surface border-line hover:bg-surface-2 flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition-colors"
            >
              <Icon className="text-primary size-5" />
              {label}
            </button>
          ))}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Solved" value={user ? String(user.wins) : '…'} />
          <StatCard
            label="Attempts"
            title="Training attempts only — review sessions don't count here, which is why this can differ from the review pool"
            value={user ? String(user.attempts) : '…'}
          />
          <StatCard label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
          <StatCard
            label="Failed"
            title="Distinct puzzles whose latest attempt failed — always the review pool"
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
                  <ProgressBar total={inBand.length} solved={wins} failed={losses} showEmpty />
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
                    <ProgressBar
                      total={b.puzzles}
                      solved={b.solved}
                      failed={b.failed}
                      className="w-24 shrink-0"
                    />
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
          <ChipRow className="border-line border-b px-3 py-2" innerClassName="gap-1">
            {(
              [
                ['all', 'All'],
                ['solved', 'Solved'],
                ['review', 'Failed'],
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
          </ChipRow>
          {history === null ? (
            <SkeletonRows rows={5} />
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
                    <span className="text-fg w-16 shrink-0 font-mono">#{h.id}</span>
                    <span className="text-subtle w-14 shrink-0">{bandOf(h.puzzleRating)}</span>
                    <Eye
                      className="text-subtle hover:text-fg ml-auto size-3.5 shrink-0"
                      aria-label="Preview the position"
                      onMouseEnter={(e) => {
                        if (!window.matchMedia('(pointer: coarse)').matches)
                          void showPreview(h.id, e.currentTarget);
                      }}
                      onMouseLeave={() => {
                        if (!window.matchMedia('(pointer: coarse)').matches) hidePreview();
                      }}
                      onClick={(e) => {
                        if (!window.matchMedia('(pointer: coarse)').matches) return;
                        e.stopPropagation();
                        togglePreview(h.id, e.currentTarget);
                      }}
                    />
                    <span
                      className="text-subtle w-16 shrink-0 text-right tabular-nums"
                      title={formatWhen(h.at)}
                    >
                      {formatAgo(h.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {preview && (
        <div
          style={{ top: preview.top, left: preview.left }}
          className={cn(
            'border-line bg-surface pointer-events-none fixed z-50 w-44 rounded-lg border p-1',
            'shadow-[var(--shadow-pop)]',
          )}
        >
          <Board
            fen={preview.fen}
            orientation={preview.orientation}
            viewOnly
            coordinates={false}
            className="rounded"
          />
        </div>
      )}
    </div>
  );
}

/** Wipes counters + history — including the review pool — behind an
    anchored confirm, so it stays deliberate without a browser dialog. */
function ResetButton({ onDone }: { onDone: () => void }) {
  return (
    <ConfirmPopover
      icon={Eraser}
      label="Reset"
      triggerTitle="Wipe attempts, history and the review pool"
      triggerClassName="text-subtle ml-auto"
      question="Wipe all attempts, history and the review pool?"
      confirmLabel="Wipe everything"
      onConfirm={() => {
        void fetch('/api/puzzles/reset', { method: 'POST' }).then(onDone);
      }}
    />
  );
}

function StatCard({
  label,
  value,
  title,
  action,
}: {
  label: string;
  value: string;
  title?: string;
  action?: React.ReactNode;
}) {
  return (
    <div title={title} className="bg-surface border-line flex items-center justify-between rounded-xl border px-3 py-2.5">
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

