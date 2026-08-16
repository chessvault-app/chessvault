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
import { bandOf, difficultyQuery, difficultyWord, storedDifficulty } from './bands';
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

/** Just the one you were last in. A launcher answers "carry on with
    what?", and the answer to that is singular — the shelf is one tap
    away and is where a list of books belongs. */
const SHELF_ROWS = 1;

/** Recent attempts to show. Enough to be a history, few enough that the
    page still ends above the fold on a 390x844 phone. */
const HISTORY_ROWS = 4;

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
  puzzle,
  mode,
  title,
  detail,
  go,
}: {
  puzzle: ApiPuzzle;
  mode: HandoffMode;
  title: string;
  detail?: string;
  go: () => void;
}) {
  // The position the solver actually faces: after the opponent's setup
  // move, oriented to their side. Ply 1 — the same reading the dashboard
  // preview takes.
  const at = positionAt(puzzle, 1);
  const side = solverColor(puzzle);
  return (
    <button
      type="button"
      onClick={() => {
        setPendingPuzzle(mode, puzzle);
        go();
      }}
      // Tighter top and bottom than the sides: the board is square and
      // sets this row's height on its own, so vertical padding here is
      // slack around a shape that already has its own margins, while the
      // horizontal padding is still holding the text off the edge.
      className="bg-surface border-line hover:bg-surface-2 flex w-full items-center gap-3 rounded-xl border px-2.5 py-1.5 text-left transition-colors duration-100"
    >
      <Board
        fen={at.fen}
        orientation={side}
        viewOnly
        coordinates={false}
        className="w-32 shrink-0 rounded-md"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
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
      <ChevronRight className="text-subtle size-4 shrink-0" />
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
    <div className="bg-surface border-line overflow-hidden rounded-xl border">
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
    <div className="bg-surface border-line overflow-hidden rounded-xl border">
      <p className="text-subtle border-line border-b px-3 pb-1.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {t('Puzzle history')}
      </p>
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
          <span className="text-fg w-16 shrink-0 font-mono">#{h.id}</span>
          <span className="text-subtle min-w-0 flex-1 truncate">{t(bandOf(h.puzzleRating))}</span>
          <PreviewEye {...preview.eyeProps(h.id)} />
          <span className="text-subtle shrink-0 tabular-nums" title={formatWhen(h.at)}>
            {formatAgo(h.at)}
          </span>
        </button>
      ))}
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
        setBooks(
          all
            // An empty book is a shell waiting for an import, not
            // something to carry on with. It belongs on the shelf, where
            // it can be imported into; offering it here would be a row
            // whose progress bar can never move.
            .filter((b) => b.puzzles > 0)
            .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
            .slice(0, SHELF_ROWS),
        );
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
  // Read at render, not in state: the trainer writes this key and coming
  // back here re-mounts, so there is nothing to keep in step.
  const word = difficultyWord();

  return (
    // The scrolling family with its column pinned low: `min-h-full` and
    // the block's own `mt-auto` put everything on the bottom edge, while
    // the outer shell still scrolls if a short screen ever runs out of
    // room — a target hidden under the tab bar would be worse than a
    // page that moves. `pb-4` replaces the shell's usual 2rem + safe
    // area: the tab bar below carries the inset itself, and dead space
    // under the buttons is the opposite of what this page is for.
    <PageShell width="medium" className="min-h-full gap-2 pb-3">
      <PageHeader title={t('Puzzles')} />

      {/* Everything in ONE bottom-anchored block, panels included.
          They sat above it for a while, which put the page's slack
          between the history and the first board — the widest gap on the
          page, in the middle of the reading, growing every time anything
          above it got shorter. `mt-auto` has to dump the slack somewhere;
          under the header is the one place where a gap reads as air
          rather than as a seam. */}
      <div className="mt-auto flex flex-col gap-2">
        {books.length > 0 && <BookShelfPanel books={books} />}
        {history.length > 0 && <HistoryPanel attempts={history} />}
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
            puzzle={next}
            mode="fresh"
            title={t('Next puzzle')}
            go={() => navigate('puzzles')}
          />
        )}

        {/* The review queue, as the position you actually got wrong. The
            plain button is the fallback for when the pool is known to be
            non-empty but the draw itself failed — otherwise review would
            have no way in from here at all. */}
        {review ? (
          <PuzzleCard
            puzzle={review}
            mode="failed"
            title={t('Missed puzzle')}
            detail={t('{n} waiting to be reviewed', { n: failed })}
            go={() => navigate('puzzles', 'failed')}
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

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['Themes', LayoutGrid, () => navigate('puzzles', 'themes')],
              ['Books', BookMarked, () => navigate('puzzles', 'books')],
              ['Dashboard', BarChart3, () => navigate('puzzles', 'dashboard')],
            ] as const
          ).map(([label, Icon, go]) => (
            <button
              key={label}
              type="button"
              onClick={go}
              className="bg-surface border-line hover:bg-surface-2 flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition-colors"
            >
              <Icon className="text-primary size-5" />
              {t(label)}
            </button>
          ))}
        </div>

        <Button
          variant="primary"
          className="h-14 w-full justify-center gap-2.5 rounded-xl text-base"
          // The same action as the board above, deliberately: the card is
          // the invitation and this is the thumb target, and they must
          // open the SAME puzzle or the board is advertising a position
          // this button quietly swaps out.
          onClick={() => {
            if (next) setPendingPuzzle('fresh', next);
            navigate('puzzles');
          }}
        >
          {ready ? (
            <>
              <Puzzle className="size-5" />
              {t('Train')}
              {/* The difficulty as a word — what pressing this will
                  actually do. Never the rating behind it, and nothing at
                  all when it is Any: that is the setting you get without
                  choosing, and "Train · Any" qualifies the button with
                  the absence of a qualifier. */}
              {word !== 'Any' && (
                <span className="text-sm font-normal opacity-75">{t(word)}</span>
              )}
            </>
          ) : (
            <>
              <Database className="size-5" />
              {t('Set up the puzzle database')}
            </>
          )}
        </Button>
      </div>
    </PageShell>
  );
}
