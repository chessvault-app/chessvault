import { BookMarked, Check, ChevronRight, Eraser, RotateCcw, X } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { parseDashboardShape, storedDashboardShape } from './reservation';
import { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { navigate, up } from '@/lib/router';
import { formatAgo, formatUntil, formatWhen } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/list-row';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Select } from '@/components/ui/select';
import { Panel, PanelHeader } from '@/components/panel';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ProgressBar } from '@/components/progress-bar';
import { Skeleton, SkeletonRows } from '@/components/skeletons';
import { BANDS, bandOf } from './bands';
import { PreviewEye, usePuzzlePreview } from './PuzzlePreview';
import { describeTheme } from './ThemesPage';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';

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
  /** The puzzle's tags, joined in by the server when it has the database. */
  themes?: string[];
}

/** The server also sends a streak. The page does not read it: a streak
    is the gamified reading of consistency, which the app does not hand
    back (see docs/design-principles.md on ratings). */
interface MetaUser {
  attempts: number;
  wins: number;
}

interface BookSummary {
  slug: string;
  title: string;
  puzzles: number;
  solved: number;
  failed: number;
  /** Puzzles whose review date has come — see shared/review.ts. */
  due?: number;
}



/** See `reserved` below: the page's three variable blocks, last visit. */
const DASH_SHAPE_KEY = 'vault:puzzle-dash-shape';

/**
 * The empty Books panel's words, named once: the placeholder holds the
 * EmptyState's place by rendering the same words invisibly, and two
 * copies would wrap apart the day one was edited.
 */
const BOOKS_EMPTY_TITLE = 'No puzzle books yet';
const BOOKS_EMPTY_BODY =
  'Import a scanned tactics book and its diagrams become a solvable, progress-tracked set.';

type ResultFilter = 'all' | 'solved' | 'review';
type BandFilter = 'any' | (typeof BANDS)[number]['id'];

