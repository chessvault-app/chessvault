import {
  BarChart3,
  BookMarked,
  Check,
  ChevronRight,
  Database,
  LayoutGrid,
  Puzzle,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/cn';
import { formatAgo, formatWhen } from '@/lib/dates';
import { useMediaQuery } from '@/lib/media';
import { Board } from '@/board/Board';
import { Button } from '@/ui/Button';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { ProgressBar } from '@/ui/ProgressBar';
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
    <div className="bg-surface border-line flex min-h-[6.5rem] flex-1 flex-col overflow-hidden rounded-xl border">
      <p className="text-subtle border-line shrink-0 border-b px-3 pb-1.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {t('Puzzle history')}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
    const res = await fetch(
      `/api/puzzles/next${mode === 'failed' ? '?mode=failed' : difficultyQuery(storedDifficulty())}`,
    );
    if (!res.ok) return null; // 404 empty pool, 503 no database — no card
    return ((await res.json()) as { puzzle: ApiPuzzle }).puzzle;
  } catch {
    return null;
  }
}

function Hub() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [solvedToday, setSolvedToday] = useState<number | null>(null);
  const [next, setNext] = useState<ApiPuzzle | null>(null);
  const [review, setReview] = useState<ApiPuzzle | null>(null);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [bookNext, setBookNext] = useState<{ book: BookSummary; puzzle: BookNext } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/puzzles/meta');
        if (res.ok) setMeta((await res.json()) as Meta);
      } catch {
        // Every button still works; only the review row and the tally
        // are missing, and both are decoration on a page of links.
      }
    })();
    void fetchSolvedToday().then((n) => {
      if (n !== null) setSolvedToday(n);
    });
    void (async () => {
      try {
        const res = await fetch(`/api/puzzles/history?limit=${HISTORY_ROWS}`);
        if (!res.ok) return;
        // Already newest-first, and the server caps what it reads — the
        // limit is the row count, so nothing is fetched to be thrown away.
        setHistory((await res.json() as { attempts: HistoryEntry[] }).attempts);
      } catch {
        // No panel; the dashboard tile still reaches the full log.
      }
    })();
    // The two boards. Drawn here rather than described, because a puzzle
    // page whose subject is nowhere on it is a menu about chess.
    void draw('fresh').then(setNext);
    void draw('failed').then(setReview);
    void (async () => {
      try {
        const res = await fetch('/api/puzzlebooks');
        if (!res.ok) return;
        const { books: all } = (await res.json()) as { books: BookSummary[] };
        // Worked on most recently first; never-opened books keep the
        // server's alphabetical order behind them.
        const shelf = all
          // An empty book is a shell waiting for an import, not
          // something to carry on with. It belongs on the shelf, where
          // it can be imported into; offering it here would be a row
          // whose progress bar can never move.
          .filter((b) => b.puzzles > 0)
          .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
        setBooks(shelf.slice(0, SHELF_ROWS));
        // The board for the book at the top of that shelf. Chained off
        // this answer rather than fired alongside it, because which book
        // to ask about is the thing this request just decided.
        const top = shelf[0];
        if (!top) return;
        const one = await fetch(`/api/puzzlebooks/${encodeURIComponent(top.slug)}/next`);
        // 404 is a finished book, which is a card not to draw.
        if (!one.ok) return;
        setBookNext({ book: top, puzzle: ((await one.json()) as { puzzle: BookNext }).puzzle });
      } catch {
        // No panel. The Books tile below still reaches the shelf.
      }
    })();
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
  const showBooks = roomForBooks && books.length > 0;
  const showHistory = roomForHistory && history.length > 0;

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
          showHistory ? 'shrink-0' : 'flex-1',
        )}
      >
        {solvedToday !== null && solvedToday > 0 && (
          <p className="text-subtle px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
            {t('Solved today: {n}', { n: solvedToday })}
          </p>
        )}

        {/* The two boards, and everything else that arrives from the
            network, live ABOVE the primary button — a card that appeared
            below it would shove the button up mid-reach. Growing upward
            into the empty band costs nothing, because nothing up there is
            being pressed. */}
        {ready && next && (
          <PuzzleCard
            // Ply 1: after the opponent's setup move, which is the
            // position the solver is actually handed.
            fen={positionAt(next, 1).fen}
            side={solverColor(next)}
            title={t('Next puzzle')}
            fill={!showHistory}
            go={() => {
              setPendingPuzzle('fresh', next);
              navigate('puzzles');
            }}
          />
        )}

        {/* The review queue, as the position you actually got wrong. The
            plain button is the fallback for when the pool is known to be
            non-empty but the draw itself failed — otherwise review would
            have no way in from here at all. */}
        {review ? (
          <PuzzleCard
            fen={positionAt(review, 1).fen}
            side={solverColor(review)}
            title={t('Missed puzzle')}
            fill={!showHistory}
            detail={t('{n} waiting to be reviewed', { n: failed })}
            go={() => {
              setPendingPuzzle('failed', review);
              navigate('puzzles', 'failed');
            }}
          />
        ) : (
          failed > 0 && (
            <Button
              variant="secondary"
              className="w-full justify-center"
              onClick={() => navigate('puzzles', 'failed')}
            >
              <RotateCcw className="size-4" />
              {t('Review failed puzzles')} · {failed}
            </Button>
          )
        )}

        {/* The book you were last in, as the position it left you on.
            Book puzzles have no setup move — the solver plays the side
            to move in the FEN — so this one is drawn straight rather
            than at ply 1 like the two above it.

            Its own endpoint, not the book: opening a book downloads
            every id and every progress entry, and the solutions are 1.7
            MB on the biggest one. A launcher wants one puzzle. */}
        {bookNext && (
          <PuzzleCard
            fen={bookNext.puzzle.fen}
            side={turnOf(bookNext.puzzle.fen)}
            title={
              bookNext.puzzle.number === undefined
                ? t('Next in your book')
                : t('Book puzzle {n}', { n: bookNext.puzzle.number })
            }
            detail={bookNext.book.title}
            fill={!showHistory}
            go={() =>
              navigate('puzzles', 'books', bookNext.book.slug, bookNext.puzzle.id)
            }
          />
        )}

        {/* All four in one row, Train among them rather than a slab of
            its own. It keeps the primary fill, because being the thing
            you came here to press is a fact about it that survives being
            the same size as its neighbours — and the board card above is
            still the larger invitation. */}
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
      </div>
    </PageShell>
  );
}
