import { BookMarked, Check, ChevronRight, Eraser, Puzzle, RotateCcw, X } from 'lucide-react';
import { parseDashboardShape, storedDashboardShape } from './reservation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
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
 * line's place by rendering the same words invisibly, and two copies
 * would wrap apart the day one was edited.
 */
const BOOKS_EMPTY = 'No puzzle books yet. Import a scanned tactics book and its diagrams become a solvable, progress-tracked set.';

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
  // Same for the meta call, which the review slot and the To review
  // figure wait on: without it a failed answer left the slot a skeleton
  // for ever and the figure at a zero it had not been told.
  const [metaFailed, setMetaFailed] = useState(false);
  // And for the shelf: settled to [] so the page renders, the Books
  // panel drew its empty state, "No puzzle books yet" with an Import
  // button, over a vault that has books, during an outage.
  const [booksFailed, setBooksFailed] = useState(false);
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
    setMetaFailed(false);
    setBooksFailed(false);
    void api<{ user: MetaUser; failed?: number; due?: number; nextDue?: string | null }>(
      '/api/puzzles/meta',
    )
      .then((d) => {
        setUser(d.user);
        setFailed(d.failed ?? 0);
        setDue(d.due ?? 0);
        setNextDue(d.nextDue ?? null);
      })
      .catch((e: unknown) => {
        setMetaFailed(true);
        setError(apiErrorMessage(e));
      });
    void api<{ attempts: HistoryEntry[] }>('/api/puzzles/history?limit=500')
      .then((d) => setHistory(d.attempts))
      .catch((e: unknown) => {
        setHistory((prev) => prev ?? []);
        setHistoryFailed(true);
        setError(apiErrorMessage(e));
      });
    void api<{ books: BookSummary[] }>('/api/puzzlebooks')
      .then((d) => setBooks(d.books))
      .catch(() => {
        setBooks((prev) => prev ?? []);
        setBooksFailed(true);
      });
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

  // Whether the log's well has rows below its edge, for the fade at the
  // bottom of it. Read on scroll and once the rows are in; a list that
  // fits has nothing to fade.
  const wellRef = useRef<HTMLUListElement>(null);
  const [wellMore, setWellMore] = useState(false);
  const [wellAbove, setWellAbove] = useState(false);
  const readWell = useCallback(() => {
    const el = wellRef.current;
    if (!el) return;
    setWellMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    setWellAbove(el.scrollTop > 1);
  }, []);
  // After every render: the rows this reads are the render's own.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(readWell);

  // One Tab stop for the whole log. Thirty rows and thirty eyes were
  // sixty stops between the filters and the wipe under them, and a
  // filtered list of two hundred would be four hundred. The first row
  // is the stop; the arrows move between rows, Right reaches a row's
  // eye and Left comes back, Home and End jump. The row last focused
  // keeps the stop, so Shift+Tab returns to where the reader was.
  const [logStop, setLogStop] = useState(0);
  const onLogKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement;
    const li = target.closest('li');
    const ul = e.currentTarget;
    if (!li) return;
    const rows = [...ul.querySelectorAll<HTMLLIElement>(':scope > li:has(button)')];
    const i = rows.indexOf(li as HTMLLIElement);
    if (i < 0) return;
    const rowButton = (n: number) => rows[n]?.querySelector<HTMLButtonElement>('button');
    const eye = li.querySelector<HTMLButtonElement>('button[aria-label]');
    const onEye = target === eye;
    let next: HTMLButtonElement | null | undefined;
    if (e.key === 'ArrowDown') next = rowButton(Math.min(i + 1, rows.length - 1));
    else if (e.key === 'ArrowUp') next = rowButton(Math.max(i - 1, 0));
    else if (e.key === 'Home') next = rowButton(0);
    else if (e.key === 'End') next = rowButton(rows.length - 1);
    else if (e.key === 'ArrowRight' && !onEye) next = eye;
    else if (e.key === 'ArrowLeft' && onEye) next = rowButton(i);
    if (!next) return;
    e.preventDefault();
    next.focus();
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

  // Remembered for the NEXT visit's reservation, above — only once all
  // three answers are in and none failed: an outage empties `history`
  // too, and recording that would hand next visit the floor at a vault
  // that has plenty. The attempts count is the unfiltered list's.
  useEffect(() => {
    if (error !== null || user === null || history === null || books === null) return;
    localStorage.setItem(
      DASH_SHAPE_KEY,
      storedDashboardShape({
        review: due > 0 || failed > 0 || !nextDue ? 'button' : 'note',
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
          // The line says what failed and the button beside it is the way
          // back: a phone on a flaky link used to be left with a red
          // sentence and a reload.
          <p className="text-destructive mb-3 flex items-center gap-3 text-sm" role="alert">
            <span className="min-w-0 flex-1">{error}</span>
            {/* Once, not twice: when the meta failed the slot below holds
                the retry, 40px from here, and this line is the sentence. */}
            {!metaFailed && (
              <Button variant="secondary" size="sm" onClick={refresh}>
                <RotateCcw className="size-3.5" data-icon="inline-start" />
                {t('Try again')}
              </Button>
            )}
          </p>
        )}
        {/* This page carried a phone-only row of Train/Books/Themes
            buttons, from when the Puzzles tab landed here and it had to
            double as the hub. It is a launcher now (#/puzzles/hub), where
            those buttons sit within reach of a thumb instead of pinned to
            the top of a page of statistics — so a phone arrives from
            there and leaves by the chevron. */}
        <PageHeader className="mb-4" title={t('Puzzle dashboard')} back={() => up('puzzles', 'hub')} />

        {/* First on the page, above the figures. The one action this
            page offers used to sit under the Training panel: on a phone
            that put it at 72% of the first screen, below the least
            actionable content on the page, and a solver opening the
            dashboard wants "what is due" before "how many I have done".
            The figures are context for the button, not the other way
            round. */}
        {/* The review queue, promoted: it was a 14px icon inside the
            Failed card — the one training action this page should be
            offering, hidden in the one place nobody pressed. It takes
            the page's one accent, the default variant: with Reset in
            red and this in grey, the destructive control outranked it. */}
        {/* The slot always holds a button now. It used to give its place
            up for a vault with nothing to review, and then the page had
            no way to start training: "Go solve something" was its own
            instruction, and the sub-navigation is Dashboard, Puzzle
            books and Themes. Nothing due means Train, not nothing.

            The count comes from /api/puzzles/meta, so before it answers
            this page cannot know which button belongs here; the box is
            the same for all three, and the one thing that varies, the
            note under Train for a schedule with nothing due, is what
            last visit's shape remembers. */}
        {user === null && metaFailed ? (
          // The answer is not coming. A skeleton here stood for ever
          // after an outage, with no button under it; the slot offers
          // the retry instead, in the same box.
          <Button variant="secondary" size="default" className="mb-4 w-full justify-center" onClick={refresh}>
            <RotateCcw className="size-3.5" data-icon="inline-start" />
            {t('Try again')}
          </Button>
        ) : user === null ? (
          // The button's box (h-8, h-9 under a coarse pointer, where the
          // real button grows too — it once held 36px against 32), and
          // under it the note's one 20px line when this device saw one.
          <div className="mb-4">
            <Skeleton className="h-8 w-full rounded-lg pointer-coarse:h-9" />
            {reserved.review === 'note' && (
              <div className="mt-2 flex h-5 items-center justify-center">
                <Skeleton className="h-2.5 w-64 max-w-full" />
              </div>
            )}
          </div>
        ) : due > 0 ? (
          // The schedule has something waiting: lead with the due count,
          // which is the number that asks to be acted on today.
          <Button
            variant="default"
            size="default"
            className="mb-4 w-full justify-center"
            onClick={() => navigate('puzzles', 'failed')}
          >
            <RotateCcw className="size-3.5" data-icon="inline-start" />
            {t('Review puzzles · {n} due', { n: due })}
          </Button>
        ) : failed > 0 ? (
          <Button
            variant="default"
            size="default"
            className="mb-4 w-full justify-center"
            onClick={() => navigate('puzzles', 'failed')}
          >
            <RotateCcw className="size-3.5" data-icon="inline-start" />
            {t('Review failed puzzles')} · {failed}
          </Button>
        ) : (
          <div className="mb-4">
            <Button
              variant="default"
              size="default"
              className="w-full justify-center"
              onClick={() => navigate('puzzles')}
            >
              <Puzzle className="size-3.5" data-icon="inline-start" />
              {t('Train')}
            </Button>
            {nextDue && (
              // The schedule is not empty: say when it comes back, so an
              // empty queue reads as earned rather than gone.
              <p className="text-muted-foreground mt-2 text-center text-sm">
                {t('Nothing due. The next review lands {when}', { when: formatUntil(nextDue) })}
              </p>
            )}
          </div>
        )}


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
              to a row from sm, one below it: Solved and To review share
              the first row, since together they are the puzzles, and
              Attempts, a different unit, takes the second. It used to
              lead, which paired it with Solved and left To review alone
              beside an empty cell. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-(--card-spacing) text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
            <Figure label={t('Solved')} value={user ? String(user.wins) : '…'} />
            {/* No solve rate. It was "win rate" once, renamed because
                nothing here is won, and then dropped because a percentage
                of your own attempts is still a score handed back to the
                person who made them, which the app does not do (see
                docs/design-principles.md on ratings). Solved and Failed
                say the same thing as counts. */}
            <Figure
              // "To review", not "Failed": the number is the review pool's
              // size, and "Failed 10" beside "Solved 21" in the same
              // weight read as a grade.
              label={t('To review')}
              // The same placeholder as its neighbours while the answer is
              // out: it read a live "0" beside two ellipses, and after an
              // outage a zero over a real pool.
              value={user ? String(failed) : '…'}
            />
            <Figure label={t('Attempts')} value={user ? String(user.attempts) : '…'} />
          </dl>
          {/* What the pool is, in the open. It was To review's tooltip,
              which a phone never sees, and the one sentence that ties
              the figure to the menu's option and the button's verb. */}
          <p className="text-muted-foreground mt-2 max-w-prose px-(--card-spacing) text-xs">
            {t('Puzzles whose latest attempt failed. This is the review pool.')}
          </p>
          {/* The sentence that reconciles Attempts with everything else
              on the page, in the open. It was the Attempts figure's
              tooltip, and a phone has no hover: "Attempts 30" over
              "30 puzzles" and "Solved 21, To review 9" did not add up
              to anyone who could not reach it. Said only once the two
              numbers actually differ: on a fresh vault it explained a
              discrepancy that did not exist, over three zeros. Held to a
              measure, since it ran 120 characters across a desktop card. */}
          {user !== null && history !== null && user.attempts !== latestById.size && (
            <p className="text-muted-foreground mt-2 max-w-prose px-(--card-spacing) text-xs">
              {t('Training attempts only. Review sessions are not counted, so this can differ from the review pool.')}
            </p>
          )}
        </Panel>

        <Panel className="mb-4 max-lg:[--card-floor:var(--card-spacing)]">
          {/* The unit is in the title. This panel counts attempts, the
              log below counts puzzles, and the two agreed on "30" in the
              demo only because nobody there had replayed anything; the
              first real vault where they differ read as a bug, and the
              tooltip that explained it lived on hover, which a phone has
              not got. */}
          <PanelHeader title={t('Attempts by difficulty')} />
          {/* A vault with nothing counted gets one line, not four empty
              tracks and four dashes: furniture with nothing on it, which
              is what a first visit saw. The grid stays while the answer
              is out, so nothing moves for the common case. */}
          {history !== null && !historyFailed && counted.length === 0 ? (
            <p className="text-muted-foreground px-(--card-spacing) text-sm">{t('Nothing attempted yet.')}</p>
          ) : (
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
                  {/* "11 of 17", not "11/17": a fraction beside a striped
                      bar read as a score, and nothing said the stripe
                      was the failed part. */}
                  <span className="text-muted-foreground w-16 text-right font-mono text-xs tabular-nums">
                    {inBand.length > 0 ? t('{a} of {b}', { a: wins, b: inBand.length }) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
          )}
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
                  title={t('Puzzle books')}
                  actions={<Skeleton className="h-7 w-28 rounded-md pointer-coarse:h-9" />}
                />
                {/* One row per book this device saw last visit — and for
                    a vault that had none (or has never been seen), the
                    empty line's own box, with the real words drawn
                    invisibly so it wraps where the line will. */}
                {reserved.books === 0 ? (
                  <p className="relative px-3 py-3 text-sm">
                    <span className="invisible">{t(BOOKS_EMPTY)}</span>
                    <Skeleton className="absolute inset-x-3 inset-y-4" />
                  </p>
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
            {/* "Puzzle books", as the navigation says: "Books" alone is
                the PDF shelf, a different page. */}
            <PanelHeader
              title={t('Puzzle books')}
              actions={
                // Named for where it goes. "Shelf" was the app's word for
                // a page the reader had not seen, and its own tooltip said
                // the better label.
                <Button variant="ghost" size="sm" onClick={() => navigate('puzzles', 'books')}>
                  <BookMarked className="size-3.5" data-icon="inline-start" />
                  {books.length === 0 && !booksFailed ? t('Import a book') : t('All puzzle books')}
                </Button>
              }
            />
            {booksFailed && books.length === 0 ? (
              // An outage is not an empty shelf. Same rung and words as
              // the log's own failure line.
              <p className="text-muted-foreground px-3 py-3 text-sm">{t('Could not load the puzzle books.')}</p>
            ) : books.length === 0 ? (
              // One line at the log's rung, not the centred icon, title,
              // sentence and button: that shape is the empty-state idiom
              // the design doc names as the anti-reference, and it stood
              // 240px tall on a page whose grammar is 33px rows. The
              // Import is the header's button while the shelf is empty.
              <p className="text-muted-foreground px-3 py-3 text-sm">{t(BOOKS_EMPTY)}</p>
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
                    {/* The bands' spelling, for the same reason: this sits
                        beside the same bar. */}
                    <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                      {t('{a} of {b}', { a: b.solved, b: b.puzzles })}
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
            // Filtered to the pool, the title says so. The header once
            // carried a Review button here too, but the slot at the top
            // of the page is the same verb to the same place, and two
            // controls for one act made the reader check whether they
            // differed.
            title={
              history === null || history.length === 0
                ? t('Puzzles')
                : resultFilter === 'review'
                  ? t('{n} puzzles to review', { n: puzzles.length })
                  : t('{n} puzzles', { n: puzzles.length })
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
          {/* No filters over nothing: a fresh vault drew two live menus
              above "No attempts yet", furniture with nothing to sort. */}
          {(history === null || history.length > 0) && (
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
                    // The figure's word, not "Failed": one pool had three
                    // names on the page (To review, Failed, Review), and
                    // a first visit could not tell they were one set.
                    { value: 'review', label: 'To review' },
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
                    { value: 'any', label: 'All' },
                    ...BANDS.map((b) => ({ value: b.id, label: b.label })),
                  ],
                },
              ]}
            />
          </div>
          )}
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
              <div className="lg:max-h-96 lg:overflow-hidden">
                <SkeletonRows rows={reserved.attempts} />
              </div>
            )
          ) : puzzles.length === 0 ? (
            // An outage is not an empty vault: told "No attempts yet", a
            // player on a phone with a flaky link would read that they
            // have never trained. The failure names itself instead.
            <p className="text-muted-foreground px-3 py-3 text-sm">
              <span className="min-w-0 flex-1">
                {t(
                  historyFailed && history.length === 0
                    ? 'Could not load the attempts.'
                    : history.length === 0
                      ? 'No attempts yet. Go solve something.'
                      : // "Nothing to review" is a verdict on the review
                        // pool, so it is said only when the pool alone was
                        // asked for: with a band on top, an empty list
                        // means the band is empty, not the pool.
                        resultFilter === 'review' && bandFilter === 'any'
                        ? 'Nothing to review.'
                        : 'Nothing matches this filter.',
                )}
              </span>
            </p>
          ) : (
            // The list scrolls inside itself only from lg, where the page
            // is a column of panels and a 384px well keeps the log from
            // being the whole of it. On a phone that well was a second
            // scroller inside the page's own, taller than the screen's
            // fold, capturing every flick: the page scrolls there and the
            // list is as long as it is.
            <ul
              ref={wellRef}
              onScroll={readWell}
              // A landmark a keyboard user can skip: the wipe under this
              // list was sixty Tab stops from the top of the page. And
              // one description for every row, since a row's purpose
              // lived only in its hover title.
              aria-label={t('Attempt log')}
              aria-describedby="puzzle-log-row-hint"
              onKeyDown={onLogKeyDown}
              className={cn(
                'lg:max-h-96 lg:overflow-y-auto',
                // The edge of the well. With overlay scrollbars nothing
                // said eighteen rows followed the twelfth, which the well
                // cut mid-line; the last 24px fade while there is more
                // below, and stop fading at the end so the last row is
                // whole. A mask, not a gradient laid over the rows, so
                // the rows under it stay clickable.
                // Both ends, each only while there is a row past it: the
                // bottom alone left the top row cut mid-glyph once the
                // well had been scrolled.
                wellMore && !wellAbove && 'lg:[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]',
                wellAbove && !wellMore && 'lg:[mask-image:linear-gradient(to_bottom,transparent,black_24px)]',
                wellAbove && wellMore && 'lg:[mask-image:linear-gradient(to_bottom,transparent,black_24px,black_calc(100%-24px),transparent)]',
              )}
            >
              {/* The row and its eye are siblings: the eye is a button
                  and a button cannot sit inside the row's. The row keeps
                  its left padding and gives its right edge to the eye,
                  which the li pads instead. */}
              {puzzles.slice(0, 200).map((h, i) => (
                <li key={h.id} className="border-border flex items-center border-b pr-1.5 last:border-b-0">
                  <ListRow
                    dense
                    onClick={() => navigate('puzzles', 'id', h.id)}
                    onFocus={() => setLogStop(i)}
                    tabIndex={i === logStop ? 0 : -1}
                    title={t('Replay puzzle #{id}', { id: h.id })}
                    aria-describedby="puzzle-log-row-hint"
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
                    {/* 8rem fits "Capturing defender" (122px); on a phone
                        the fixed columns then summed to 330px in a 316px
                        row and the date ran 4px under the eye, so the
                        name gives up a rem there. */}
                    <span className="text-foreground w-28 shrink-0 truncate sm:w-32">
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
                  {/* Reached by Right from its row, never by Tab. */}
                  <PreviewEye eye={preview.eyeProps(h.id)} tabIndex={-1} />
                </li>
              ))}
              {/* The cap, said. The list stops at 200 puzzles and the
                  history at 500 attempts, and neither used to say so: a
                  vault past either simply ended. */}
              {puzzles.length > 200 && (
                <li className="text-muted-foreground px-3 py-2 text-xs">
                  {t('Showing the latest {n}', { n: 200 })}
                </li>
              )}
            </ul>
          )}
          {/* The wipe lives under the log it wipes, last on the page and
              last in the tab order, with a word on it. It was the eraser
              alone in the page header: first thing Tab reached, and on
              a phone an unexplained icon beside the title. */}
          {history !== null && history.length > 0 && (
            <div className="border-border flex justify-end border-t px-3 py-2">
              <ResetButton attempts={user?.attempts ?? 0} review={failed} onDone={refresh} />
            </div>
          )}
        </Panel>

      {/* The rows' shared description, read after a row's name. */}
      <span id="puzzle-log-row-hint" className="sr-only">
        {t('Opens the puzzle to replay it. Arrow keys move between rows; Right reaches the position preview.')}
      </span>
      {preview.layer}
    </PageShell>
  );
}

/** Wipes counters + history — including the review pool — behind an
    anchored confirm, so it stays deliberate without a browser dialog.

    A quiet labelled button, not a red "Reset". It was the only
    coloured control on the page, and the eye landed on it before the
    review button, which was grey: the page's one training action
    outranked by its one destructive one. It sits on the ghost rung
    under the log, and the question it opens is as red as ever, and
    now says what it costs: the counts are the difference between a
    wipe someone meant and one they did not. */
function ResetButton({
  attempts,
  review,
  onDone,
}: {
  attempts: number;
  review: number;
  onDone: () => void;
}) {
  return (
    <ConfirmDialog
      icon={Eraser}
      triggerTone="quiet"
      label={t('Wipe history')}
      triggerTitle="Wipe attempts, history and the review pool"
      question={
        review > 0
          ? t('Wipe {a} attempts and the {r} puzzles waiting for review?', { a: attempts, r: review })
          : t('Wipe {a} attempts?', { a: attempts })
      }
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

