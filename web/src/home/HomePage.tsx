import {
  BookMarked,
  Check,
  ChevronRight,
  Folder,
  Grid3x3,
  Library,
  NotebookPen,
  Puzzle,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { normaliseHomeLayout, type HomeLayout } from '@shared/homeLayout';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { api, apiErrorMessage } from '@/lib/api';
import { formatAgo, formatUntil } from '@/lib/dates';
import { useMediaQuery } from '@/lib/media';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { ProgressBar } from '@/components/progress-bar';
import { ResultBadge } from '@/components/result-badge';
import { Skeleton } from '@/components/skeletons';
import { useDifficultyWord } from '@/puzzles/bands';
import { fetchSolvedToday } from '@/puzzles/today';
import { t } from '@/lib/i18n';
import { HOME_DESTINATIONS, type Destination, type HomeCount } from './destinations';
import { chartedMoves, launcherColumns, resolveHomeLayout } from './layout';

// Lazy, alone among this page's imports, and for the same reason the page
// itself is eager: Sheet brings a portal, the drag, the cover measurement
// and the focus trap, and most launches never open it. The landing chunk
// pays for what every launch draws and nothing else.
const CustomiseDialog = lazy(() =>
  import('@/home/CustomiseDialog').then((m) => ({ default: m.CustomiseDialog })),
);

/**
 * The landing page — two pages sharing one file, split at md.
 *
 * Below md it is the phone's launcher: Continue, the checklist, the tile
 * grid and the row of demoted entries, because there is no sidebar and
 * this screen IS the navigation. The two rows of destinations are not
 * written here: they come from the catalogue in `destinations.ts`,
 * arranged by `layout.ts`, and which of them are tiles is a property of
 * the vault, not of this file.
 *
 * From md the sidebar is on screen carrying every destination, so home
 * stopped offering navigation there at all (it drew the same list twice,
 * then the same list once, smaller — still the sidebar's job done again).
 * What a sidebar structurally cannot carry is what is HAPPENING in the
 * vault, so that is what the desktop gets: training so far today and what
 * the review schedule says, the latest games with their results, progress
 * through the puzzle books, and the studies and notes last touched. The
 * counts it shows are all yours — the puzzle tile used to show the 6.1M
 * Lichess pool in the slot every other tile used for personal counts,
 * which read as a lie until decoded.
 */

interface DocMeta {
  id: string;
  updatedAt: string;
}

/** What the dashboard needs of a collection game — a slice of the games
    page's GameSummary, redeclared rather than imported because
    `games/shared.tsx` brings the Board (and with it chessground) into
    whatever chunk imports it, and this page is the eager landing chunk. */
interface RecentGame {
  file: string;
  index: number;
  white: string;
  black: string;
  result: string;
  date: string;
}

/** One row of /api/puzzlebooks — the same shape the puzzles hub reads. */
interface PuzzleBookSummary {
  slug: string;
  title: string;
  puzzles: number;
  solved: number;
  failed: number;
  due?: number;
  lastAt?: string | null;
  cover?: boolean;
}

/** A study or note, for the desktop's recent-work list. */
interface RecentDoc extends DocMeta {
  kind: 'study' | 'note';
}

interface HomeData {
  counts: Partial<Record<HomeCount, number>>;
  lastStudy: DocMeta | null;
  lastGame: DocMeta | null;
  /** Counted training attempts — 0 means the trainer is untouched. */
  attempts: number;
  puzzleDbReady: boolean;
  hasProfile: boolean;
  hasPuzzleBook: boolean;
  /** The review schedule, straight off /api/puzzles/meta. */
  due: number;
  nextDue: string | null;
  /** The most recently trained puzzle books, at most three. */
  books: PuzzleBookSummary[];
  /** Studies and notes by last touch, newest first, at most five. */
  recentDocs: RecentDoc[];
}

/**
 * Where the checklist's dismissal used to live, before it could be
 * switched back on.
 *
 * Read once per device and then deleted: a dismissal made under the old
 * behaviour is honoured by writing it into the vault, so nobody's X is
 * undone — but there is exactly one source of truth afterwards. Deletable
 * a release or two from now, along with the branch that reads it.
 */
const CHECKLIST_KEY = 'vault:home-checklist-dismissed';
/** Last launch's Continue-row count — the layout reservation, see below. */
const CONTINUE_ROWS_KEY = 'vault:home-continue-rows';
/**
 * The last layout this device saw, kept only so the first paint draws the
 * page you actually have rather than the default one.
 *
 * A paint hint and never the authority — the same bargain, and the same
 * honesty, as CONTINUE_ROWS_KEY: the vault decides, this is overwritten by
 * whatever it says, and a device that has never opened this vault shows
 * the defaults until the answer arrives.
 */
const LAYOUT_KEY = 'vault:home-layout';

const readEcho = (): HomeLayout | null => {
  try {
    return normaliseHomeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null'));
  } catch {
    return null;
  }
};

const writeEcho = (layout: HomeLayout | null): void => {
  if (layout === null) localStorage.removeItem(LAYOUT_KEY);
  else localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
};

/** The list inside a studies-API answer (the notes and games endpoints
    speak the same document API), or nothing. */
function docsOf(v: unknown): DocMeta[] {
  const list = (v as { studies?: DocMeta[] })?.studies;
  return Array.isArray(list) ? list : [];
}

function latest(v: unknown): DocMeta | null {
  return (
    [...docsOf(v)].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null
  );
}

/** Module scope so the row's buttons can reach it too — and because a
    formatter with fixed options has no reason to be rebuilt per render. */
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** A study id is a path; the card shows its name. */
const baseName = (id: string): string => id.split('/').at(-1) ?? id;

/** Collection file → the document id the games route opens. The same rule
    as games/shared.tsx's docId, restated because importing that module
    would bring the Board (and chessground) into the landing chunk. */
const collectionDocId = (g: Pick<RecentGame, 'file'>): string =>
  g.file.replace(/^collection\//, '').replace(/\.pgn$/, '');

/**
 * One demoted destination as a row button. Below sm it is the phone's
 * launcher cell — icon over a label free to break ("Puzzle books") inside
 * its column. From sm it is an ordinary ghost button in a wrapping,
 * centred row. It never renders from md: the desktop's navigation is the
 * sidebar, and its home is the dashboard below.
 */
function LauncherButton({ entry }: { entry: Destination }) {
  const { label, icon: Icon, nav } = entry;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate(...nav)}
      className={cn(
        'max-sm:h-auto max-sm:flex-col max-sm:gap-1.5 max-sm:whitespace-normal',
        'max-sm:rounded-lg max-sm:px-1 max-sm:py-2',
        'max-sm:text-center max-sm:text-xs max-sm:leading-tight',
        // The size's own coarse-pointer overrides would win the
        // cascade back without coarse-specific counters.
        'pointer-coarse:max-sm:h-auto pointer-coarse:max-sm:px-1',
      )}
    >
      <Icon className="size-3.5 shrink-0 max-sm:size-4" />
      {t(label)}
    </Button>
  );
}

