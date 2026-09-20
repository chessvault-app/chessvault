import { BarChart3, BookMarked, ChevronRight, LayoutGrid, RotateCcw } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { formatUntil } from '@/lib/dates';
import { useMediaQuery } from '@/lib/media';
import { INITIAL_FEN } from '@shared/tree';
import { Board } from '@/board/Board';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { Skeleton, useSlowLoad } from '@/components/skeletons';
import {
  HUB_BOARD_FILL,
  HUB_CARD_FILL,
  HUB_CARD_SHAPE,
  HUB_PLACE_SHAPE,
  HubPlaceRow,
  HubPlaces,
  HubPuzzleRow,
} from './PuzzlesView.skeleton';
import { t } from '@/lib/i18n';
import { DashboardPage } from './DashboardPage';
import { KingIcon } from '@/components/king-icon';
import { difficultyQuery, storedDifficulty, useDifficultyWord } from './bands';
import { setPendingPuzzle, type HandoffMode } from './handoff';
import { positionAt, solverColor, type ApiPuzzle } from './puzzle';
import { themeLabel } from './ThemesPage';
import { fetchSolvedToday } from './today';
import { turnOf } from '@/lib/fen';

/**
 * The phone's puzzle page: a launcher, and nothing else.
 *
 * The Puzzles tab used to land on the dashboard, which is stats and a
 * two-hundred-row attempt log — the page you consult occasionally,
 * opened every single time you reach for training. So this is the hub
 * the dashboard was being asked to be, and the dashboard goes back to
 * being a dashboard, one card away.
 *
 * Two kinds of card, and only two. Three PLACES to go (Themes, Puzzle
 * books, Dashboard), each carrying the one line that page would open
 * on — the theme worth practising, the book you were last in with its
 * bar, today's tally — and three PUZZLES to solve, each shown as its
 * own position: the next fresh one, the one you missed, the next in
 * your book. Pressing a puzzle opens that puzzle.
 *
 * There is no Train button. The first board IS the train button: it
 * hands over the very puzzle it shows (see `handoff.ts`), so a tile
 * beside it that opened the same puzzle was a second copy of the same
 * target (lanph3re's call, 2026-09-14). The history log and the shelf
 * row that used to sit above the boards went with it: the log is the
 * dashboard's, one card away, and the shelf is the Puzzle books card.
 * What they gave back is height, and the height goes into the boards.
 *
 * Nothing here waits on the network to be usable: every destination is
 * a plain link. What arrives late is drawn once, together (see ANSWERS).
 */
export function HubPage() {
  // A launcher would be a second copy of the sidebar on a desktop, which
  // lists Dashboard, Books and Themes under Puzzles already. So above the
  // phone width this route simply IS the dashboard — rendered rather than
  // redirected, because a redirect leaves an entry in the history that
  // Back would only bounce off again.
  //
  // The two halves are separate components on purpose: a resize across
  // the breakpoint must not change how many hooks this one ran.
  const phone = useMediaQuery('(max-width: 47.9375rem)');
  return phone ? <Hub /> : <DashboardPage />;
}

interface Meta {
  ready: boolean;
  failed?: number;
  /** The review schedule: puzzles due for another look now, and when the
      next one lands if none is (see reviewQueue(), server). */
  due?: number;
  nextDue?: string | null;
  /** The theme this vault loses most often — see weakestTheme(), server. */
  weakTheme?: WeakTheme | null;
}

interface WeakTheme {
  theme: string;
  attempts: number;
  wins: number;
}

interface BookSummary {
  slug: string;
  title: string;
  puzzles: number;
  solved: number;
  failed: number;
  cover?: boolean;
  /** When a puzzle in it was last attempted; null if never. */
  lastAt?: string | null;
}

/** The next puzzle in a book, from /puzzlebooks/:slug/next. No solution
    in it, deliberately — this is a board to look at and a place to go,
    not the answer to a puzzle nobody has attempted. */
interface BookNext {
  id: string;
  fen: string;
  number?: number;
}

