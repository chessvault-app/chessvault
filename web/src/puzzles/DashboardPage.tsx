import { BookMarked, Check, ChevronRight, Eraser, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { navigate, up } from '@/lib/router';
import { formatAgo, formatWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { ListRow } from '@/ui/ListRow';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { Select } from '@/ui/Select';
import { Panel, PanelHeader } from '@/ui/Panel';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { ProgressBar } from '@/ui/ProgressBar';
import { Skeleton, SkeletonRows } from '@/ui/Skeleton';
import { BANDS, bandOf } from './bands';
import { PreviewEye, usePuzzlePreview } from './PuzzlePreview';
import { t } from '@/lib/i18n';

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



type ResultFilter = 'all' | 'solved' | 'review';
type BandFilter = 'any' | (typeof BANDS)[number]['id'];

export function DashboardPage() {
  const [user, setUser] = useState<MetaUser | null>(null);
  const [failed, setFailed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [books, setBooks] = useState<BookSummary[] | null>(null);


  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    // Three loads, one rule: a failure renders an empty page under an
    // error line, never a skeleton that spins forever with nothing to say.
    setError(null);
    void api<{ user: MetaUser; failed?: number }>('/api/puzzles/meta')
      .then((d) => {
        setUser(d.user);
        setFailed(d.failed ?? 0);
      })
      .catch((e: unknown) => setError(apiErrorMessage(e)));
    void api<{ attempts: HistoryEntry[] }>('/api/puzzles/history?limit=500')
      .then((d) => setHistory(d.attempts))
      .catch((e: unknown) => {
        setHistory((prev) => prev ?? []);
        setError(apiErrorMessage(e));
      });
    void api<{ books: BookSummary[] }>('/api/puzzlebooks')
      .then((d) => setBooks(d.books))
      .catch(() => setBooks((prev) => prev ?? []));
  }, []);
  useEffect(() => refresh(), [refresh]);

  const counted = (history ?? []).filter((h) => h.counted !== false);
  const winRate = user && user.attempts > 0 ? Math.round((100 * user.wins) / user.attempts) : null;

  // The puzzle list shows each puzzle ONCE, judged by its latest attempt
  // (history arrives newest-first). Filters cut by outcome and rating band.
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [bandFilter, setBandFilter] = useState<BandFilter>('any');

  // The eye on each row, and the board it pops. Shared with the hub's
  // recent rows — see PuzzlePreview.
  const preview = usePuzzlePreview();

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
    // `block`: this page spaces its sections with their own margins, not
    // the shell's column gap.
    <PageShell width="medium" className="block">
        {error && <p className="text-bad mb-3 text-sm">{error}</p>}
        {/* This page carried a phone-only row of Train/Books/Themes
            buttons, from when the Puzzles tab landed here and it had to
            double as the hub. It is a launcher now (#/puzzles/hub), where
            those buttons sit within reach of a thumb instead of pinned to
            the top of a page of statistics — so a phone arrives from
            there and leaves by the chevron. */}
        <PageHeader
          className="mb-4"
          title={t('Puzzle dashboard')}
          back={() => up('puzzles', 'hub')}
          actions={<ResetButton onDone={refresh} />}
        />

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label={t('Solved')} value={user ? String(user.wins) : '…'} />
          <StatCard
            label={t('Attempts')}
            title={t("Training attempts only — review sessions don't count here, which is why this can differ from the review pool")}
            value={user ? String(user.attempts) : '…'}
          />
          <StatCard label={t('Win rate')} value={winRate === null ? '—' : `${winRate}%`} />
          <StatCard
            label={t('Failed')}
            title={t('Distinct puzzles whose latest attempt failed — always the review pool')}
            value={String(failed)}
          />
        </div>

        {/* The review queue, promoted: it was a 14px icon inside the
            Failed card — the one training action this page should be
            offering, hidden in the one place nobody pressed. */}
        {/* The count comes from /api/puzzles/meta, so before it answers
            this page cannot know whether the button belongs here — and it
            used to resolve that by drawing nothing, then pushing every
            panel below it down by 36px and a margin when the answer came.
            Its place is held instead. A vault with nothing failed gives
            the place up, which is the one case nothing can predict. */}
        {user === null ? (
          <Skeleton className="mb-4 h-9 w-full rounded-lg" />
        ) : failed > 0 ? (
          <Button
            variant="secondary"
            size="md"
            className="mb-4 w-full justify-center"
            onClick={() => navigate('puzzles', 'failed')}
          >
            <RotateCcw className="size-3.5" />
            {t('Review failed puzzles')} · {failed}
          </Button>
        ) : null}

        <Panel flush className="mb-4">
          <PanelHeader title={t('By difficulty')} />
          <div className="grid gap-2.5 p-3">
            {BANDS.map((band) => {
              const inBand = counted.filter(
                (h) => h.puzzleRating >= band.min && h.puzzleRating <= band.max,
              );
              const wins = inBand.filter((h) => h.win).length;
              const losses = inBand.length - wins;
              return (
                <div key={band.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                  <span className="text-muted text-sm">{t(band.label)}</span>
                  <ProgressBar total={inBand.length} solved={wins} failed={losses} showEmpty />
                  <span className="text-subtle w-16 text-right font-mono text-xs tabular-nums">
                    {inBand.length > 0 ? `${wins}/${inBand.length}` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Drawn from the first paint rather than behind useSlowLoad.
            The threshold is right for content APPEARING INSIDE a block
            that is already on the page — nothing moves, so a wait too
            short to notice is best not mentioned. This is a whole panel,
            and once the shelf answers it is always there in one form or
            another, so the choice is not flash-or-nothing but flash-or-
            SHOVE: held back, its place did not exist and everything below
            it jumped when it took one. A placeholder that is replaced in
            30ms moves nothing, and this panel answers separately from the
            page around it, which renders at once. */}
        {books === null
          ? (
              <Panel flush className="mb-4">
                {/* The title is known before the answer is; only the
                    shelf button and the rows are waited for. */}
                <PanelHeader
                  title={t('Books')}
                  actions={<Skeleton className="h-6 w-16 rounded-md" />}
                />
                {Array.from({ length: 3 }, (_, i) => (
                  <div
                    key={i}
                    className="border-line flex items-center gap-2.5 border-b px-3 py-2 last:border-b-0"
                  >
                    {/* A row of text-sm, whose line box is 16px. */}
                    <div className="flex h-4 min-w-0 flex-1 items-center">
                      <Skeleton className="h-2.5 w-2/5" />
                    </div>
                    <div className="flex h-4 shrink-0 items-center">
                      <Skeleton className="h-2.5 w-10" />
                    </div>
                    <Skeleton className="h-1.5 w-24 shrink-0 rounded-full" />
                    <Skeleton className="size-3.5 shrink-0 rounded" />
                  </div>
                ))}
              </Panel>
            )
          : (
          <Panel flush className="mb-4">
            <PanelHeader
              title={t('Books')}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  title={t('All puzzle books')}
                  onClick={() => navigate('puzzles', 'books')}
                >
                  <BookMarked className="size-3.5" />
                  {t('Shelf')}
                </Button>
              }
            />
            {books.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                <BookMarked className="text-subtle size-6" strokeWidth={1.5} />
                <p className="text-muted max-w-xs text-sm leading-relaxed">
                  {t(
                    'No puzzle books yet. Import a scanned tactics book and its diagrams become a solvable, progress-tracked set.',
                  )}
                </p>
                <Button variant="primary" size="sm" onClick={() => navigate('puzzles', 'books')}>
                  <BookMarked className="size-3.5" />
                  {t('Import a book')}
                </Button>
              </div>
            ) : (
            <ul>
              {books.map((b) => (
                <li key={b.slug} className="border-line border-b last:border-b-0">
                  {/* The hairline is on the li, so the row itself is undivided. */}
                  <ListRow
                    onClick={() => navigate('puzzles', 'books', b.slug)}
                    className="text-sm"
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
                  </ListRow>
                </li>
              ))}
            </ul>
            )}
          </Panel>
        )}

        <Panel flush>
          <PanelHeader
            title={history === null ? t('Puzzles') : `${t('Puzzles')} · ${puzzles.length}`}
          />
          {/*
            Two menus, not two runs of pills in one row.
            Outcome and difficulty are separate questions, and as chips
            they were nine controls on one line separated by a hairline —
            with two lit at once and nothing to say which lit chip
            belonged to which question. A menu names its own subject
            ("Status: Solved"), so the row reads as two answers instead of
            nine buttons. `steady` keeps each from resizing as it is
            changed and shoving the other along the row.
          */}
          <div className="border-line flex items-center gap-1.5 border-b px-3 py-2">
            <Select
              value={resultFilter}
              onChange={(v) => setResultFilter(v as ResultFilter)}
              ariaLabel={t('Filter by outcome')}
              size="sm"
              prefix="Status"
              steady
              groups={[
                {
                  options: [
                    { value: 'all', label: 'All' },
                    { value: 'solved', label: 'Solved' },
                    { value: 'review', label: 'Failed' },
                  ],
                },
              ]}
            />
            <Select
              value={bandFilter}
              onChange={(v) => setBandFilter(v as BandFilter)}
              ariaLabel={t('Filter by difficulty')}
              size="sm"
              prefix="Difficulty"
              steady
              groups={[
                {
                  options: [
                    { value: 'any', label: 'Any' },
                    ...BANDS.map((b) => ({ value: b.id, label: b.label })),
                  ],
                },
              ]}
            />
          </div>
          {/* Drawn at once, not behind useSlowLoad: these rows ARE the
              panel's height, so holding them back left a panel of a
              header and a filter row that grew a fifth of a second later.
              The threshold is for content that can appear without moving
              anything, which this is not. */}
          {history === null ? (
            <SkeletonRows rows={5} />
          ) : puzzles.length === 0 ? (
            <p className="text-subtle px-3 py-3 text-sm">
              {t(
                history.length === 0
                  ? 'No attempts yet — go solve something.'
                  : 'Nothing matches this filter.',
              )}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {puzzles.slice(0, 200).map((h) => (
                <li key={h.id} className="border-line border-b last:border-b-0">
                  <ListRow
                    dense
                    onClick={() => navigate('puzzles', 'id', h.id)}
                    title={t('Replay puzzle #{id}', { id: h.id })}
                    className="text-sm"
                  >
                    {h.win ? (
                      <Check className="text-good size-3.5 shrink-0" aria-label={t('solved')} />
                    ) : (
                      <X className="text-bad size-3.5 shrink-0" aria-label={t('failed')} />
                    )}
                    <span className="text-fg w-16 shrink-0 font-mono">#{h.id}</span>
                    <span className="text-subtle w-14 shrink-0">{t(bandOf(h.puzzleRating))}</span>
                    {/* ml-auto is this list's own layout, not the eye's. */}
                    <PreviewEye eye={preview.eyeProps(h.id)} className="ml-auto" />
                    <span
                      className="text-subtle w-20 shrink-0 whitespace-nowrap text-right tabular-nums"
                      title={formatWhen(h.at)}
                    >
                      {formatAgo(h.at)}
                    </span>
                  </ListRow>
                </li>
              ))}
            </ul>
          )}
        </Panel>

      {preview.layer}
    </PageShell>
  );
}

/** Wipes counters + history — including the review pool — behind an
    anchored confirm, so it stays deliberate without a browser dialog. */
function ResetButton({ onDone }: { onDone: () => void }) {
  return (
    <ConfirmSheet
      icon={Eraser}
      triggerTone="danger"
      label={t('Reset')}
      triggerTitle="Wipe attempts, history and the review pool"
      // Position only. A colour here would land AFTER the variant in
      // cn() and win: text-subtle was doing exactly that, which is why
      // the one button meant to read as destructive was grey.
      triggerClassName="ml-auto"
      question="Wipe all attempts, history and the review pool?"
      confirmLabel={t('Wipe everything')}
      onConfirm={() => {
        // Refresh either way: the reload shows what the wipe really did.
        void api('/api/puzzles/reset', { method: 'POST' })
          .catch(() => {})
          .finally(onDone);
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
        <div className="text-subtle text-xs font-semibold uppercase tracking-[0.08em]">
          {label}
        </div>
        <div className="text-fg font-mono text-2xl font-bold tabular-nums">{value}</div>
      </div>
      {action}
    </div>
  );
}

