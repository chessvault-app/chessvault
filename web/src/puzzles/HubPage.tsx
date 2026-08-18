import {
  BarChart3,
  BookMarked,
  Check,
  ChevronRight,
  Database,
  LayoutGrid,
  Puzzle,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/cn';
import { formatAgo, formatWhen } from '@/lib/dates';
import { useMediaQuery } from '@/lib/media';
import { INITIAL_FEN } from '@shared/tree';
import { Board } from '@/board/Board';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { ProgressBar } from '@/ui/ProgressBar';
import { Skeleton, SkeletonRows, useSlowLoad } from '@/ui/Skeleton';
import { t } from '@/lib/i18n';
import { DashboardPage } from './DashboardPage';
import { KingIcon } from '@/ui/KingIcon';
import { bandOf, difficultyQuery, storedDifficulty, useDifficultyWord } from './bands';
import { setPendingPuzzle, type HandoffMode } from './handoff';
import { PreviewEye, usePuzzlePreview } from './PuzzlePreview';
import { positionAt, solverColor, type ApiPuzzle } from './puzzle';
import { fetchSolvedToday } from './today';

/**
 * The phone's puzzle page: a launcher, and nothing else.
 *
 * The Puzzles tab used to land on the dashboard, which is stats and a
 * two-hundred-row attempt log — the page you consult occasionally,
 * opened every single time you reach for training. Its three shortcuts
 * (Train, Books, Themes) had been bolted to the TOP of it, which on a
 * phone held in one hand is the one part of the screen a thumb cannot
 * get to.
 *
 * So this is the hub the dashboard was being asked to be. Everything it
 * offers sits on the bottom edge, above the tab bar, with the empty
 * space put where nothing needs to be pressed. The dashboard goes back
 * to being a dashboard, one tile away.
 *
 * Nothing here waits on the network to be usable: every destination is a
 * plain link, and the difficulty word is read from the same localStorage
 * key the trainer writes. Only two things arrive late — the review count
 * and today's tally — and both are placed ABOVE the primary button, so
 * a slow answer grows the block upward and no target ever moves out from
 * under a thumb already travelling towards it.
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
}

interface HistoryEntry {
  id: string;
  win: boolean;
  /** Curation data — read only to pick the WORD for it, never shown. */
  puzzleRating: number;
  at: string;
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

/**
 * Whose move it is, read off the FEN's own field.
 *
 * A string read rather than a parse: chessops' parseFen returns a Result
 * whose unwrap() THROWS, and a malformed FEN reaching this launcher
 * would blank the page rather than drop one card. Book positions are
 * replay-verified at import so it should never happen — which is exactly
 * the kind of "should never" worth not betting a page on.
 */
const turnOf = (fen: string): 'white' | 'black' =>
  fen.split(' ')[1] === 'b' ? 'black' : 'white';

/** The next unsolved puzzle in a book, from /puzzlebooks/:slug/next.
    No solution in it, deliberately — this is a board to look at and a
    place to go, not the answer to a puzzle nobody has attempted. */
interface BookNext {
  id: string;
  fen: string;
  number?: number;
}

/** Just the one you were last in. A launcher answers "carry on with
    what?", and the answer to that is singular — the shelf is one tap
    away and is where a list of books belongs. */
const SHELF_ROWS = 1;

/** How much history to fetch. More than fits, deliberately: the panel
    stretches to whatever the page has spare and scrolls its own rows, so
    the number that fits is a property of the phone, not of this file. */
const HISTORY_ROWS = 30;

/**
 * A puzzle offered as itself: the position on the left, what it is and
 * whose move on the right.
 *
 * The board thumbnail beside the words, rather than a full-width board
 * under them, is what lets two of these fit above the launcher on a
 * phone — and it is the shape lichess's own puzzle tab uses, which is
 * the reference lanph3re gave.
 *
 * Pressing it hands the puzzle to the trainer (see `handoff.ts`) so the
 * position offered is the position that opens.
 */
function PuzzleCard({
  fen,
  side,
  title,
  detail,
  fill,
  go,
}: {
  /** The position the solver faces, ready to draw. */
  fen: string;
  side: 'white' | 'black';
  title: string;
  detail?: string;
  /** Stretch to share the page's spare height, and take the board's
      size from the card's own height rather than a fixed width. */
  fill?: boolean;
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
      className={cn(
        'bg-surface border-line hover:bg-surface-2 flex w-full items-stretch gap-3',
        'rounded-xl border px-2.5 py-1.5 text-left transition-colors duration-100',
        // Sharing the leftover height between the cards puts it into the
        // BOARDS, where it is worth something, instead of into the gaps
        // between them, where it is just distance.
        fill && 'min-h-0 flex-1',
      )}
    >
      <Board
        fen={fen}
        orientation={side}
        viewOnly
        coordinates={false}
        // Filling: the card has a definite height from the flex row it
        // is in, so the board takes that and its own aspect-square gives
        // the width — no size table, and it is always as big as the
        // screen can afford. Otherwise a fixed width, because a card
        // sized by its content has no height to read.
        // max-h caps the runaway case: a tall phone whose vault has no
        // history yet gives the three cards ~200px each, and a board
        // that size leaves the book's title about 110px to wrap in.
        className={cn('shrink-0 rounded-md', fill ? 'h-full max-h-40 w-auto' : 'w-28')}
      />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="text-fg text-sm font-medium">{title}</span>
        {detail && <span className="text-subtle text-xs leading-snug">{detail}</span>}
        {/* Whose move — the one thing you cannot read off a thumbnail
            fast, and the thing lichess puts under every one of these.
            Deliberately NOT a flex row: `items-center` would centre the
            king's box on the line box, and a line box includes the
            descender space that the letters beside it do not use, so a
            box-centred glyph sits visibly low. Left as ordinary inline
            text, the king takes the baseline like a letter does. */}
        <span className="text-muted text-xs">
          <KingIcon side={side} className="mr-1.5" />
          {side === 'white' ? t('White to play') : t('Black to play')}
        </span>
      </span>
      <ChevronRight className="text-subtle size-4 shrink-0 self-center" />
    </button>
  );
}

/**
 * The wait, in the shape of what the gate is about to draw.
 *
 * This page can promise its shape before it has its data, which is what
 * makes a skeleton honest here: the two height queries are synchronous, so
 * whether the history panel and the book row will be there is already
 * known, and the cards' size follows from that alone (`fill`). The layout
 * below is the settled layout with the content taken out.
 *
 * What it cannot know is whether there are any BOOKS — the height queries
 * say there is room for the shelf row and the third card, not that the
 * vault has one to put there. Three cards is the common case and the
 * maximum (the next puzzle, the review slot, which is drawn now whether
 * or not it has anything in it, and the book you were last in), and it is
 * the right way to be wrong: guessing too few would GROW the boards when
 * the third landed, which is the jump the gate exists to stop. A bookless
 * vault settles to two and the boards grow once, on a screen that has
 * already waited long enough for a skeleton to be worth drawing.
 *
 * The launcher is not in here. It never waits, it is already drawn, and
 * it does not move when this is replaced.
 */
function HubSkeletonPanels({ history, books }: { history: boolean; books: boolean }) {
  return (
    <>
      {history && (
        <div className="bg-surface border-line flex min-h-[6.5rem] flex-1 flex-col overflow-hidden rounded-xl border">
          <Skeleton className="m-3 mb-2 h-2.5 w-24 rounded" />
          <div className="min-h-0 flex-1">
            <SkeletonRows rows={3} className="gap-0 px-3 py-0" />
          </div>
        </div>
      )}
      {history && books && <div role="presentation" className="bg-line/70 mx-8 h-px shrink-0" />}
      {books && (
        <div className="bg-surface border-line flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2">
          <Skeleton className="h-10 w-7 shrink-0 rounded-sm" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-2.5 w-2/3" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
      )}
    </>
  );
}

/** The card cluster's own placeholders; see HubSkeletonPanels. */
function HubSkeletonCards({ fill }: { fill: boolean }) {
  const card = (i: number): ReactNode => (
    <div
      key={i}
      className={cn(
        'bg-surface border-line flex w-full items-stretch gap-3 rounded-xl border px-2.5 py-1.5',
        fill && 'min-h-0 flex-1',
      )}
    >
      <Skeleton
        className={cn('aspect-square shrink-0 rounded-md', fill ? 'h-full max-h-40 w-auto' : 'w-28')}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    </div>
  );
  return <>{[0, 1, 2].map(card)}</>;
}

/**
 * A card-shaped slot with no position in it.
 *
 * The board's box is still there and still square, because the slot's SIZE
 * must not depend on what the draw found: the cards share the page's spare
 * height, so one that collapsed when it came back empty would resize every
 * board beside it. Same reason the panels wait for each other (see
 * ANSWERS) — this is that rule applied to a single card.
 *
 * Actionable when there IS somewhere to go, which is how the pool-known-
 * but-draw-failed case still reaches the review queue.
 */
function EmptySlot({
  title,
  detail,
  fill,
  go,
}: {
  title: string;
  detail?: string;
  fill?: boolean;
  go?: () => void;
}) {
  const body = (
    <>
      {/* A real board at the starting position, not a placeholder box: the
          slot reads as a card either way, and a dashed outline in a column
          of boards is a hole in the page. Nothing to solve here, so it is
          the position before anything has happened. */}
      <Board
        fen={INITIAL_FEN}
        viewOnly
        coordinates={false}
        className={cn('shrink-0 rounded-md', fill ? 'h-full max-h-40 w-auto' : 'w-28')}
      />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="text-muted text-sm font-medium">{title}</span>
        {detail && <span className="text-subtle text-xs leading-snug">{detail}</span>}
      </span>
      {go && <ChevronRight className="text-subtle size-4 shrink-0 self-center" />}
    </>
  );
  // PuzzleCard's geometry exactly; only the hover and the press differ.
  const shape = cn(
    'bg-surface border-line flex w-full items-stretch gap-3',
    'rounded-xl border px-2.5 py-1.5 text-left',
    fill && 'min-h-0 flex-1',
  );
  return go ? (
    <button
      type="button"
      onClick={go}
      className={cn(shape, 'hover:bg-surface-2 transition-colors duration-100')}
    >
      {body}
    </button>
  ) : (
    <div className={shape}>{body}</div>
  );
}

/**
 * The books, most recently worked on first.
 *
 * A "continue" list that does not go empty on the day you import your
 * first book: an untouched book is still the thing you were about to
 * start, and its progress bar is simply at nought. Recency comes from
 * the server's `lastAt` (when a puzzle in it was last attempted, not
 * when the file changed), so the moment there IS a history this orders
 * itself by it and the top row is genuinely where you left off.
 */
function BookShelfPanel({ books }: { books: BookSummary[] }) {
  return (
    <div className="bg-surface border-line shrink-0 overflow-hidden rounded-xl border">
      <p className="text-subtle border-line border-b px-3 pb-1.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {t('Recently read')}
      </p>
      {books.map((b) => (
        <button
          key={b.slug}
          type="button"
          onClick={() => navigate('puzzles', 'books', b.slug)}
          className="hover:bg-surface-2 border-line flex w-full items-center gap-2.5 border-b px-3 py-2 text-left transition-colors duration-100 last:border-b-0"
        >
          {b.cover ? (
            <img
              src={`/api/puzzlebooks/${encodeURIComponent(b.slug)}/diagrams/cover.jpg`}
              alt=""
              // Decorative: the title is right beside it, so a screen
              // reader announcing the cover would only say it twice.
              className="border-line h-10 w-7 shrink-0 rounded-sm border object-cover"
            />
          ) : (
            <span className="bg-surface-2 text-subtle grid h-10 w-7 shrink-0 place-items-center rounded-sm">
              <BookMarked className="size-3.5" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-fg truncate text-xs font-medium">{b.title}</span>
            <ProgressBar total={b.puzzles} solved={b.solved} failed={b.failed} showEmpty />
          </span>
          <span className="text-subtle shrink-0 font-mono text-[0.6875rem] tabular-nums">
            {b.solved}/{b.puzzles}
          </span>
          <ChevronRight className="text-subtle size-3.5 shrink-0" />
        </button>
      ))}
    </div>
  );
}

/**
 * What you last attempted, newest first.
 *
 * Deliberately the log and not the statistics: counts, win rate and the
 * by-difficulty breakdown are the dashboard's job and are exactly what
 * this page exists to stop opening. A row here is a puzzle you can go
 * back into, which is a launcher's business.
 *
 * Difficulty is a word (`bandOf`), never the rating behind it.
 */
function HistoryPanel({ attempts }: { attempts: HistoryEntry[] }) {
  // The same eye the dashboard's log has: an id and a difficulty word do
  // not identify a position you spent two minutes on, but the board does.
  const preview = usePuzzlePreview();
  return (
    // The floor is 6.5rem rather than 7: the divider above this panel
    // costs 9px (its own line, plus a second helping of the column's
    // gap), and on a 390x844 phone this panel is already AT its floor,
    // so there was nothing to take it from and the page tipped into
    // scrolling. Better to pay it here — a caption and two and a bit
    // rows, where the part-row is itself the hint that the list scrolls.
    //
    // This is the panel that takes the page's slack: `flex-1` against the
    // fixed blocks around it, so there is no dead band anywhere on the
    // page and a taller phone simply shows more of your history. The
    // ROWS scroll, not the page — the launcher underneath must stay put.
    //
    // Shown with nothing in it too, and at the SAME size (lanph3re's
    // call): the page's shape is a property of the phone, not of what the
    // vault happens to hold, so a first session and a hundredth one put
    // every target in the same place. A section that appears only once it
    // has content also teaches nobody that it is there.
    <div className="bg-surface border-line flex min-h-[6.5rem] flex-1 flex-col overflow-hidden rounded-xl border">
      <p className="text-subtle border-line shrink-0 border-b px-3 pb-1.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {t('Puzzle history')}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
      {attempts.length === 0 && (
        <p className="text-subtle px-3 py-2.5 text-xs">
          {t('Nothing solved yet — the puzzles you attempt turn up here.')}
        </p>
      )}
      {attempts.map((h) => (
        <button
          key={h.id + h.at}
          type="button"
          onClick={() => navigate('puzzles', 'id', h.id)}
          title={t('Replay puzzle #{id}', { id: h.id })}
          className="hover:bg-surface-2 border-line flex w-full items-center gap-2.5 border-b px-3 py-1.5 text-left text-xs transition-colors duration-100 last:border-b-0"
        >
          {h.win ? (
            <Check className="text-good size-3.5 shrink-0" aria-label={t('solved')} />
          ) : (
            <X className="text-bad size-3.5 shrink-0" aria-label={t('failed')} />
          )}
          {/* The dashboard's columns exactly — same widths, same ml-auto,
              same right-aligned time. Two lists of the same rows that
              place their eye differently read as two different tables,
              and a time column left to size itself moves the eye between
              rows as "just now" gives way to "5 days ago". */}
          <span className="text-fg w-16 shrink-0 font-mono">#{h.id}</span>
          <span className="text-subtle w-14 shrink-0">{t(bandOf(h.puzzleRating))}</span>
          <PreviewEye eye={preview.eyeProps(h.id)} className="ml-auto" />
          <span
            className="text-subtle w-16 shrink-0 text-right tabular-nums"
            title={formatWhen(h.at)}
          >
            {formatAgo(h.at)}
          </span>
        </button>
      ))}
      </div>
      {preview.layer}
    </div>
  );
}

/**
 * One puzzle drawn ahead of time, for the board that offers it.
 *
 * The fresh draw asks the SAME question the trainer would (see
 * `difficultyQuery`). It must: this puzzle is handed to the trainer
 * rather than re-drawn there, so a hub that ignored the stored
 * difficulty would not merely mis-advertise — it would override a
 * setting the user chose, every time, with no way to tell.
 */
async function draw(mode: HandoffMode): Promise<ApiPuzzle | null> {
  try {
    const body = await api<{ puzzle: ApiPuzzle }>(
      `/api/puzzles/next${mode === 'failed' ? '?mode=failed' : difficultyQuery(storedDifficulty())}`,
    );
    return body.puzzle;
  } catch {
    return null; // 404 empty pool, 503 no database, network gone — no card
  }
}

/**
 * How many of the page's answers are still outstanding, counted down as
 * each settles — six requests, five of which decide part of the layout.
 *
 * Everything above the launcher shares ONE column of spare height, so a
 * block that arrives late does not appear beside the others: it resizes
 * them. The boards are what makes that visible. Chessground draws its
 * squares and its pieces to the size its box had when it mounted, and
 * catches up on the next frame — so a card landing a beat after the ones
 * already on screen leaves them drawn at the old size over the new box,
 * pieces hanging past the edge, until it does.
 *
 * Measured on the phone hub (390x700, warm vault): the two puzzle draws
 * answer together and mount two boards at 160px; the book card needs two
 * chained requests and lands after them, at which point three cards share
 * the same column and every board is re-laid-out to 144. Coming back from
 * Themes is where it shows, because that is when the two fast answers are
 * fast enough to paint before the slow one arrives.
 *
 * So the blocks wait for each other and are drawn once, at the size they
 * are going to keep. The launcher below them never waits — it is a page
 * of links, and it is what a thumb is reaching for — and it does not
 * move when they arrive: it is already on the bottom edge, and the
 * cluster above either grows into the empty band or hands its slack to
 * the history panel.
 */
const ANSWERS = 6;

/**
 * How long they are allowed to wait for each other.
 *
 * A request that never answers must not cost the page its cards: fetch has
 * no timeout of its own, and a phone that loses its connection mid-request
 * would otherwise hold the block above the launcher empty for as long as
 * the page is open. At the deadline the page draws whatever did arrive —
 * which is exactly what it did before the blocks waited at all, so the
 * worst case is the old behaviour and not a worse one.
 *
 * Two seconds because it is a backstop and not a tuning knob: the six
 * answers take about 50ms against a warm vault on the same machine, and
 * the slowest of them is two chained requests, so a server that is merely
 * slow still gets to answer first.
 */
const DEADLINE_MS = 2000;

function Hub() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [solvedToday, setSolvedToday] = useState<number | null>(null);
  const [next, setNext] = useState<ApiPuzzle | null>(null);
  const [review, setReview] = useState<ApiPuzzle | null>(null);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [bookNext, setBookNext] = useState<{ book: BookSummary; puzzle: BookNext } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    /**
     * The count lives in the EFFECT, not in state, and a run that has been
     * cleaned up stops counting.
     *
     * It was a piece of state counted down from ANSWERS, which is wrong the
     * moment this effect runs twice against the same component — exactly
     * what StrictMode does in development. Twelve answers then reported
     * against a counter of six, it reached nought halfway through, and the
     * page drew itself while the rest were still arriving: measured on the
     * dev server at 390x700, two boards mounted at 160px and the third card
     * landed afterwards and took them to 144. Which is the very bug this
     * gate exists to stop, reproduced by the gate.
     *
     * Per-run counting is idempotent under a double invoke — each run
     * settles on its own six — and `live` makes the abandoned run's answers
     * harmless. Only ever set TRUE, so a straggler cannot un-draw a page.
     */
    let live = true;
    let left = ANSWERS;
    /**
     * Whether the deadline drew the page before the answers were in, and
     * what the answers that missed it are waiting in.
     *
     * The gate below settles on six answers, but the deadline settles on
     * time — and everything that arrived afterwards used to be stored the
     * moment it landed, which put a card on a settled page on its own.
     * Each one re-shares the column's height with the others, so the
     * boards and the history panel shrank once per late answer: the exact
     * jump this gate exists to stop, arriving through the escape hatch.
     *
     * So after the deadline the answers wait for each other and go up in
     * one move. They are never dropped — a slow link would lose the board
     * this page is for — and the wait ends when the last one lands, which
     * every path reaches: each has a finally, and api() always settles.
     */
    let capped = false;
    const late: (() => void)[] = [];
    const store = (apply: () => void): void => {
      if (!live) return;
      if (capped) late.push(apply);
      else apply();
    };
    // Called in a `finally`, always after the state it gates: the page is
    // drawn on the render that settles it, so an answer that reported
    // itself before storing its result would be drawn missing.
    const done = (): void => {
      if (!live) return;
      left -= 1;
      if (left > 0) return;
      // One render for all of them: React batches what a single tick
      // stores, so the stragglers arrive as one change of layout.
      for (const apply of late) apply();
      late.length = 0;
      setSettled(true);
    };
    void (async () => {
      try {
        const answer = await api<Meta>('/api/puzzles/meta');
        store(() => setMeta(answer));
      } catch {
        // Every button still works; only the review row and the tally
        // are missing, and both are decoration on a page of links.
      } finally {
        done();
      }
    })();
    void fetchSolvedToday()
      .then((n) => {
        if (n !== null) store(() => setSolvedToday(n));
      })
      .finally(done);
    void (async () => {
      try {
        // Already newest-first, and the server caps what it reads — the
        // limit is the row count, so nothing is fetched to be thrown away.
        const body = await api<{ attempts: HistoryEntry[] }>(
          `/api/puzzles/history?limit=${HISTORY_ROWS}`,
        );
        store(() => setHistory(body.attempts));
      } catch {
        // No panel; the dashboard tile still reaches the full log.
      } finally {
        done();
      }
    })();
    // The two boards. Drawn here rather than described, because a puzzle
    // page whose subject is nowhere on it is a menu about chess.
    void draw('fresh')
      .then((puzzle) => store(() => setNext(puzzle)))
      .finally(done);
    void draw('failed')
      .then((puzzle) => store(() => setReview(puzzle)))
      .finally(done);
    void (async () => {
      try {
        const { books: all } = await api<{ books: BookSummary[] }>('/api/puzzlebooks');
        // Worked on most recently first; never-opened books keep the
        // server's alphabetical order behind them.
        const shelf = all
          // An empty book is a shell waiting for an import, not
          // something to carry on with. It belongs on the shelf, where
          // it can be imported into; offering it here would be a row
          // whose progress bar can never move.
          .filter((b) => b.puzzles > 0)
          .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
        const rows = shelf.slice(0, SHELF_ROWS);
        store(() => setBooks(rows));
        // The board for the book at the top of that shelf. Chained off
        // this answer rather than fired alongside it, because which book
        // to ask about is the thing this request just decided.
        const top = shelf[0];
        if (!top) return;
        // 404 is a finished book, which is a card not to draw — api()
        // throws it into the same catch as everything else.
        const one = await api<{ puzzle: BookNext }>(
          `/api/puzzlebooks/${encodeURIComponent(top.slug)}/next`,
        );
        store(() => setBookNext({ book: top, puzzle: one.puzzle }));
      } catch {
        // No panel. The Books tile below still reaches the shelf.
      } finally {
        done();
      }
    })();
    const deadline = setTimeout(() => {
      if (!live) return;
      capped = true;
      setSettled(true);
    }, DEADLINE_MS);
    return () => {
      live = false;
      clearTimeout(deadline);
    };
  }, []);

  // Assume the database is there until told otherwise: it is, for anyone
  // who has ever trained, and making everybody wait to find that out
  // would delay the one button this page exists for. A fresh vault sees
  // the label correct itself, and the destination is right either way —
  // #/puzzles shows the setup gate when there is nothing to train on.
  const ready = meta?.ready !== false;
  const failed = meta?.failed ?? 0;
  /**
   * How much of this page there is room for.
   *
   * Both panels exist to use space the launcher does not need. On a
   * screen with none to give they are not a short history and a squeezed
   * book row — they are two blocks pushing the thing you came for off
   * the bottom. So each has a height below which it simply is not there,
   * and below both, the boards come down too.
   *
   * The numbers are measured rather than guessed (this vault): the
   * launcher alone needs a 530px column, the book row takes it to 628.
   * A phone spends about 56 more on the tab bar, so the viewports
   * needed are 586 and 684. The history's own threshold is higher
   * again — it only earns a place once there is room for a caption and
   * a few rows under it rather than a stub.
   *
   * There is deliberately no threshold for the BOARD size. Where there
   * is no history the cards share the leftover height between them and
   * each board is sized from its card, so it is always as large as that
   * particular screen can afford — 106px on a 568, 139 on a 667 — with
   * the gaps staying tight either way. Spare height is worth more as
   * board than as distance between cards.
   *
   * Verified at each of these, all 0px overflow:
   *
   *   568 (SE 1)      launcher only
   *   667 (SE 2/8)    launcher only
   *   736 (8 Plus)    + book row
   *   800 / 812       + book row and history
   *   844 (14) / 932  + book row and history, more of it
   */
  const roomForBooks = useMediaQuery('(min-height: 46rem)');
  const roomForHistory = useMediaQuery('(min-height: 50rem)');
  // `settled` on all three, and on every card below: the blocks share one
  // column of height, so each of them is part of how the others are sized
  // (see ANSWERS). They go up together or not at all.
  const showBooks = settled && roomForBooks && books.length > 0;
  // The history panel is shown wherever there is ROOM for it, whether or
  // not there is anything in it — a section that appears only once it has
  // content teaches nobody that it exists (lanph3re's call).
  const showHistory = settled && roomForHistory;
  /**
   * Whether a history-shaped block is on the page at all — the panel once
   * the answers are in, its placeholder before. The cards take their size
   * from this and not from `showHistory`, so the skeleton's cards are the
   * size the real ones will be and the swap moves nothing.
   */
  const historyBlock = settled ? showHistory : roomForHistory;
  // Nothing is drawn for a wait too short to notice — most are (the six
  // answers take about 50ms against a warm vault, well under useSlowLoad's
  // threshold), and a skeleton that flashes reads as a fault.
  const pending = useSlowLoad(!settled);
  const skeleton = !settled && pending;

  // Subscribed rather than read once: the trainer writes it and coming back
  // here re-mounts, which used to be the whole story — but the vault owns
  // it now, and on a device opening this vault for the first time the
  // answer arrives after this has already drawn the echo.
  const word = useDifficultyWord();

  return (
    // The scrolling family with its column pinned low: `min-h-full` and
    // the block's own `mt-auto` put everything on the bottom edge, while
    // the outer shell still scrolls if a short screen ever runs out of
    // room — a target hidden under the tab bar would be worse than a
    // page that moves. `pb-4` replaces the shell's usual 2rem + safe
    // area: the tab bar below carries the inset itself, and dead space
    // under the buttons is the opposite of what this page is for.
    // The history in the middle takes every pixel the fixed blocks do
    // not, so there is no dead band anywhere and a taller phone simply
    // shows more rows. Its ROWS scroll, not the page — the launcher at
    // the bottom stays where the thumb left it.
    //
    // `h-full`, not `min-h-full`: a column whose height is indefinite
    // gives flex-grow nothing to distribute, and the history then sizes
    // to its own 30 rows and pushes the launcher off the page (measured:
    // a 1436px column inside a 788px shell). A definite height is what
    // makes "take the rest" mean anything.
    //
    // The shell still scrolls, which is the escape hatch for a screen too
    // short to hold even a stub of history: the floor below wins, the
    // blocks overflow, and the page moves. A launcher clipped off the
    // bottom edge would be worse than one you have to reach for.
    <PageShell width="medium" className="h-full gap-2 pb-3">
      <PageHeader title={t('Puzzles')} />

      {/* History first, then the book. Which one stretches is a property
          of the panels themselves (`flex-1` against `shrink-0`), not of
          the order they are written in, so this is purely about reading
          order — and it puts the one fixed-size panel next to the cards
          it belongs with, rather than stranded above a panel that grows. */}
      {skeleton && <HubSkeletonPanels history={roomForHistory} books={roomForBooks} />}
      {showHistory && <HistoryPanel attempts={history} />}
      {/* The line between what you have DONE and what there is to do
          next — the book row belongs with the cards under it, not with
          the log above it. It sits in the column's own gap, so the small
          space either side of it comes for free and stays equal.

          Inset, and quieter than the panels it divides — nearer the
          page behind it than to their edges. Full width in their own
          border colour it was a third hairline the same length as the
          two 8px away, which reads as a smudge. Being SHORTER than what
          it divides is what makes it legible as a rule, which is what
          then lets the colour drop back rather than having to shout. */}
      {showHistory && showBooks && (
        <div role="presentation" className="bg-line/70 mx-8 h-px shrink-0" />
      )}
      {showBooks && <BookShelfPanel books={books} />}

      {/* Whichever block is going to absorb the page's slack.
          With a history, that is the history — this cluster keeps its
          natural height and sits on the bottom edge. Without one, the
          slack has nowhere else to go, and pooling it (an auto margin,
          which takes free space BEFORE flex-grow is even considered)
          left a visible void under the header. Spreading it between the
          cards instead gives them a little more air on a screen that
          has it, and no part of the page reads as empty. */}
      <div
        className={cn(
          'flex flex-col gap-2',
          historyBlock ? 'shrink-0' : 'flex-1',
        )}
      >
        {skeleton && <HubSkeletonCards fill={!historyBlock} />}

        {settled && solvedToday !== null && solvedToday > 0 && (
          <p className="text-subtle px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
            {t('Solved today: {n}', { n: solvedToday })}
          </p>
        )}

        {/* The two boards, and everything else that arrives from the
            network, live ABOVE the primary button — a card that appeared
            below it would shove the button up mid-reach. Growing upward
            into the empty band costs nothing, because nothing up there is
            being pressed. */}
        {settled && ready && next && (
          <PuzzleCard
            // Ply 1: after the opponent's setup move, which is the
            // position the solver is actually handed.
            fen={positionAt(next, 1).fen}
            side={solverColor(next)}
            title={t('Next puzzle')}
            fill={!historyBlock}
            go={() => {
              setPendingPuzzle('fresh', next);
              navigate('puzzles');
            }}
          />
        )}

        {/* The review queue, as the position you actually got wrong — and
            an empty slot of the same size when there is nothing to review,
            rather than no slot at all (lanph3re's call). A queue you only
            hear about when it has something in it is a queue nobody knows
            they have; and a card that came and went with the draw was one
            more thing resizing the boards beside it.

            Three cases, one shape. The middle one — a pool the count says
            is non-empty but a draw that failed anyway — keeps review
            reachable from here, which it would not otherwise be. */}
        {!settled ? null : review ? (
          <PuzzleCard
            fen={positionAt(review, 1).fen}
            side={solverColor(review)}
            title={t('Missed puzzle')}
            fill={!historyBlock}
            detail={t('{n} waiting to be reviewed', { n: failed })}
            go={() => {
              setPendingPuzzle('failed', review);
              navigate('puzzles', 'failed');
            }}
          />
        ) : failed > 0 ? (
          <EmptySlot
            fill={!historyBlock}
            title={t('Review failed puzzles')}
            detail={t('{n} waiting to be reviewed', { n: failed })}
            go={() => navigate('puzzles', 'failed')}
          />
        ) : (
          <EmptySlot
            fill={!historyBlock}
            title={t('No puzzle to review')}
            detail={t('Puzzles you get wrong come back here.')}
          />
        )}

        {/* The book you were last in, as the position it left you on.
            Book puzzles have no setup move — the solver plays the side
            to move in the FEN — so this one is drawn straight rather
            than at ply 1 like the two above it.

            Its own endpoint, not the book: opening a book downloads
            every id and every progress entry, and the solutions are 1.7
            MB on the biggest one. A launcher wants one puzzle. */}
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
            fill={!historyBlock}
            go={() =>
              navigate('puzzles', 'books', bookNext.book.slug, bookNext.puzzle.id)
            }
          />
        )}

        {/* All four in one row, Train among them rather than a slab of
            its own. It keeps the primary fill, because being the thing
            you came here to press is a fact about it that survives being
            the same size as its neighbours — and the board card above is
            still the larger invitation.

            The buttons wait for the same threshold everything else waits
            for. They used to draw immediately, so a slow vault showed a
            row of four on an otherwise bare page, and the placeholders
            arrived under them a fifth of a second later and moved them.
            Now the page goes from empty to whole, once: below the
            threshold the answers are in before anything is drawn, and
            above it the buttons rise with the skeleton and stay put. */}
        {(settled || skeleton) && (
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ['Themes', LayoutGrid, false, () => navigate('puzzles', 'themes')],
                ['Books', BookMarked, false, () => navigate('puzzles', 'books')],
                ['Dashboard', BarChart3, false, () => navigate('puzzles', 'dashboard')],
                [
                  ready ? 'Train' : 'Set up',
                  ready ? Puzzle : Database,
                  true,
                  // The same action as the board above, deliberately: the
                  // card is the invitation and this is the thumb target,
                  // and they must open the SAME puzzle or the board is
                  // advertising a position this quietly swaps out.
                  () => {
                    if (next) setPendingPuzzle('fresh', next);
                    navigate('puzzles');
                  },
                ],
              ] as const
            ).map(([label, Icon, primary, go]) => (
              <button
                key={label}
                type="button"
                onClick={go}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 rounded-xl border',
                  'px-1 text-center text-xs font-medium leading-tight transition-colors',
                  primary
                    ? 'bg-primary text-primary-fg border-primary hover:bg-primary-hover'
                    : 'bg-surface border-line hover:bg-surface-2',
                )}
              >
                <Icon className={cn('size-5', primary ? '' : 'text-primary')} />
                {t(label)}
                {/* What pressing Train will actually do, as a word. Nothing
                    when it is Any: that is the setting you get without
                    choosing, and naming it qualifies the button with the
                    absence of a qualifier. */}
                {primary && ready && word !== 'Any' && (
                  <span className="text-[0.625rem] font-normal opacity-75">{t(word)}</span>
                )}
              </button>
              ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