/**
 * A puzzle offered as itself: the position on the left, what it is and
 * whose move on the right.
 *
 * The board thumbnail beside the words, rather than a full-width board
 * under them, is what lets three of these fit on a phone — and it is the
 * shape lichess's own puzzle tab uses, which is the reference lanph3re
 * gave. Pressing it hands the puzzle to the trainer (see `handoff.ts`)
 * so the position offered is the position that opens.
 *
 * The cards share the column's spare height (flex-1) and each board
 * takes its size from its card, so a taller phone simply shows bigger
 * boards. Capped at the board's own ceiling plus the card's padding: a
 * vault with one card and nothing else had that card absorb the whole
 * column. Past the cap the slack goes above the cluster (justify-end).
 */
// The floor is a board a position can be read off (84px, with the card's
// padding): below it the cards were squares of noise on a 568 phone. A
// screen that cannot hold three at the floor scrolls, which is the
// shell's escape hatch, rather than shrinking them past legibility.
/* The cards' height budget lives beside the outline that draws boxes
   against it too (puzzles/PuzzlesView.skeleton). */
const CARD_FILL = HUB_CARD_FILL;
const BOARD_FILL = HUB_BOARD_FILL;

function PuzzleCard({
  fen,
  side,
  title,
  detail,
  go,
}: {
  /** The position the solver faces, ready to draw. */
  fen: string;
  side: 'white' | 'black';
  title: string;
  detail?: string;
  go: () => void;
}) {
  return (
    <button
      type="button"
      onClick={go}
      // Tighter top and bottom than the sides: the board is square and
      // sets this row's height on its own, so vertical padding here is
      // slack around a shape that already has its own margins, while the
      // horizontal padding is still holding the text off the edge.
      className={cn(HUB_CARD_SHAPE, 'hover:bg-accent text-left transition-colors duration-100', CARD_FILL)}
    >
      <Board
        fen={fen}
        orientation={side}
        viewOnly
        coordinates={false}
        // The card has a definite height from the flex column it is in,
        // so the board takes that and its own aspect-square gives the
        // width — no size table, and it is always as big as the screen
        // can afford.
        className={cn('shrink-0 rounded-md', BOARD_FILL)}
      />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="text-foreground text-base font-medium">{title}</span>
        {detail && <span className="text-muted-foreground text-sm leading-snug">{detail}</span>}
        {/* Whose move — the one thing you cannot read off a thumbnail
            fast, and the thing lichess puts under every one of these.
            Deliberately NOT a flex row: `items-center` would centre the
            king's box on the line box, and a line box includes the
            descender space that the letters beside it do not use, so a
            box-centred glyph sits visibly low. Left as ordinary inline
            text, the king takes the baseline like a letter does. */}
        <span className="text-muted-foreground text-sm">
          <KingIcon side={side} className="mr-1.5" />
          {side === 'white' ? t('White to move') : t('Black to move')}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0 self-center" />
    </button>
  );
}

/**
 * A card-shaped slot with no position in it.
 *
 * The board's box is still there and still square, because the slot's SIZE
 * must not depend on what the draw found: the cards share the page's spare
 * height, so one that collapsed when it came back empty would resize every
 * board beside it. Same reason the blocks wait for each other (see
 * ANSWERS) — this is that rule applied to a single card.
 *
 * Actionable when there IS somewhere to go, which is how the pool-known-
 * but-draw-failed case still reaches the review queue.
 */
function EmptySlot({ title, detail, go }: { title: string; detail?: string; go?: () => void }) {
  const body = (
    <>
      {/* A real board at the starting position, not a placeholder box: the
          slot reads as a card either way, and a dashed outline in a column
          of boards is a hole in the page. Nothing to solve here, so it is
          the position before anything has happened. */}
      <Board fen={INITIAL_FEN} viewOnly coordinates={false} className={cn('shrink-0 rounded-md', BOARD_FILL)} />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="text-muted-foreground text-base font-medium">{title}</span>
        {detail && <span className="text-muted-foreground text-sm leading-snug">{detail}</span>}
      </span>
      {go && <ChevronRight className="text-muted-foreground size-4 shrink-0 self-center" />}
    </>
  );
  // PuzzleCard's geometry exactly; only the hover and the press differ.
  const shape = cn(HUB_CARD_SHAPE, 'text-left', CARD_FILL);
  return go ? (
    <button type="button" onClick={go} className={cn(shape, 'hover:bg-accent transition-colors duration-100')}>
      {body}
    </button>
  ) : (
    <div className={shape}>{body}</div>
  );
}