export function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  // What the vault says the page looks like; null until it has ever been
  // said. Seeded from the echo so the first paint is not a rearrangement.
  const [layout, setLayout] = useState<HomeLayout | null>(readEcho);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The last arrangement the server confirmed — where a failed save goes back to. */
  const confirmed = useRef<HomeLayout | null>(null);
  /** Which save is the current one, so a slow failure cannot undo a newer press. */
  const attempt = useRef(0);
  // How many Continue rows LAST launch ended up with, so this launch can
  // reserve the card's space before the data returns. Without it the card
  // popped in a beat after first paint and pushed the whole page down —
  // the most visible jolt of a launch now that nothing covers loading.
  // Wrong by at most one launch, and a fresh vault stores 0: no card, no
  // reservation, no jolt.
  const [expectedRows] = useState(() => {
    const n = Number(localStorage.getItem(CONTINUE_ROWS_KEY));
    return Number.isInteger(n) && n > 0 && n <= 3 ? n : 0;
  });
  // Hoisted out of the Continue row it labels: that row is built inside a
  // conditional spread, and a hook cannot be called from one.
  const difficultyLabel = useDifficultyWord();

  // The dashboard's own two answers, asked for only where the dashboard
  // exists. /api/games parses the whole collection (mtime-cached, but the
  // reply is every game as JSON) and the history read is a second request
  // — a phone renders neither, so below md neither is fetched. Asked once,
  // on the first render at md or the first resize into it.
  const md = useMediaQuery('(min-width: 48rem)');
  const [dash, setDash] = useState<{
    gamesTotal: number;
    recentGames: RecentGame[];
    /** Null when the history endpoint did not answer — not a zero. */
    solvedToday: number | null;
  } | null>(null);
  const dashAsked = useRef(false);
  useEffect(() => {
    if (!md || dashAsked.current) return;
    dashAsked.current = true;
    void (async () => {
      const [games, solvedToday] = await Promise.all([
        api<{ total?: number; games?: RecentGame[] }>('/api/games').catch(() => null),
        fetchSolvedToday(),
      ]);
      // A set after navigating away is a no-op (React 18) and nothing else
      // here outlives the page, so no liveness flag.
      setDash({
        gamesTotal: games?.total ?? 0,
        recentGames: Array.isArray(games?.games) ? games.games.slice(0, 5) : [],
        solvedToday,
      });
    })();
  }, [md]);

  useEffect(() => {
    // Navigating away mid-flight: React 18 makes the setStates no-ops, but
    // the echo and checklist-flag writes below are not React's to drop, so
    // everything after the await is skipped once the page is gone.
    let live = true;
    const grab = async (url: string): Promise<unknown> => {
      try {
        // `?? null`: the null checks below (settings !== null) predate
        // api(), which parses an empty body to undefined instead.
        return (await api(url)) ?? null;
      } catch {
        return null;
      }
    };
    void (async () => {
      // The notes/games endpoints speak the studies document API, so they
      // answer with a `studies` list.
      const [studies, notes, games, puzzles, settings, books, library, map] = await Promise.all([
        grab('/api/studies'),
        grab('/api/notes'),
        grab('/api/games/docs'),
        grab('/api/puzzles/meta'),
        grab('/api/settings'),
        grab('/api/puzzlebooks'),
        grab('/api/books'),
        // The whole map document, which is affordable here: it is a
        // skeleton of SAN and links, capped at 5000 nodes and 1 MB, with
        // no positions in it.
        grab('/api/openingmap'),
      ]);
      if (!live) return;
      const docs = (v: unknown): number | undefined =>
        Array.isArray((v as { studies?: unknown[] })?.studies)
          ? (v as { studies: unknown[] }).studies.length
          : undefined;
      const meta = puzzles as {
        ready?: boolean;
        due?: number;
        nextDue?: string | null;
        user?: { attempts?: number; wins?: number };
      } | null;
      const profile = (settings as { profile?: { chesscom?: string; lichess?: string } })?.profile;

      // The arrangement, from the same answer the profile came in. The
      // echo is corrected to whatever the vault says, including to nothing
      // when the vault says it was never customised.
      const stored = normaliseHomeLayout((settings as { home?: unknown } | null)?.home);
      confirmed.current = stored;
      setLayout(stored);
      writeEcho(stored);
      if (stored !== null) {
        // The vault has an opinion, so the old per-device flag is stale by
        // definition: applying it could undo a checklist switched back on
        // somewhere else.
        localStorage.removeItem(CHECKLIST_KEY);
      } else if (localStorage.getItem(CHECKLIST_KEY) === '1' && settings !== null) {
        // Dismissed before there was any way to bring it back. Move that
        // into the vault once — and only drop the flag when the write
        // lands, so a failed migration simply happens next launch.
        const migrated: HomeLayout = {
          tiles: resolveHomeLayout(null, HOME_DESTINATIONS).tiles.map((entry) => entry.id),
          hidden: [],
          continueCard: true,
          checklist: false,
        };
        setLayout(migrated);
        writeEcho(migrated);
        void api('/api/settings/home', { method: 'PUT', json: migrated })
          .then(() => {
            confirmed.current = migrated;
            localStorage.removeItem(CHECKLIST_KEY);
          })
          .catch(() => {});
      }
      const counts: Partial<Record<HomeCount, number>> = {
        studies: docs(studies),
        notes: docs(notes),
        games: docs(games),
      };
      // The library: how many books are on the shelf, once there are any.
      const shelf = (library as { books?: unknown[] } | null)?.books;
      if (Array.isArray(shelf) && shelf.length > 0) counts.books = shelf.length;
      // YOUR solves — a personal number like every other tile's, not the
      // size of the Lichess pool.
      const wins = meta?.user?.wins;
      if (typeof wins === 'number' && wins > 0) counts.puzzles = wins;
      // Both maps exist the moment the page is first opened, so the number
      // that means anything is the moves under them, and none of them is
      // no number rather than a nought.
      const charted = chartedMoves(map);
      if (charted > 0) counts.openingmap = charted;
      // The desktop dashboard's slices, cut from answers already in hand.
      // Books by last training, not title: the shelf orders itself by
      // title, and this panel's question is "what am I in the middle of".
      const puzzleBooks = Array.isArray((books as { books?: PuzzleBookSummary[] })?.books)
        ? (books as { books: PuzzleBookSummary[] }).books
        : [];
      const topBooks = [...puzzleBooks]
        .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
        .slice(0, 3);
      const recentDocs = [
        ...docsOf(studies).map((d) => ({ kind: 'study' as const, ...d })),
        ...docsOf(notes).map((d) => ({ kind: 'note' as const, ...d })),
      ]
        .filter((d) => d.updatedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5);
      setData({
        counts,
        lastStudy: latest(studies),
        lastGame: latest(games),
        attempts: meta?.user?.attempts ?? 0,
        puzzleDbReady: meta?.ready === true,
        hasProfile: Boolean(profile?.chesscom || profile?.lichess),
        hasPuzzleBook: puzzleBooks.length > 0,
        due: meta?.due ?? 0,
        nextDue: meta?.nextDue ?? null,
        books: topBooks,
        recentDocs,
      });
    })();
    return () => {
      live = false;
    };
  }, []);

  /**
   * Apply now, store next — and put it back if the vault disagrees.
   *
   * The press has to land immediately or reordering is unusable, but the
   * vault is what the page IS: a change that failed to save and stayed on
   * screen would be a lie until the next reload. So a failure reverts to
   * the last arrangement the server confirmed and says why. `attempt`
   * keeps a slow failure from undoing a press made after it.
   */
  const save = (next: HomeLayout | null): void => {
    const mine = ++attempt.current;
    setLayout(next);
    writeEcho(next);
    setSaveError(null);
    void (async () => {
      try {
        // Reset DELETEs rather than storing today's defaults, so a vault
        // put back to default is a vault that never chose.
        await api('/api/settings/home', next === null ? { method: 'DELETE' } : { method: 'PUT', json: next });
        if (mine === attempt.current) confirmed.current = next;
      } catch (e) {
        if (mine !== attempt.current) return;
        setLayout(confirmed.current);
        writeEcho(confirmed.current);
        setSaveError(apiErrorMessage(e));
      }
    })();
  };


  // The grid, the row underneath it, and what has been asked off the page
  // altogether. Everything in the catalogue is in exactly one of the
  // three, and the third is drawn nowhere here — the sidebar and More
  // still reach it, which is what makes hiding a preference rather than a
  // way to lose a page.
  const { tiles, launchers, hidden } = resolveHomeLayout(layout, HOME_DESTINATIONS);
  // The arrangement as an edit would have to state it: a vault that has
  // never been customised is its defaults, written down.
  const effective: HomeLayout = {
    tiles: tiles.map((entry) => entry.id),
    hidden: hidden.map((entry) => entry.id),
    continueCard: layout?.continueCard !== false,
    checklist: layout?.checklist !== false,
  };

  const continueRows: { icon: typeof Grid3x3; label: string; detail: string; go: () => void }[] =
    data === null
      ? []
      : [
          ...(data.lastStudy
            ? [
                {
                  icon: Library,
                  label: baseName(data.lastStudy.id),
                  detail: t('Continue study'),
                  go: () => navigate('studies', encodeURIComponent(data.lastStudy!.id)),
                },
              ]
            : []),
          ...(data.lastGame
            ? [
                {
                  icon: Folder,
                  label: baseName(data.lastGame.id),
                  detail: t('Last game'),
                  go: () => navigate('games', encodeURIComponent(data.lastGame!.id)),
                },
              ]
            : []),
          ...(data.puzzleDbReady && data.attempts > 0
            ? [
                {
                  icon: Puzzle,
                  label: t('Resume training'),
                  detail: t(difficultyLabel),
                  go: () => navigate('puzzles'),
                },
              ]
            : []),
        ];

  // Remembered for the NEXT launch's reservation, above.
  useEffect(() => {
    if (data !== null) localStorage.setItem(CONTINUE_ROWS_KEY, String(continueRows.length));
    // continueRows is derived from data; keying on data is keying on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // First-run steps, each ending in a feature lighting up. The list only
  // exists while something is unlit, and can be dismissed for good.
  const checklist: { label: string; done: boolean; go: () => void }[] =
    data === null
      ? []
      : [
          {
            label: t('Add your Lichess or Chess.com username — the Games page fills itself from it'),
            done: data.hasProfile,
            go: () => navigate('settings'),
          },
          {
            label: t('Fetch the puzzle database — the trainer runs offline from it'),
            done: data.puzzleDbReady,
            go: () => navigate('puzzles'),
          },
          {
            label: t('Import a scanned tactics book — its diagrams become solvable puzzles'),
            done: data.hasPuzzleBook,
            go: () => navigate('puzzles', 'books'),
          },
        ];
  const showChecklist =
    effective.checklist && data !== null && checklist.some((step) => !step.done);

  // Whether the Training panel has a single row to offer. Stated once,
  // because the dashboard's "nothing at all" card is the negation of every
  // panel's condition, and a duplicated condition is how the two drift.
  const showTraining =
    data !== null &&
    data.puzzleDbReady &&
    ((dash !== null && dash.solvedToday !== null) || data.due > 0 || data.nextDue !== null);

  return (
    // grid-cols-[minmax(0,1fr)] is load-bearing, not tidiness: a grid's
    // single automatic column is sized to its content's MAX-content width,
    // and a Continue row's label is `nowrap` — so `truncate` decided where
    // to put the ellipsis while the column had already grown to the whole
    // untruncated study name. A long name widened the card to its 32rem cap
    // on a 390px phone and put a lateral scrollbar across the page
    // (measured: scrollWidth 560 against a 390 client). Capping the column
    // at the space available makes `w-full` mean the page again, and the
    // ellipsis do what it was there for.
    //
    // overflow-x-hidden says the rest out loud. Nothing on this page is
    // ever meant to be reached by moving sideways — it is a launcher one
    // column wide — and `overflow-y-auto` alone does not mean that: with
    // the other axis left visible, CSS computes it to `auto` too, so any
    // future px of overflow silently becomes a page that slides under a
    // thumb with no scrollbar to explain it. Hidden makes the axis a
    // statement rather than an accident. Nothing is clipped by it: at
    // 320–430px, with every destination in the launcher row and an
    // unbreakable study name in Continue, the content is exactly as wide
    // as the box.
    //
    // Centred on BOTH axes at every width, and the vertical half of that
    // was un-done once and asked back (lanph3re, on the deployed box): the
    // dashboard briefly shipped `md:items-start`, reasoning that a centred
    // page re-centres when the panels land a beat after first paint. It
    // does — the stack shifts up by half the panels' height, once, on the
    // same round trip the phone already absorbs for Continue — and what
    // top-alignment bought for that was a tall window with all its slack
    // piled below the content. Centring splits the slack instead, which
    // reads as a home rather than a form abandoned mid-page.
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] place-items-center overflow-y-auto overflow-x-hidden p-6">
      <div className="w-full max-w-lg md:max-w-2xl lg:max-w-3xl">
        {/* The page's heading, for the document and for a screen reader
            walking the landmarks — not for the eye.

            What stood here was a masthead: the mark on a primary tile at
            size-14, the app's name at text-2xl, and the tagline off the
            landing page. It told a returning user their own app's name, on
            the screen they see every launch, above the one row they came
            for. A window's chrome already names the app, and the sidebar
            carries the mark; a tool opens into work. Removing it lifts
            Continue to the top of the fold on a phone.

            The h1 stays because deleting it would leave the only route in
            the app with no heading at all. */}
        <h1 className="sr-only">{t('Chess Vault')}</h1>

        {/* Continue — the best retention surface on the page. A returning
            user lands one tap from where they left off. Before the data
            arrives, the card is reserved at last launch's size with
            skeleton rows, so the page does not jump when it fills in. */}
        {effective.continueCard && data === null && expectedRows > 0 && (
          <div className="bg-card mb-4 overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <p className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
              {t('Continue')}
            </p>
            {Array.from({ length: expectedRows }, (_, i) => (
              <div
                key={i}
                className="border-border flex w-full items-center gap-2.5 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                {/* The row's height comes from an INVISIBLE real text line,
                    not a fixed-height bar: iOS sizes this text line 1pt
                    shorter than desktop engines do, and a `h-4` bar was
                    that 1pt taller per row — enough for the centred page
                    to step when the card filled in (measured on
                    lanph3re's recording). The bar just paints over it. */}
                <span className="relative min-w-0 flex-1 font-medium">
                  <span className="invisible">&nbsp;</span>
                  <Skeleton className="absolute inset-y-0.5 left-0 w-36 max-w-full" />
                </span>
              </div>
            ))}
          </div>
        )}
        {effective.continueCard && continueRows.length > 0 && (
          <div className="bg-card mb-4 overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <p className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
              {t('Continue')}
            </p>
            {continueRows.map(({ icon: Icon, label, detail, go }) => (
              <ListRow key={label + detail} divided onClick={go} className="text-sm">
                <Icon className="text-muted-foreground size-3.5 shrink-0" />
                <span className="text-foreground min-w-0 flex-1 truncate font-medium">{label}</span>
                <span className="text-muted-foreground shrink-0">{detail}</span>
                <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
              </ListRow>
            ))}
          </div>
        )}

        {showChecklist && (
          <div className="bg-card mb-4 overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <div className="border-border flex items-center border-b px-3 pb-1.5 pt-2">
              <p className="text-muted-foreground flex-1 text-sm font-medium">
                {t('Set up your vault')}
              </p>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-my-1 -mr-1.5"
                title={t('Hide this checklist')}
                // Hidden in the vault now, not on this device — and the
                // customise sheet can bring it back, which is what the old
                // localStorage flag made impossible.
                onClick={() => save({ ...effective, checklist: false })}
              >
                <X className="size-3" />
              </Button>
            </div>
            {checklist.map((step) => (
              <ListRow
                key={step.label}
                divided
                onClick={step.go}
                disabled={step.done}
                className="text-sm"
              >
                {/* A done step is marked and quietened, not struck through
                    and lit green. The ring-and-tick pair over a strikethrough
                    is the onboarding-reward idiom, and green is spoken for
                    here: the colour grammar gives it to outcomes — solved,
                    won — so a green tick on a settings shortcut reads as a
                    result somebody earned. A pending step carries no marker
                    at all; the row's own chevron already says it is a way in,
                    and the spacer keeps the labels in one column. */}
                {step.done ? (
                  <Check className="text-muted-foreground size-3.5 shrink-0" />
                ) : (
                  <span aria-hidden className="size-3.5 shrink-0" />
                )}
                <span
                  className={
                    step.done ? 'text-muted-foreground min-w-0 flex-1' : 'text-foreground min-w-0 flex-1'
                  }
                >
                  {step.label}
                </span>
                {!step.done && <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />}
              </ListRow>
            ))}
          </div>
        )}

        {/* The caption idiom the cards above use, carrying the way in to
            the sheet. Outside the grid deliberately: with every tile
            switched off there would otherwise be nothing left to press. */}
        <div className="mb-2 flex items-center px-1">
          {/* One caption, two rooms: below md it heads the launcher grid,
              from md the dashboard panels. The customise button is the
              same on both — the sheet's card switches apply everywhere. */}
          <p className="text-muted-foreground flex-1 text-sm font-medium">
            <span className="md:hidden">{t('Shortcuts')}</span>
            <span className="max-md:hidden">{t('Overview')}</span>
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            // -mr-1 against the row's px-1, so the button ends level with
            // the tiles below it. -mr-1.5 (what the checklist's X uses,
            // inside a card padded px-3) hung 2px past the card's edge.
            className="-my-1 -mr-1"
            title={t('Customise home')}
            onClick={() => setEditing(true)}
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>
        </div>

        {/* Tiles are the PHONE's navigation, and only the phone's. From md
            the sidebar is on screen carrying the same destinations, so a
            grid of cards beside it was the same list twice — once with
            blurbs. What the desktop gets instead is the dashboard below. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:hidden">
          {tiles.map(({ id, label, blurb, icon: Icon, nav, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => navigate(...nav)}
              className="bg-card hover:-strong hover:bg-accent group flex flex-col items-start gap-2 rounded-xl ring-1 ring-foreground/10 p-3.5 text-left transition-colors duration-100"
            >
              <Icon className="text-muted-foreground group-hover:text-primary size-4.5 transition-colors" />
              <span>
                <span className="text-foreground block text-base font-medium">
                  {t(label)}
                  {count !== undefined && data?.counts[count] !== undefined ? (
                    <span className="text-muted-foreground font-mono text-sm font-normal">
                      {' '}
                      · {compact.format(data.counts[count]!)}
                    </span>
                  ) : (
                    // Only the tiles that will get a number keep space for
                    // one: Board and Editor are tools and never carry one.
                    data === null &&
                    count !== undefined && (
                      <Skeleton className="ml-1.5 inline-block h-2 w-5 align-middle" />
                    )
                  )}
                </span>
                <span className="text-muted-foreground block text-sm leading-snug">{t(blurb)}</span>
              </span>
            </button>
          ))}
        </div>

        {/* The dashboard — what is happening in the vault, drawn only
            where the sidebar already does the navigating. It waits for
            both answer batches so the grid lands once instead of
            reflowing panel by panel, and no skeleton holds its place:
            against a warm vault the wait is one round trip, and the one
            re-centre it costs when the grid lands is the same beat the
            phone already absorbs for Continue. A panel with nothing to
            say is not drawn — an empty box is a question, not a fact —
            and a vault with nothing at all says so once, in one card. */}
        {data !== null && dash !== null && (
          <div className="grid gap-3 max-md:hidden lg:grid-cols-2">
            {showTraining && (
              <div className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
                <p className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
                  {t('Training')}
                </p>
                {/* Today's count is skipped when the history endpoint did
                    not answer: a nought that is really an error would say
                    you have not trained when you may well have. */}
                {dash.solvedToday !== null && (
                  <ListRow divided onClick={() => navigate('puzzles')} className="text-sm">
                    <Puzzle className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {t('Solved today: {n}', { n: dash.solvedToday })}
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                )}
                {(data.due > 0 || data.nextDue !== null) && (
                  <ListRow divided onClick={() => navigate('puzzles')} className="text-sm">
                    <RotateCcw className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {data.due > 0
                        ? t('{n} due for review', { n: data.due })
                        : t('Nothing due — the next review lands {when}', {
                            when: formatUntil(data.nextDue!),
                          })}
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                )}
              </div>
            )}

            {dash.recentGames.length > 0 && (
              <div className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
                <div className="border-border flex items-baseline border-b px-3 pb-1.5 pt-2">
                  <p className="text-muted-foreground flex-1 text-sm font-medium">
                    {t('Recent games')}
                  </p>
                  {/* The collection's size, where a tile used to carry it. */}
                  <span className="text-muted-foreground font-mono text-xs">
                    {compact.format(dash.gamesTotal)}
                  </span>
                </div>
                {dash.recentGames.map((g) => (
                  <ListRow
                    key={`${g.file}#${g.index}`}
                    divided
                    onClick={() => navigate('games', encodeURIComponent(collectionDocId(g)))}
                    className="text-sm"
                  >
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {g.white} – {g.black}
                    </span>
                    {/* An unfinished game ("*") wears no badge — ResultBadge
                        renders anything unrecognised as a draw. */}
                    {(g.result === '1-0' || g.result === '0-1' || g.result.includes('1/2')) && (
                      <ResultBadge result={g.result} />
                    )}
                    <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                      {g.date}
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                ))}
              </div>
            )}

            {data.books.length > 0 && (
              <div className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
                <p className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
                  {t('Puzzle books')}
                </p>
                {/* The puzzles hub's book row, so a book reads the same on
                    both pages: cover, title, the solved-against-failed bar
                    (no rate, no rating), and the tally. */}
                {data.books.map((b) => (
                  <ListRow
                    key={b.slug}
                    divided
                    onClick={() => navigate('puzzles', 'books', b.slug)}
                    className="text-sm"
                  >
                    {b.cover ? (
                      <img
                        src={`/api/puzzlebooks/${encodeURIComponent(b.slug)}/diagrams/cover.jpg`}
                        alt=""
                        className="border-border h-10 w-7 shrink-0 rounded-sm border object-cover"
                      />
                    ) : (
                      <span className="bg-muted text-muted-foreground grid h-10 w-7 shrink-0 place-items-center rounded-sm">
                        <BookMarked className="size-3.5" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-foreground truncate text-sm font-medium">{b.title}</span>
                      <ProgressBar total={b.puzzles} solved={b.solved} failed={b.failed} showEmpty />
                    </span>
                    <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                      {b.solved}/{b.puzzles}
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                ))}
              </div>
            )}

            {data.recentDocs.length > 0 && (
              <div className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
                <p className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
                  {t('Recent work')}
                </p>
                {data.recentDocs.map((d) => (
                  <ListRow
                    key={d.kind + d.id}
                    divided
                    onClick={() =>
                      navigate(d.kind === 'study' ? 'studies' : 'notes', encodeURIComponent(d.id))
                    }
                    className="text-sm"
                  >
                    {d.kind === 'study' ? (
                      <Library className="text-muted-foreground size-3.5 shrink-0" />
                    ) : (
                      <NotebookPen className="text-muted-foreground size-3.5 shrink-0" />
                    )}
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {baseName(d.id)}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatAgo(d.updatedAt)}
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                ))}
              </div>
            )}

            {!showTraining &&
              dash.recentGames.length === 0 &&
              data.books.length === 0 &&
              data.recentDocs.length === 0 && (
                <div className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10 lg:col-span-2">
                  <EmptyState
                    icon={Folder}
                    title="Nothing to show yet"
                    body="Recent games, training and studies appear here as you use the vault."
                  />
                </div>
              )}
          </div>
        )}

        {/* Everything not on the grid, reachable — below md only, where
            home is the navigation. From md the sidebar reaches every one
            of these, which is the customise sheet's own argument for
            hiding: home is not the only way anywhere.

            Below sm this is a launcher row: equal columns, icon over
            label, with labels free to break ("Puzzle books") inside their
            cell.

            The column count is inline because it is data now. It was
            `grid-cols-5`, written when this row was exactly five buttons;
            with the row's length up to the user, five columns would strand
            two demoted entries at a fifth of the width each. Tailwind
            cannot see an interpolated class name, and a static map of
            twelve would be a table to keep in step with a catalogue — so
            the one number that varies is set as a style. Up to five share
            the row; beyond that they wrap in fours or fives, never leaving
            a single orphan on the last line. */}
        {launchers.length > 0 && (
        <div
          className="mt-4 grid gap-1 sm:flex sm:flex-wrap sm:justify-center sm:gap-1.5 md:hidden"
          style={{ gridTemplateColumns: `repeat(${launcherColumns(launchers.length)}, minmax(0, 1fr))` }}
        >
          {launchers.map((entry) => (
            <LauncherButton key={entry.id} entry={entry} />
          ))}
        </div>
        )}

        {/* The sheet edits the PHONE's arrangement (its grid and row are
            drawn nowhere from md), which is why it shows both groups
            rather than describing them — on a desktop they are not on
            screen behind it at all. The two card switches still apply at
            every width. */}
        {editing && (
          <Suspense fallback={null}>
            <CustomiseDialog
              layout={effective}
              onChange={save}
              onReset={() => save(null)}
              onClose={() => {
                setEditing(false);
                setSaveError(null);
              }}
              error={saveError}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