export function DashboardPage() {
  const [user, setUser] = useState<MetaUser | null>(null);
  const [failed, setFailed] = useState(0);
  // The review schedule's two numbers: how many puzzles are due for
  // another look now, and when the next one lands if none is.
  const [due, setDue] = useState(0);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  // Whether the history is really empty or merely failed to arrive: the
  // catch below settles `history` to [] so the page can render, and the
  // list's empty line has to know which of the two it is saying.
  const [historyFailed, setHistoryFailed] = useState(false);
  const [books, setBooks] = useState<BookSummary[] | null>(null);


  // What this device reserves for the three blocks whose shape the
  // answers decide, from what it saw last visit (puzzles/reservation.ts)
  // — a paint hint on home's bargain, corrected below. Read once; the
  // wait it stands through cannot change it.
  const [reserved] = useState(() => parseDashboardShape(localStorage.getItem(DASH_SHAPE_KEY)));

  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    // Three loads, one rule: a failure renders an empty page under an
    // error line, never a skeleton that spins forever with nothing to say.
    setError(null);
    setHistoryFailed(false);
    void api<{ user: MetaUser; failed?: number; due?: number; nextDue?: string | null }>(
      '/api/puzzles/meta',
    )
      .then((d) => {
        setUser(d.user);
        setFailed(d.failed ?? 0);
        setDue(d.due ?? 0);
        setNextDue(d.nextDue ?? null);
      })
      .catch((e: unknown) => setError(apiErrorMessage(e)));
    void api<{ attempts: HistoryEntry[] }>('/api/puzzles/history?limit=500')
      .then((d) => setHistory(d.attempts))
      .catch((e: unknown) => {
        setHistory((prev) => prev ?? []);
        setHistoryFailed(true);
        setError(apiErrorMessage(e));
      });
    void api<{ books: BookSummary[] }>('/api/puzzlebooks')
      .then((d) => setBooks(d.books))
      .catch(() => setBooks((prev) => prev ?? []));
  }, []);
  useEffect(() => refresh(), [refresh]);

  const counted = (history ?? []).filter((h) => h.counted !== false);

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

  // Remembered for the NEXT visit's reservation, above — only once all
  // three answers are in and none failed: an outage empties `history`
  // too, and recording that would hand next visit the floor at a vault
  // that has plenty. The attempts count is the unfiltered list's.
  useEffect(() => {
    if (error !== null || user === null || history === null || books === null) return;
    localStorage.setItem(
      DASH_SHAPE_KEY,
      storedDashboardShape({
        review: due > 0 || failed > 0 ? 'button' : nextDue ? 'note' : 'none',
        books: books.length,
        attempts: latestById.size,
      }),
    );
    // latestById is derived from history; keying on it is keying on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, user, history, books, due, failed, nextDue]);

  return (
    // `block`: this page spaces its sections with their own margins, not
    // the shell's column gap.
    <PageShell width="medium" className="block">
        {error && (
          <p className="text-destructive mb-3 text-sm" role="alert">
            {error}
          </p>
        )}
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

        {/* The card floor is zero below lg (panel.tsx): in the workspace
            column the phone's contextual bar ends the stack, and 16px
            of nothing stood under the last move row. These panels are
            cards on a scrolling page, ending in a bare figure list or
            band grid, so the floor comes back on a phone (lanph3re's
            report). Books and the log end in their own padded rows. */}
        <Panel className="mb-4 max-lg:[--card-floor:var(--card-spacing)]">
          <PanelHeader title={t('Training')} />
          {/* A figure list, not four cards. Each number used to be its own
              raised tile with its value at text-2xl in bold — the rung the
              type scale reserves for THE one display figure, spent four
              times in one row — and one of them was a "Win rate" percentage,
              which is a score. Four scores in 24px bold is a scoreboard, and
              a scoreboard is the one thing this page is not: these numbers
              are read beside the band table and the log below them, not
              beaten.

              The dl is the app's own idiom for facts about a thing — the
              same grid the trainer's finished-puzzle panel uses. Two pairs
              to a row from sm, one below it. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-(--card-spacing) text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
            <Figure
              label={t('Attempts')}
              title={t("Training attempts only. Review sessions are not counted, so this can differ from the review pool.")}
              value={user ? String(user.attempts) : '…'}
            />
            <Figure label={t('Solved')} value={user ? String(user.wins) : '…'} />
            {/* No solve rate. It was "win rate" once, renamed because
                nothing here is won, and then dropped because a percentage
                of your own attempts is still a score handed back to the
                person who made them, which the app does not do (see
                docs/design-principles.md on ratings). Solved and Failed
                say the same thing as counts. */}
            <Figure
              // "To review", not "Failed": the number is the review pool's
              // size, which the tooltip already said, and "Failed 10"
              // beside "Solved 21" in the same weight read as a grade.
              label={t('To review')}
              title={t('Puzzles whose latest attempt failed. This is the review pool.')}
              value={String(failed)}
            />
          </dl>
        </Panel>

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
          // The slot settles as one of four shapes, and the place held
          // is the one this device saw last visit: the button's box for
          // a vault with reviews waiting (h-8, h-9 under a coarse
          // pointer, where the real button grows too — it once held
          // 36px against 32), the note's one 20px line for a schedule
          // with nothing due, and nothing for a vault that has never
          // trained, which reserved the button for everyone and gave it
          // back.
          reserved.review === 'button' ? (
            <Skeleton className="mb-4 h-8 w-full rounded-lg pointer-coarse:h-9" />
          ) : reserved.review === 'note' ? (
            <div className="mb-4 flex h-5 items-center justify-center">
              <Skeleton className="h-2.5 w-64 max-w-full" />
            </div>
          ) : null
        ) : due > 0 ? (
          // The schedule has something waiting: lead with the due count,
          // which is the number that asks to be acted on today.
          <Button
            variant="secondary"
            size="default"
            className="mb-4 w-full justify-center"
            onClick={() => navigate('puzzles', 'failed')}
          >
            <RotateCcw className="size-3.5" data-icon="inline-start" />
            {t('Review puzzles · {n} due', { n: due })}
          </Button>
        ) : failed > 0 ? (
          <Button
            variant="secondary"
            size="default"
            className="mb-4 w-full justify-center"
            onClick={() => navigate('puzzles', 'failed')}
          >
            <RotateCcw className="size-3.5" data-icon="inline-start" />
            {t('Review failed puzzles')} · {failed}
          </Button>
        ) : nextDue ? (
          // Nothing to press, but the schedule is not empty: say when it
          // comes back, so an empty queue reads as earned rather than gone.
          <p className="text-muted-foreground mb-4 text-center text-sm">
            {t('Nothing due. The next review lands {when}', { when: formatUntil(nextDue) })}
          </p>
        ) : null}

        <Panel className="mb-4 max-lg:[--card-floor:var(--card-spacing)]">
          {/* The unit is in the title. This panel counts attempts, the
              log below counts puzzles, and the two agreed on "30" in the
              demo only because nobody there had replayed anything; the
              first real vault where they differ read as a bug, and the
              tooltip that explained it lived on hover, which a phone has
              not got. */}
          <PanelHeader title={t('Attempts by difficulty')} />
          <div className="grid gap-2.5 px-(--card-spacing)">
            {BANDS.map((band) => {
              const inBand = counted.filter(
                (h) => h.puzzleRating >= band.min && h.puzzleRating <= band.max,
              );
              const wins = inBand.filter((h) => h.win).length;
              const losses = inBand.length - wins;
              return (
                <div key={band.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                  <span className="text-muted-foreground text-sm">{t(band.label)}</span>
                  <ProgressBar total={inBand.length} solved={wins} failed={losses} showEmpty />
                  <span className="text-muted-foreground w-16 text-right font-mono text-xs tabular-nums">
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
              <Panel className="mb-4">
                {/* The title is known before the answer is; only the
                    shelf button and the rows are waited for. */}
                <PanelHeader
                  title={t('Books')}
                  actions={<Skeleton className="h-7 w-16 rounded-md pointer-coarse:h-9" />}
                />
                {/* One row per book this device saw last visit — and for
                    a vault that had none (or has never been seen), the
                    EmptyState's own shape, built from its primitives
                    with the real words drawn invisibly: the empty panel
                    is TALLER than the three rows this used to reserve
                    for everyone, so the commonest case moved in the
                    wrong direction when the answer came. */}
                {reserved.books === 0 ? (
                  <Empty className="py-8">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Skeleton className="size-4 rounded-sm" />
                      </EmptyMedia>
                      <EmptyTitle className="relative w-full">
                        <span className="invisible">{t(BOOKS_EMPTY_TITLE)}</span>
                        <Skeleton className="absolute inset-y-0.5 left-1/2 w-32 max-w-full -translate-x-1/2" />
                      </EmptyTitle>
                      <EmptyDescription className="relative w-full">
                        <span className="invisible">{t(BOOKS_EMPTY_BODY)}</span>
                        <Skeleton className="absolute inset-x-0 inset-y-1" />
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      {/* The sm button's box, at about its label's width. */}
                      <Skeleton className="h-7 w-36 rounded-md pointer-coarse:h-9" />
                    </EmptyContent>
                  </Empty>
                ) : (
                  Array.from({ length: reserved.books }, (_, i) => (
                    <div
                      key={i}
                      className="border-border flex items-center gap-2.5 border-b px-3 py-(--row-py) last:border-b-0"
                    >
                      {/* A row of text-sm, whose line box is 20px — and the
                          padding is the density token, because the ListRow
                          this stands for reads it. Both were wrong in
                          opposite directions: 33px against the real 36. */}
                      <div className="flex h-5 min-w-0 flex-1 items-center">
                        <Skeleton className="h-2.5 w-2/5" />
                      </div>
                      <div className="flex h-5 shrink-0 items-center">
                        <Skeleton className="h-2.5 w-10" />
                      </div>
                      {/* The Progress track is h-1. */}
                      <Skeleton className="h-1 w-24 shrink-0 rounded-full" />
                      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                    </div>
                  ))
                )}
              </Panel>
            )
          : (
          <Panel className="mb-4">
            <PanelHeader
              title={t('Books')}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  title={t('All puzzle books')}
                  onClick={() => navigate('puzzles', 'books')}
                >
                  <BookMarked className="size-3.5" data-icon="inline-start" />
                  {t('Shelf')}
                </Button>
              }
            />
            {books.length === 0 ? (
              <EmptyState
                className="py-8"
                icon={BookMarked}
                title={BOOKS_EMPTY_TITLE}
                body={BOOKS_EMPTY_BODY}
                action={
                  <Button variant="default" size="sm" onClick={() => navigate('puzzles', 'books')}>
                    <BookMarked className="size-3.5" data-icon="inline-start" />
                    {t('Import a book')}
                  </Button>
                }
              />
            ) : (
            <ul>
              {books.map((b) => (
                <li key={b.slug} className="border-border border-b last:border-b-0">
                  {/* The hairline is on the li, so the row itself is undivided. */}
                  <ListRow
                    onClick={() => navigate('puzzles', 'books', b.slug)}
                    className="text-sm"
                  >
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">{b.title}</span>
                    {(b.due ?? 0) > 0 && (
                      <span className="text-info shrink-0 text-xs">{t('{n} due', { n: b.due! })}</span>
                    )}
                    <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
                      {b.solved}/{b.puzzles}
                    </span>
                    <ProgressBar
                      total={b.puzzles}
                      solved={b.solved}
                      failed={b.failed}
                      className="w-24 shrink-0"
                    />
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                </li>
              ))}
            </ul>
            )}
          </Panel>
        )}

        <Panel>
          <PanelHeader
            title={history === null ? t('Puzzles') : t('{n} puzzles', { n: puzzles.length })}
            // The failed list's own way onward. Filtered to the puzzles
            // that went wrong, the panel was a column of red marks and
            // nothing else, with the review button 500px above it: the
            // one view a solver comes here to act on ended without an
            // action. Same destination as the slot at the top.
            actions={
              resultFilter === 'review' && puzzles.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => navigate('puzzles', 'failed')}>
                  <RotateCcw className="size-3.5" data-icon="inline-start" />
                  {t('Review')}
                </Button>
              ) : undefined
            }
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
          <div className="border-border flex items-center gap-1.5 border-b px-3 py-2">
            <Select
              value={resultFilter}
              onValueChange={(v) => setResultFilter(v as ResultFilter)}
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
              onValueChange={(v) => setBandFilter(v as BandFilter)}
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
            // As many rows as this device saw, inside the list's own
            // 384px ceiling so a full vault's reservation cannot stand
            // taller than the scroller it reserves — and the one-line
            // note's box for a vault that had no attempts, where five
            // invented rows were the jump in the other direction.
            reserved.attempts === 0 ? (
              <div className="px-3 py-3">
                <div className="flex h-5 items-center">
                  <Skeleton className="h-2.5 w-56 max-w-full" />
                </div>
              </div>
            ) : (
              <div className="max-h-96 overflow-hidden">
                <SkeletonRows rows={reserved.attempts} />
              </div>
            )
          ) : puzzles.length === 0 ? (
            // An outage is not an empty vault: told "No attempts yet", a
            // player on a phone with a flaky link would read that they
            // have never trained. The failure names itself instead.
            <p className="text-muted-foreground px-3 py-3 text-sm">
              {t(
                historyFailed && history.length === 0
                  ? 'Could not load the attempts.'
                  : history.length === 0
                    ? 'No attempts yet. Go solve something.'
                    : resultFilter === 'review'
                      ? 'Nothing to review.'
                      : 'Nothing matches this filter.',
              )}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {/* The row and its eye are siblings: the eye is a button
                  and a button cannot sit inside the row's. The row keeps
                  its left padding and gives its right edge to the eye,
                  which the li pads instead. */}
              {puzzles.slice(0, 200).map((h) => (
                <li key={h.id} className="border-border flex items-center border-b pr-1.5 last:border-b-0">
                  <ListRow
                    dense
                    onClick={() => navigate('puzzles', 'id', h.id)}
                    title={t('Replay puzzle #{id}', { id: h.id })}
                    className="min-w-0 flex-1 pr-1.5 text-sm"
                  >
                    {h.win ? (
                      <Check className="text-good size-3.5 shrink-0" role="img" aria-label={t('solved')} />
                    ) : (
                      <X className="text-destructive size-3.5 shrink-0" role="img" aria-label={t('failed')} />
                    )}
                    {/* The puzzle's name is its motif ("Fork", "Back rank
                        mate"), which is what a solver remembers; the id
                        meant nothing to anyone and now lives in the row's
                        title, where Replay still quotes it. The id stays
                        on screen only when the database is not there to
                        answer for the themes. */}
                    <span className="text-foreground w-28 shrink-0 truncate">
                      {describeTheme(h.themes ?? []) ?? <span className="font-mono">#{h.id}</span>}
                    </span>
                    <span className="text-muted-foreground w-14 shrink-0">{t(bandOf(h.puzzleRating))}</span>
                    <span
                      className="text-muted-foreground ml-auto w-20 shrink-0 whitespace-nowrap text-right tabular-nums"
                      title={formatWhen(h.at)}
                    >
                      {formatAgo(h.at)}
                    </span>
                  </ListRow>
                  <PreviewEye eye={preview.eyeProps(h.id)} />
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
    <ConfirmDialog
      icon={Eraser}
      triggerTone="danger"
      label={t('Reset')}
      triggerTitle="Wipe attempts, history and the review pool"
      // Position only. A colour here would land AFTER the variant in
      // cn() and win: text-muted-foreground was doing exactly that, which is why
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

/**
 * One labelled number in the training panel's figure list.
 *
 * A fragment of two grid items rather than a box of its own, so labels and
 * values line up in columns down the whole list — which is what makes it
 * read as a spec sheet instead of a row of tiles.
 *
 * The title goes on BOTH halves: a `display: contents` wrapper would
 * generate no box for a tooltip to hang off, and the value is as likely a
 * hover target as the label.
 */
function Figure({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <>
      {/* One tip per element rather than one round both: dt and dd are
          siblings under a fragment, and a tooltip needs an element to
          stand against. Pointing at either half of the pair answers. */}
      <TitleTip title={title}>
        <dt className="text-muted-foreground">{label}</dt>
      </TitleTip>
      <TitleTip title={title}>
        <dd className="text-foreground font-mono tabular-nums">{value}</dd>
      </TitleTip>
    </>
  );
}