/**
 * A place to go, with the one line that page would open on.
 *
 * The three of these replaced a row of four tiles and two panels (the
 * attempt log and the "Recently read" shelf row). A tile said where it
 * went and nothing else; a panel said something about the vault and
 * was also, incidentally, a way there. This is both in one box: the
 * name, and under it what you would find — the theme worth practising,
 * the book you were last in with its bar, how today has gone.
 *
 * A fixed-height row, not a card that shares the slack: the boards
 * below are what the height is for. `children` is the detail line; a
 * bar and a count can ride in it, so it is a slot and not a string.
 */
function PlaceCard({
  icon: Icon,
  title,
  go,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  go: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={go}
      className={cn(HUB_PLACE_SHAPE, 'hover:bg-accent text-left transition-colors duration-100')}
    >
      {/* The 40px block the shelf row's cover used, so the three line up
          on one left edge with the covers they replaced. */}
      <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-md">
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-foreground text-base font-medium">{title}</span>
        {children}
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

/** The detail line's plain shape: one muted sentence, kept to one line. */
function PlaceDetail({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground truncate text-sm">{children}</span>;
}

/* The two placeholder rows this page drew moved beside the outline that
   stands in for the whole page while its chunk is on the wire
   (puzzles/PuzzlesView.skeleton, HubPlaceRow and HubPuzzleRow), with the
   cards' height budget. One picture over both waits, which is what every
   other section settled on; drawn in both places they could only be two
   statements of the same boxes. */

/**
 * One puzzle drawn ahead of time, for the board that offers it.
 *
 * The fresh draw asks the SAME question the trainer would (see
 * `difficultyQuery`). It must: this puzzle is handed to the trainer
 * rather than re-drawn there, so a hub that ignored the stored
 * difficulty would not merely mis-advertise — it would override a
 * setting the user chose, every time, with no way to tell. The server
 * answers the same question with the same puzzle until it is attempted
 * (see UserState.offered, server), so coming back here shows the board
 * you left.
 */
async function draw(mode: HandoffMode): Promise<ApiPuzzle | null> {
  try {
    const body = await api<{ puzzle: ApiPuzzle }>(
      `/api/puzzles/next${mode === 'failed' ? '?mode=failed' : difficultyQuery(storedDifficulty())}`,
    );
    return body.puzzle;
  } catch (e) {
    // 404 is an empty pool: a card not to draw. Anything else (the
    // network gone, the server down) is a card that could not be drawn,
    // which this used to fold into the same null, so an outage read as
    // "No puzzle to draw" and "No puzzle to review" over a full pool.
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** The page's answers, named, for the ones that did not come. */
type Answer = 'meta' | 'next' | 'review' | 'book';

/**
 * How many of the page's answers are still outstanding, counted down as
 * each settles — five requests, four of which decide what a card says.
 *
 * Everything shares ONE column of spare height, so a block that arrives
 * late does not appear beside the others: it resizes them. The boards
 * are what makes that visible. Chessground draws its squares and its
 * pieces to the size its box had when it mounted, and catches up on the
 * next frame — so a card landing a beat after the ones already on screen
 * leaves them drawn at the old size over the new box, pieces hanging
 * past the edge, until it does.
 *
 * So the blocks wait for each other and are drawn once, at the size they
 * are going to keep.
 */
const ANSWERS = 5;

/**
 * How long a gap with nothing in it is allowed to last before the page is
 * drawn with whatever has arrived.
 *
 * Idle, not total, and that is the whole point: it restarts every time an
 * answer lands, so a load whose answers keep coming waits for all of them
 * however slow the link, and the page goes up in one piece. A total
 * deadline could not tell a slow link from a stuck request, so it cut in
 * at two seconds on any phone having a bad minute and drew the page in
 * instalments as the rest caught up.
 *
 * Four seconds because it is now only reached by a request that has
 * genuinely stopped answering, and the placeholders it interrupts are
 * honest in the meantime.
 */
const IDLE_MS = 4000;

function Hub() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [solvedToday, setSolvedToday] = useState<number | null>(null);
  const [next, setNext] = useState<ApiPuzzle | null>(null);
  const [review, setReview] = useState<ApiPuzzle | null>(null);
  const [book, setBook] = useState<BookSummary | null>(null);
  const [bookNext, setBookNext] = useState<{ book: BookSummary; puzzle: BookNext } | null>(null);
  const [settled, setSettled] = useState(false);
  /**
   * Whether each card's own answer is in.
   *
   * `settled` says the page may be drawn; these say whether a given card
   * is missing because there is nothing to show or merely because nobody
   * has said yet. Without the difference a card that answered late was
   * drawn as absent and then appeared — which is the resize — and the
   * review slot claimed "no puzzle to review" before the draw had run.
   */
  const [nextIn, setNextIn] = useState(false);
  const [reviewIn, setReviewIn] = useState(false);
  const [bookIn, setBookIn] = useState(false);
  const [booksIn, setBooksIn] = useState(false);
  /**
   * Which answers failed, and what the first failure said. A card whose
   * answer failed is neither "in" nor "not yet": it is a third thing,
   * and it used to be drawn as the first (an empty vault) when the
   * request errored and as the second (a skeleton, for ever) when it
   * hung. The message goes on one line above the cards with the way to
   * go again; the amber is for an outage, red for a fault (ApiError).
   */
  const [unanswered, setUnanswered] = useState<Set<Answer>>(() => new Set());
  const [failure, setFailure] = useState<{ message: string; offline: boolean } | null>(null);
  // Bumped by Try again: the effect below runs once per value.
  const [attempt, setAttempt] = useState(0);
  const retry = (): void => {
    setUnanswered(new Set());
    setFailure(null);
    setNextIn(false);
    setReviewIn(false);
    setBookIn(false);
    setBooksIn(false);
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    /**
     * The count lives in the EFFECT, not in state, and a run that has been
     * cleaned up stops counting.
     *
     * It was a piece of state counted down from ANSWERS, which is wrong the
     * moment this effect runs twice against the same component — exactly
     * what StrictMode does in development. The answers then reported
     * against one counter twice over, it reached nought halfway through,
     * and the page drew itself while the rest were still arriving: the
     * very bug this gate exists to stop, reproduced by the gate.
     *
     * Per-run counting is idempotent under a double invoke — each run
     * settles on its own count — and `live` makes the abandoned run's
     * answers harmless. Only ever set TRUE, so a straggler cannot un-draw
     * a page.
     */
    let live = true;
    let left = ANSWERS;
    let idle: ReturnType<typeof setTimeout>;
    // The answers still out, by name, so the idle timer can say which
    // cards it is giving up on rather than leaving them as skeletons.
    const out = new Set<Answer>(['meta', 'next', 'review', 'book']);
    // An answer that lands after the idle timer gave up on it takes its
    // card back; the notice goes once nothing is outstanding (below).
    const ok = (which: Answer): void => {
      if (!live) return;
      setUnanswered((f) => {
        if (!f.has(which)) return f;
        const n = new Set(f);
        n.delete(which);
        return n;
      });
    };
    const fail = (which: Answer, e: unknown): void => {
      if (!live) return;
      setUnanswered((f) => new Set(f).add(which));
      setFailure(
        (f) =>
          f ?? {
            message: apiErrorMessage(e),
            offline: e instanceof ApiError && (e.offline || e.status === 0),
          },
      );
    };
    const arm = (): void => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (!live) return;
        // A request that has not answered by now is not going to be
        // waited for: the card it owed is drawn as not loaded, with the
        // way to ask again, and if it does land later it fills in.
        for (const which of out) fail(which, new ApiError(0, t('Vault server unreachable'), true));
        setSettled(true);
      }, IDLE_MS);
    };
    arm();
    // Called in a `finally`, always after the state it gates: the page is
    // drawn on the render that settles it, so an answer that reported
    // itself before storing its result would be drawn missing.
    const done = (which?: Answer): void => {
      if (!live) return;
      if (which) out.delete(which);
      left -= 1;
      if (left <= 0) {
        clearTimeout(idle);
        setSettled(true);
        return;
      }
      // Something arrived, so the wait is progressing rather than stuck.
      arm();
    };
    void (async () => {
      try {
        setMeta(await api<Meta>('/api/puzzles/meta'));
        ok('meta');
      } catch (e) {
        // Every card still works; only the review caption and the theme
        // line are missing.
        fail('meta', e);
      }
      done('meta');
    })();
    void fetchSolvedToday()
      .then((n) => {
        if (n !== null) setSolvedToday(n);
      })
      .finally(() => done());
    // The two boards. Drawn here rather than described, because a puzzle
    // page whose subject is nowhere on it is a menu about chess.
    void draw('fresh')
      .then((p) => {
        setNext(p);
        ok('next');
      })
      .catch((e: unknown) => fail('next', e))
      .finally(() => {
        if (live) setNextIn(true);
        done('next');
      });
    void draw('failed')
      .then((p) => {
        setReview(p);
        ok('review');
      })
      .catch((e: unknown) => fail('review', e))
      .finally(() => {
        if (live) setReviewIn(true);
        done('review');
      });
    void (async () => {
      try {
        const { books: all } = await api<{ books: BookSummary[] }>('/api/puzzlebooks');
        // Worked on most recently first; never-opened books keep the
        // server's alphabetical order behind them. Recency comes from the
        // server's `lastAt` (when a puzzle in it was last attempted, not
        // when the file changed), so the top row is where you left off.
        const [top] = all
            // An empty book is a shell waiting for an import, not
            // something to carry on with. It belongs on the shelf, where
            // it can be imported into; offering it here would be a row
            // whose progress bar can never move.
            .filter((b) => b.puzzles > 0)
            .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
        // The shelf has answered; the board for its top book is a second
        // request behind this one and has its own flag.
        if (live) setBooksIn(true);
        // Chained off this answer rather than fired alongside it, because
        // which book to ask about is the thing this request just decided.
        if (!top) {
          setBook(null);
          ok('book');
          return;
        }
        setBook(top);
        // 404 is a finished book, which is a card not to draw — api()
        // throws it into the same catch as everything else.
        const one = await api<{ puzzle: BookNext }>(
          `/api/puzzlebooks/${encodeURIComponent(top.slug)}/next`,
        );
        setBookNext({ book: top, puzzle: one.puzzle });
        ok('book');
      } catch (e) {
        // A finished book is a 404 from its /next, and a card not to
        // draw; anything else is the shelf not loading, which used to be
        // drawn as "No puzzle book yet" over a vault that has books.
        if (!(e instanceof ApiError && e.status === 404)) fail('book', e);
      }
      if (live) {
        // Covers a failure before the shelf answered at all.
        setBooksIn(true);
        setBookIn(true);
      }
      done('book');
    })();
    return () => {
      live = false;
      clearTimeout(idle);
    };
  }, [attempt]);

  // Assume the database is there until told otherwise: it is, for anyone
  // who has ever trained, and making everybody wait to find that out
  // would delay the one card this page exists for. A fresh vault sees
  // the slot correct itself, and the destination is right either way —
  // #/puzzles shows the setup gate when there is nothing to train on.
  const ready = meta?.ready !== false;
  const failed = meta?.failed ?? 0;
  const due = meta?.due ?? 0;
  // What the review slot's caption says: the due count when the schedule
  // has something waiting, the plain pool count otherwise.
  const reviewDetail =
    due > 0
      ? t('{n} due for review', { n: due })
      : t('{n} waiting to be reviewed', { n: failed });
  const weak = meta?.weakTheme ?? null;
  // Nothing is drawn for a wait too short to notice — most are (the five
  // answers take about 50ms against a warm vault, well under useSlowLoad's
  // threshold), and a skeleton that flashes reads as a fault.
  const pending = useSlowLoad(!settled);
  const skeleton = !settled && pending;

  // The notice stands only while an answer is missing.
  useEffect(() => {
    if (unanswered.size === 0) setFailure(null);
  }, [unanswered]);

  // Subscribed rather than read once: the trainer writes it and coming back
  // here re-mounts, which used to be the whole story — but the vault owns
  // it now, and on a device opening this vault for the first time the
  // answer arrives after this has already drawn the echo.
  const word = useDifficultyWord();

  return (
    // The scrolling family with its column pinned low: everything sits on
    // the bottom edge, while the outer shell still scrolls if a short
    // screen ever runs out of room — a target hidden under the tab bar
    // would be worse than a page that moves. `pb-3` replaces the shell's
    // usual 2rem + safe area: the tab bar below carries the inset itself,
    // and dead space under the cards is the opposite of what this page
    // is for.
    //
    // `h-full`, not `min-h-full`: a column whose height is indefinite
    // gives flex-grow nothing to distribute, and "take the rest" has to
    // mean something for the boards to size from it.
    <PageShell width="medium" className="h-full gap-2 pb-3">
      {/* mb-2 on top of the column's gap-2: the title row keeps the
          shell's 16px to the row under it while the cards below stay
          8px apart, which is the room this page fights for. */}
      <PageHeader title={t('Puzzles')} className="mb-2" />
      {/* What did not load, once, with the way to ask again: the same
          line and button the dashboard draws. Not for a vault with no
          database, whose draws refuse by design and whose slot below
          says what to do. */}
      {settled && failure && ready && (
        <p
          role="alert"
          className={cn(
            'flex shrink-0 items-center gap-3 text-sm',
            failure.offline ? 'text-warn' : 'text-destructive',
          )}
        >
          <span className="min-w-0 flex-1">{failure.message}</span>
          <Button variant="secondary" size="sm" onClick={retry}>
            <RotateCcw className="glyph" data-icon="inline-start" />
            {t('Try again')}
          </Button>
        </p>
      )}

      {/* The three places, in the order the sidebar lists them. Fixed
          rows: the slack below is for the boards. */}
      {skeleton && (
        <HubPlaces>
          <HubPlaceRow />
          <HubPlaceRow />
          <HubPlaceRow />
        </HubPlaces>
      )}
      {settled && (
        <HubPlaces>
          <PlaceCard icon={LayoutGrid} title={t('Themes')} go={() => navigate('puzzles', 'themes')}>
            {weak ? (
              // The theme this vault is worst at, as the place to start. The
              // server only offers one with enough attempts behind it to mean
              // something, and only one this vault does WORSE at than its own
              // average — a theme you are better at than your average is not
              // a weakness whatever its rate. Named, not scored: no count, no
              // rate and no rating, the page hands back no verdict.
              <PlaceDetail>
                {t('Worth practising: {theme}', { theme: themeLabel(weak.theme) })}
              </PlaceDetail>
            ) : (
              <PlaceDetail>{t('Train one tactic at a time.')}</PlaceDetail>
            )}
          </PlaceCard>
          <PlaceCard icon={BookMarked} title={t('Puzzle books')} go={() => navigate('puzzles', 'books')}>
            {book ? (
              // The book you were last in, by name. A "continue" line that
              // does not go empty on the day you import your first book: an
              // untouched book is still the thing you were about to start.
              // The shelf row's bar and its count were tried here and
              // dropped: squeezed beside a title on a phone the bar was too
              // short to read, and the count without it was a number with no
              // scale (lanph3re, 2026-09-14). The book page has both.
              <PlaceDetail>
                <span data-user-text>{book.title}</span>
              </PlaceDetail>
            ) : booksIn && !unanswered.has('book') ? (
              <PlaceDetail>{t('Import a tactics book you own from its PDF.')}</PlaceDetail>
            ) : (
              // Not answered: a bar on the detail line's own box.
              <span className="flex h-5 items-center">
                <Skeleton className="h-2 w-2/3" />
              </span>
            )}
          </PlaceCard>
          <PlaceCard icon={BarChart3} title={t('Dashboard')} go={() => navigate('puzzles', 'dashboard')}>
            <PlaceDetail>
              {solvedToday !== null
                ? t('Solved today: {n}', { n: solvedToday })
                : t('Solved today, and what is due for review.')}
            </PlaceDetail>
          </PlaceCard>
        </HubPlaces>
      )}

      {/* The boards. This cluster takes the page's slack (flex-1) and
          hands it to the cards; justify-end so that once every card is at
          its cap, what is left sits under the places rather than under
          the last board, which stays on the bottom edge. */}
      <div className="flex flex-1 flex-col justify-end gap-2">
        {skeleton && (
          <>
            <HubPuzzleRow />
            <HubPuzzleRow />
            <HubPuzzleRow />
          </>
        )}

        {/* The next puzzle, which is also how you start training: the
            card hands over the very position it shows, so a Train button
            beside it opened the same puzzle twice. What that button said
            underneath — the difficulty, as a word — is this card's detail
            now. Nothing when it is Any: that is the setting you get
            without choosing, and naming it qualifies the card with the
            absence of a qualifier. */}
        {settled && !nextIn && !unanswered.has('next') ? (
          <HubPuzzleRow />
        ) : settled && ready && unanswered.has('next') && !next ? (
          <EmptySlot title={t('Could not load the next puzzle.')} go={retry} />
        ) : settled && ready && next ? (
          <PuzzleCard
            // Ply 1: after the opponent's setup move, which is the
            // position the solver is actually handed.
            fen={positionAt(next, 1).fen}
            side={solverColor(next)}
            title={t('Next puzzle')}
            detail={word === 'Any' ? undefined : t(word)}
            go={() => {
              setPendingPuzzle('fresh', next);
              navigate('puzzles');
            }}
          />
        ) : settled && !ready ? (
          // No database yet: the slot the next puzzle will take, offering
          // the build. The page keeps its three slots whatever the vault
          // holds, so a fresh vault and a full one put every target in
          // the same place (the review slot's rule, applied here).
          <EmptySlot
            title={t('No puzzle database yet')}
            detail={t('Download and build it to start training.')}
            go={() => navigate('puzzles')}
          />
        ) : settled ? (
          <EmptySlot
            title={t('No puzzle to draw')}
            detail={t('The pool answered with nothing. Try again in a moment.')}
            go={() => navigate('puzzles')}
          />
        ) : null}

        {/* The review queue, as the position you actually got wrong — and
            an empty slot of the same size when there is nothing to review,
            rather than no slot at all (lanph3re's call). A queue you only
            hear about when it has something in it is a queue nobody knows
            they have; and a card that came and went with the draw was one
            more thing resizing the boards beside it.

            Three cases, one shape. The middle one — a pool the count says
            is non-empty but a draw that failed anyway — keeps review
            reachable from here, which it would not otherwise be. */}
        {!settled ? null : !reviewIn && !unanswered.has('review') ? (
          <HubPuzzleRow />
        ) : unanswered.has('review') && !review ? (
          <EmptySlot title={t('Could not load the missed puzzle.')} go={retry} />
        ) : review ? (
          <PuzzleCard
            fen={positionAt(review, 1).fen}
            side={solverColor(review)}
            title={t('Missed puzzle')}
            detail={reviewDetail}
            go={() => {
              setPendingPuzzle('failed', review);
              navigate('puzzles', 'failed');
            }}
          />
        ) : failed > 0 ? (
          <EmptySlot
            title={t('Review failed puzzles')}
            detail={reviewDetail}
            go={() => navigate('puzzles', 'failed')}
          />
        ) : (
          <EmptySlot
            title={t('No puzzle to review')}
            detail={
              // An empty queue with a schedule behind it is earned, not
              // gone — say when it comes back.
              meta?.nextDue
                ? t('Nothing due. The next review lands {when}', {
                    when: formatUntil(meta.nextDue),
                  })
                : t('Puzzles you get wrong come back here.')
            }
          />
        )}

        {/* The book you were last in, as the position it left you on.
            Book puzzles have no setup move — the solver plays the side
            to move in the FEN — so this one is drawn straight rather
            than at ply 1 like the two above it.

            Its own endpoint, not the book: opening a book downloads
            every id and every progress entry, and the solutions are 1.7
            MB on the biggest one. A launcher wants one puzzle. */}
        {settled && !bookNext && !bookIn && book && !unanswered.has('book') ? (
          // The shelf answered and named a book; its position is a second
          // request behind that. Hold the card's place rather than adding
          // one when it lands.
          <HubPuzzleRow />
        ) : null}
        {settled && !bookNext && unanswered.has('book') && (
          <EmptySlot title={t('Could not load the puzzle books.')} go={retry} />
        )}
        {settled && bookIn && !bookNext && !unanswered.has('book') && (
          // No book, or a finished one: the slot stays, and is the way to
          // the shelf where a PDF becomes one.
          <EmptySlot
            title={t('No puzzle book yet')}
            detail={t('Import a tactics book you own from its PDF.')}
            go={() => navigate('puzzles', 'books')}
          />
        )}
        {settled && bookNext && (
          <PuzzleCard
            fen={bookNext.puzzle.fen}
            side={turnOf(bookNext.puzzle.fen)}
            title={
              bookNext.puzzle.number === undefined
                ? t('Next in your book')
                : t('Book puzzle {n}', { n: bookNext.puzzle.number })
            }
            detail={bookNext.book.title}
            go={() => navigate('puzzles', 'books', bookNext.book.slug, bookNext.puzzle.id)}
          />
        )}
      </div>
    </PageShell>
  );
}
