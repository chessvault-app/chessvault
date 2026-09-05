import {
  BookMarked,
  Check,
  ChevronRight,
  Folder,
  Grid3x3,
  Layers,
  Library,
  NotebookPen,
  Puzzle,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { normaliseHomeLayout, type HomeLayout } from '@shared/homeLayout';
import { BrandMark } from '@/components/brand-mark';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { api, apiErrorMessage } from '@/lib/api';
import { formatAgo, formatUntil } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { MiniBoard } from '@/components/mini-board';
import { ProgressBar } from '@/components/progress-bar';
import { ResultBadge } from '@/components/result-badge';
import { Skeleton } from '@/components/skeletons';
import { useDifficultyWord } from '@/puzzles/bands';
import { fetchSolvedToday } from '@/puzzles/today';
import { t } from '@/lib/i18n';
import { HOME_DESTINATIONS, type Destination, type HomeCount } from './destinations';
import { chartedMoves, launcherColumns, resolveHomeLayout } from './layout';
import {
  checklistReservation,
  continueReservation,
  DASH_MAX,
  dashReservation,
  shownOnDesktop,
  storedChecklist,
  type ContinueShape,
  type DashShape,
} from './reservation';

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
  /**
   * The document's own position, as the listing already sends it — a
   * study's first chapter, a note's first board fence. `meaningfulFen`
   * server-side returns null for the starting array, so a document that
   * has not been played into has nothing to draw and says so.
   */
  fen?: string | null;
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

/**
 * What a tile says after its name.
 *
 * A total is a size, and a size is the same every launch: a vault with
 * thirty games showed thirty games for months, so the launcher never
 * looked different from yesterday. The two tiles that have a schedule
 * lead with it instead. `due` is what the trainer wants from you now and
 * is drawn in the warn colour; `today` is what you have already done and
 * is drawn in good; and the total is the fallback, muted, for a tile
 * with nothing moving.
 */
interface TileFigure {
  n: number;
  /** `moves` is the opening map's total, which carries its unit: a bare
      "58" beside a map said nothing a first-timer could decode. */
  kind: 'total' | 'due' | 'today' | 'moves';
}

interface HomeData {
  counts: Partial<Record<HomeCount, TileFigure>>;
  /** Puzzles solved today off the history endpoint; null when it did not
      answer, which is not a zero. Asked at every width now that the
      Puzzles tile reads it. */
  solvedToday: number | null;
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
  /**
   * The repertoire drill's half of the same schedule, off
   * /api/repertoire/meta — the two trainers share the ladder
   * (shared/review.ts), so the two rows below mean the same thing by
   * "due" and are read as one list rather than two dialects.
   */
  repertoire: { attempted: number; due: number; nextDue: string | null };
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
/** Last launch's Continue card, as a shape — the layout reservation. See
    home/reservation.ts for what is in it and why it is not one number. */
const CONTINUE_KEY = 'vault:home-continue';
/** The two keys that shape replaced, one count and one flag. Paint hints
    with no authority over anything, so they are simply dropped rather
    than migrated; the launch that drops them writes the shape itself. */
const CONTINUE_LEGACY_KEYS = ['vault:home-continue-rows', 'vault:home-continue-board'];
/** Last launch's desktop dashboard, as a shape — the same reservation one
    panel down. See home/reservation.ts for why the grid now has one. */
const DASH_KEY = 'vault:home-dash';
/** Whether last launch drew the setup checklist — the third reservation,
    and the only one on this page that a phone reserves too. */
const CHECKLIST_SHOWN_KEY = 'vault:home-checklist-shown';
/**
 * The last layout this device saw, kept only so the first paint draws the
 * page you actually have rather than the default one.
 *
 * A paint hint and never the authority — the same bargain, and the same
 * honesty, as CONTINUE_KEY: the vault decides, this is overwritten by
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

/** The app's colour grammar on a tile's figure: what is owed in warn,
    what is done in good, a size in the muted ink every total wears. */
const FIGURE_TONE: Record<TileFigure['kind'], string> = {
  total: 'text-muted-foreground',
  due: 'text-warn',
  today: 'text-good',
  moves: 'text-muted-foreground',
};

function figureText(figure: TileFigure): string {
  switch (figure.kind) {
    case 'due':
      return t('{n} due', { n: figure.n });
    case 'today':
      return t('{n} today', { n: figure.n });
    case 'moves':
      return t('{n} moves', { n: figure.n });
    default:
      return compact.format(figure.n);
  }
}

/** A study id is a path; the card shows its name. */
const baseName = (id: string): string => id.split('/').at(-1) ?? id;

/**
 * "Alderman R vs Pereira V 2026-01-25" → the name, and the date as a tail
 * the ellipsis cannot reach. A name with no date on the end is just the
 * label. The date is what server/games.ts appends when it collects a
 * game, so the shape is the app's own and not a guess at a user's.
 */
const splitDated = (name: string): { label: string; tail?: string } => {
  const m = /^(.*\S)\s+(\d{4}-\d{2}-\d{2})$/.exec(name);
  return m ? { label: m[1]!, tail: m[2] } : { label: name };
};

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
      {/* Under 320px the row's labels overprint; the glyph stays and the
          name goes to the reader. */}
      <span className="max-[319px]:sr-only">{t(label)}</span>
    </Button>
  );
}

/**
 * One placeholder row of a panel, at ListRow's own rhythm.
 *
 * The rhythm is read from the density token rather than written as the
 * `py-2` it resolves to at the comfortable rung: a compact vault draws
 * these rows 6px shorter, so a literal would stand taller than the row it
 * stands for and the centred page would settle by that much per row.
 *
 * The height comes from an INVISIBLE REAL TEXT LINE and not from a
 * fixed-height bar, for the reason the Continue card found it: iOS sizes
 * this line 1pt shorter than desktop engines do, and an `h-4` bar was that
 * 1pt taller per row. The bars just paint over it. `trailing` is the
 * date, tally or count column the dashboard's rows end with — it changes
 * nothing about the height and everything about whether the placeholder
 * reads as the row it is standing in for.
 */
function PlaceholderRow({
  width,
  trailing,
  icon = true,
}: {
  width: string;
  trailing?: boolean;
  /** The leading glyph most rows carry. Recent games' rows do not — they
      open straight on the players — so their placeholder should not
      either. Same height both ways; this is about reading as the row. */
  icon?: boolean;
}) {
  return (
    <div className="border-border flex w-full items-center gap-2.5 border-b px-3 py-(--row-py) text-sm last:border-b-0 pointer-coarse:min-h-11">
      {icon && <Skeleton className="size-3.5 shrink-0 rounded-sm" />}
      <span className="relative min-w-0 flex-1 font-medium">
        <span className="invisible">&nbsp;</span>
        <Skeleton className={cn('absolute inset-y-0.5 left-0 max-w-full', width)} />
      </span>
      {trailing && <Skeleton className="h-2.5 w-10 shrink-0" />}
    </div>
  );
}

/** Ragged widths, so a column of placeholders does not read as a barcode. */
const ROW_WIDTHS = ['w-36', 'w-44', 'w-28', 'w-40', 'w-32'];

/**
 * The setup checklist's three steps, named once. The placeholder below
 * holds each row's place by rendering the same words invisibly — these
 * labels are sentences that do NOT truncate, so on a phone they wrap to
 * two lines and the row is as tall as the words make it. A single-line
 * placeholder (the dashboard rows' shape, whose labels all truncate) was
 * ~20px short per wrapped row, on the one page that is centred — half of
 * every shortfall moved everything on screen.
 */
const CHECKLIST_LABELS = [
  'Add your Lichess or Chess.com username and the Games page fills itself',
  'Fetch the puzzle database so the trainer runs offline',
  'Import a scanned tactics book and its diagrams become puzzles',
] as const;

/**
 * The checklist's place while the answer is in the air, at the real
 * card's own geometry: the header holds the dismiss button's box
 * invisibly (icon-sm grows from 28 to 36px under a coarse pointer, and
 * pinned to its text line the header was 8px short on every phone), and
 * each row wraps exactly where its own words will.
 */
function PlaceholderChecklist() {
  return (
    <div className="bg-card overflow-hidden rounded-xl ring-1 ring-border">
      <div className="border-border flex items-center border-b px-3 pb-1.5 pt-2">
        <p className="text-muted-foreground flex-1 text-sm font-medium">{t('Set up your vault')}</p>
        <span aria-hidden className="-my-1 -mr-1.5 size-7 shrink-0 pointer-coarse:size-9" />
      </div>
      {CHECKLIST_LABELS.map((label) => (
        <div
          key={label}
          className="border-border flex w-full items-center gap-2.5 border-b px-3 py-(--row-py) text-sm last:border-b-0"
        >
          <span className="size-3.5 shrink-0" />
          <span className="relative min-w-0 flex-1">
            <span className="invisible">{t(label)}</span>
            <Skeleton className="absolute inset-y-0.5 left-0 w-full" />
          </span>
          {/* The chevron a pending step ends with — part of the width the
              words wrap inside. */}
          <span className="size-3.5 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * One placeholder panel of the desktop dashboard: the heading it will
 * open with, then its rows.
 *
 * The heading is the REAL heading and not a bar, because it is the one
 * thing about the panel this device already knows — it names which panel
 * is coming rather than making the reader wait to find out — and drawing
 * it from the panel's own classes is what keeps the 35px it measures in
 * step with the panel's.
 *
 * `books` swaps the row: a puzzle book's row is built round a 40px cover
 * and measures 56px against the others' 37, so a book panel reserved with
 * ordinary rows would be 19px short per book.
 */
function PlaceholderPanel({
  title,
  rows,
  books = false,
  trailing = true,
  icon = true,
}: {
  title: string;
  rows: number;
  books?: boolean;
  /** The date, tally or count column the dashboard's rows end with. The
      checklist's rows have none — only a tick and a chevron. */
  trailing?: boolean;
  /** See PlaceholderRow: the games panel's rows carry no leading glyph. */
  icon?: boolean;
}) {
  return (
    <div className="bg-card overflow-hidden rounded-xl ring-1 ring-border">
      <h2 className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
        {title}
      </h2>
      {Array.from({ length: rows }, (_, i) =>
        books ? (
          <div
            key={i}
            className="border-border flex w-full items-center gap-2.5 border-b px-3 py-(--row-py) text-sm last:border-b-0"
          >
            <Skeleton className="h-10 w-7 shrink-0 rounded-sm" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <Skeleton className="h-3.5 w-32 max-w-full" />
              <Skeleton className="h-2 w-full" />
            </span>
            <Skeleton className="h-2.5 w-8 shrink-0" />
          </div>
        ) : (
          <PlaceholderRow
            key={i}
            width={ROW_WIDTHS[i % ROW_WIDTHS.length]!}
            trailing={trailing}
            icon={icon}
          />
        ),
      )}
    </div>
  );
}

/**
 * The recent games, as a panel: the collection's newest first, each with
 * its result and date, and the collection's size in the heading.
 *
 * One component for both widths. The desktop dashboard draws five rows in
 * its grid; the phone draws three of the same rows under Continue, because
 * the person most likely to be on a phone is the one between rounds who
 * wants the game just played, and the phone used to have no list of games
 * at all: the path was the bar, then Games, then finding it. The heading
 * is an h2 with the count beside it, where it was a <p> that heading
 * navigation could not find.
 */
function RecentGamesCard({
  games,
  total,
  className,
}: {
  games: RecentGame[];
  total: number;
  className?: string;
}) {
  return (
    <div className={cn('bg-card overflow-hidden rounded-xl ring-1 ring-border', className)}>
      <div className="border-border flex items-baseline border-b px-3 pb-1.5 pt-2">
        <h2 className="text-muted-foreground flex-1 text-sm font-medium">{t('Recent games')}</h2>
        {/* The collection's size, where a tile used to carry it, with
            its noun: a bare "30" beside a list of three read as a badge
            count. */}
        <span className="text-muted-foreground font-mono text-xs">
          {t('{n} games', { n: compact.format(total) })}
        </span>
      </div>
      {games.map((g) => (
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
            // Gone under 320px, where the names had no width left.
            <ResultBadge result={g.result} className="max-[319px]:hidden" />
          )}
          {/* The PGN's dotted date written the way the Continue row
              writes the same date off a filename: one format on one
              screen. */}
          <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
            {g.date.replaceAll('.', '-')}
          </span>
          <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
        </ListRow>
      ))}
    </div>
  );
}

/** How many recent games the phone draws under Continue: enough to hold
    a weekend's rounds, few enough to keep the grid on the first screen. */
const PHONE_GAMES = 3;

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
  // What the Continue card was LAST launch, so this launch can reserve its
  // space before the data returns. Without it the card popped in a beat
  // after first paint and pushed the whole page down — the most visible
  // jolt of a launch now that nothing covers loading. Wrong by at most one
  // launch; a device with no memory of this vault reserves the floor every
  // vault has (reservation.ts), and only a vault that was seen to have no
  // card reserves nothing.
  //
  // One case it cannot see, and it is the layout echo's blindness rather
  // than this one's: somebody who switched Continue OFF, met on a device
  // that has never opened the vault, gets the floor drawn and then taken
  // away. `effective.continueCard` reads the same empty localStorage the
  // tiles do, so that device draws the default page until the vault
  // answers — of which this card is one part.
  const [reserved] = useState(() => continueReservation(localStorage.getItem(CONTINUE_KEY)));
  // And what the dashboard grid below was, on the same terms. Read once at
  // mount like the card's: a reservation that changed while the answer was
  // in flight would be a second jump rather than none.
  const [reservedDash] = useState(() => dashReservation(localStorage.getItem(DASH_KEY)));
  const [reservedChecklist] = useState(() =>
    checklistReservation(localStorage.getItem(CHECKLIST_SHOWN_KEY)),
  );
  // Hoisted out of the Continue row it labels: that row is built inside a
  // conditional spread, and a hook cannot be called from one.
  const difficultyLabel = useDifficultyWord();

  // The recent games, asked for at every width now that the phone draws
  // them too. This used to wait for md, because /api/games answered with
  // the whole collection as JSON and a phone rendered none of it; the
  // route now takes `?limit=`, so what a phone downloads is the five rows
  // the desktop panel shows, of which it draws three. The parse behind it
  // is mtime-cached per file either way.
  const [dash, setDash] = useState<{
    gamesTotal: number;
    recentGames: RecentGame[];
  } | null>(null);
  useEffect(() => {
    void (async () => {
      const games = await api<{ total?: number; games?: RecentGame[] }>(
        `/api/games?limit=${DASH_MAX.games}`,
      ).catch(() => null);
      // A set after navigating away is a no-op (React 18) and nothing else
      // here outlives the page, so no liveness flag.
      setDash({
        gamesTotal: games?.total ?? 0,
        recentGames: Array.isArray(games?.games) ? games.games.slice(0, DASH_MAX.games) : [],
      });
    })();
  }, []);

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
      const [studies, notes, games, puzzles, settings, books, library, map, repertoire, solvedToday] =
        await Promise.all([
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
        // Counts only — home links to the trainer, it does not drill.
        grab('/api/repertoire/meta'),
        // Null, not 0, when the history did not answer.
        fetchSolvedToday(),
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
      const total = (n: number | undefined): TileFigure | undefined =>
        n === undefined ? undefined : { n, kind: 'total' };
      const counts: Partial<Record<HomeCount, TileFigure>> = {
        studies: total(docs(studies)),
        notes: total(docs(notes)),
        games: total(docs(games)),
      };
      // The library: how many books are on the shelf, once there are any.
      const shelf = (library as { books?: unknown[] } | null)?.books;
      if (Array.isArray(shelf) && shelf.length > 0) counts.books = total(shelf.length);
      // The schedule first, today's work second, and only then the
      // lifetime total: YOUR solves, a personal number like every other
      // tile's, not the size of the Lichess pool. Due and today are both
      // read only once the trainer is set up; before that the tile has
      // nothing to schedule.
      const wins = meta?.user?.wins;
      const dueNow = meta?.ready === true ? (meta.due ?? 0) : 0;
      if (dueNow > 0) counts.puzzles = { n: dueNow, kind: 'due' };
      else if (meta?.ready === true && typeof solvedToday === 'number' && solvedToday > 0)
        counts.puzzles = { n: solvedToday, kind: 'today' };
      else if (typeof wins === 'number' && wins > 0) counts.puzzles = total(wins);
      // The repertoire has no total worth a tile, so it says what is due
      // or nothing.
      const repDue = (repertoire as { due?: number } | null)?.due ?? 0;
      if (repDue > 0) counts.repertoire = { n: repDue, kind: 'due' };
      // Both maps exist the moment the page is first opened, so the number
      // that means anything is the moves under them, and none of them is
      // no number rather than a nought.
      const charted = chartedMoves(map);
      if (charted > 0) counts.openingmap = { n: charted, kind: 'moves' };
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
        solvedToday: typeof solvedToday === 'number' ? solvedToday : null,
        lastStudy: latest(studies),
        lastGame: latest(games),
        attempts: meta?.user?.attempts ?? 0,
        puzzleDbReady: meta?.ready === true,
        hasProfile: Boolean(profile?.chesscom || profile?.lichess),
        hasPuzzleBook: puzzleBooks.length > 0,
        due: meta?.due ?? 0,
        nextDue: meta?.nextDue ?? null,
        repertoire: {
          attempted: (repertoire as { attempted?: number } | null)?.attempted ?? 0,
          due: (repertoire as { due?: number } | null)?.due ?? 0,
          nextDue: (repertoire as { nextDue?: string | null } | null)?.nextDue ?? null,
        },
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

  const continueRows: {
    icon: typeof Grid3x3;
    label: string;
    /**
     * A tail the label's truncation must not eat. A collection game is
     * named "White vs Black YYYY-MM-DD", and at 390px the ellipsis fell
     * exactly on the date, which is the one thing telling three games
     * between the same two players apart. Drawn after the truncating
     * span, at its own width.
     */
    tail?: string;
    detail: string;
    go: () => void;
    /**
     * Drawn on a phone and not on a desktop, which has somewhere better
     * to say the same thing: the repertoire reminder lives in the Training
     * panel.
     *
     * A flag rather than the `md:hidden` it used to be written as, because
     * two things now read it — the class on the row, and the count of rows
     * a desktop actually draws, which is what the next launch reserves.
     * Spelling the class by hand made that count unknowable without
     * matching on a string.
     */
    phoneOnly?: boolean;
  }[] =
    data === null
      ? []
      : [
          // The board above says this at every width once the study has a
          // position, so the row is only for a study that has none.
          ...(data.lastStudy && !data.lastStudy.fen
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
                  ...splitDated(baseName(data.lastGame.id)),
                  detail: t('Last game'),
                  go: () => navigate('games', encodeURIComponent(data.lastGame!.id)),
                },
              ]
            : []),
          // The schedule first, the setting second: "9 due" is what the
          // trainer wants now, and the difficulty word only matters when
          // nothing is. "Any" alone read as a status nobody could decode;
          // it is a difficulty, so it says so.
          ...(data.puzzleDbReady && data.attempts > 0
            ? [
                {
                  icon: Puzzle,
                  label: t('Resume training'),
                  detail:
                    data.due > 0
                      ? t('{n} due', { n: data.due })
                      : difficultyLabel === 'Any'
                        ? t('Any difficulty')
                        : t(difficultyLabel),
                  go: () => navigate('puzzles'),
                },
              ]
            : []),
          // The repertoire's schedule, where a phone can see it. Only
          // when something is actually due: Continue is a way back in,
          // not a place to read a timetable, so "nothing until Tuesday"
          // belongs in the desktop's panel and nowhere else.
          ...(data.repertoire.due > 0
            ? [
                {
                  icon: Layers,
                  label: t('Repertoire review'),
                  detail: t('{n} due', { n: data.repertoire.due }),
                  go: () => navigate('repertoire'),
                  phoneOnly: true,
                },
              ]
            : []),
        ];

  /** The study the board draws, when there is a position to draw. Hoisted
      so the JSX below is not re-narrowing `data` inside a branch that
      only implies it. */
  const boardStudy = data?.lastStudy?.fen ? data.lastStudy : null;

  /** The card this launch settled on, as the next launch has to reserve
      it: what a phone draws, what a desktop draws, and whether there is a
      board on top. */
  const shape: ContinueShape = {
    rows: continueRows.length,
    mdRows: continueRows.filter((row) => !row.phoneOnly).length,
    board: boardStudy !== null,
  };

  // Remembered for the NEXT launch's reservation, above.
  useEffect(() => {
    if (data === null) return;
    localStorage.setItem(CONTINUE_KEY, JSON.stringify(shape));
    // Beside it, because the checklist is known from this same answer and
    // is drawn at every width — the dashboard's shape below has to wait
    // for a second batch a phone never asks for.
    localStorage.setItem(CHECKLIST_SHOWN_KEY, storedChecklist(showChecklist));
    for (const key of CONTINUE_LEGACY_KEYS) localStorage.removeItem(key);
    // `shape` is derived from data; keying on data is keying on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // First-run steps, each ending in a feature lighting up. The list only
  // exists while something is unlit, and can be dismissed for good.
  const checklist: { label: string; done: boolean; go: () => void }[] =
    data === null
      ? []
      : [
          {
            label: t(CHECKLIST_LABELS[0]),
            done: data.hasProfile,
            go: () => navigate('settings'),
          },
          {
            label: t(CHECKLIST_LABELS[1]),
            done: data.puzzleDbReady,
            go: () => navigate('puzzles'),
          },
          {
            label: t(CHECKLIST_LABELS[2]),
            done: data.hasPuzzleBook,
            go: () => navigate('puzzles', 'books'),
          },
        ];
  const showChecklist =
    effective.checklist && data !== null && checklist.some((step) => !step.done);

  // Whether the Training panel has a single row to offer. Stated once,
  // because the dashboard's "nothing at all" card is the negation of every
  // panel's condition, and a duplicated condition is how the two drift.
  // Whether the repertoire has a schedule to report at all. A vault that
  // has never drilled says nothing here — an empty reminder is a nag.
  const showRepertoireDue =
    data !== null &&
    data.repertoire.attempted > 0 &&
    (data.repertoire.due > 0 || data.repertoire.nextDue !== null);
  // The Training panel's rows, named once and read three times: by the
  // panel, by the "nothing at all" card that is the negation of every
  // panel's condition, and by the shape the next launch reserves from.
  // They were written inline in the JSX, and a reservation that counted
  // them a second time would be exactly the drift the note above warns
  // about — a placeholder and a panel disagreeing about how many rows are
  // coming is worse than no placeholder, because it moves the page in a
  // direction the reader cannot predict.
  const showSolvedToday = data !== null && data.puzzleDbReady && data.solvedToday !== null;
  const showDue =
    data !== null && data.puzzleDbReady && (data.due > 0 || data.nextDue !== null);
  const showTraining = showSolvedToday || showDue || showRepertoireDue;

  /** The dashboard this launch settled on, as the next launch has to
      reserve it: one count per panel, each read off the condition the
      panel itself is drawn under rather than counted again here. */
  const dashShape: DashShape = {
    training: Number(showSolvedToday) + Number(showDue) + Number(showRepertoireDue),
    games: dash?.recentGames.length ?? 0,
    books: data?.books.length ?? 0,
    docs: data?.recentDocs.length ?? 0,
  };

  // Written only once BOTH batches are in, because that is when the grid
  // is drawn: storing it on `data` alone would record a dashboard with no
  // games in it every launch, and reserve one short from then on.
  useEffect(() => {
    if (data === null || dash === null) return;
    localStorage.setItem(DASH_KEY, JSON.stringify(dashShape));
    // `dashShape` is derived from the two answers; keying on them is
    // keying on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dash]);


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
    // max-md:p-4 is not taste, it is alignment: PageShell insets a phone
    // by 16px (`px-4 pt-4`), so at p-6 this page's header sat 8px lower
    // and further right than the header of every page reachable from it
    // (lanph3re, comparing on the phone). From md the 24px stays — the
    // desktop has no header row to line up and the dashboard breathes
    // better for it.
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] place-items-center overflow-y-auto overflow-x-hidden p-6 max-md:grid-rows-[auto_1fr] max-md:p-4">
      {/* The page's heading — VISIBLE on a phone, a landmark everywhere.

          Its history matters, because it has now moved in both directions.
          What first stood here was a masthead: the mark on a primary tile
          at size-14, the app's name at text-2xl, and the tagline off the
          landing page — removed on the grounds that a window's chrome
          already names the app and the sidebar carries the mark. Both of
          those grounds are DESKTOP grounds: a phone has no sidebar and no
          window chrome, so below md the launcher opened under a strip of
          nothing where every other page shows its header (lanph3re, on
          the phone). So the heading is drawn there again — the bare mark
          beside the name at the header type size, top-left in the first
          grid row while the launcher keeps the second row's centring —
          and from md it returns to sr-only, because there the sidebar
          carries the same pair, one flex-line to the left.

          One h1 in both states: deleting it outright would leave the only
          route in the app with no heading at all.

          mb-4 is PageShell's own gap-4: the 16px every scrolling page
          puts between its title row and what follows. This was mb-2,
          and Continue's card sat 8px under the name while the Games
          page's tabs sat 16px under theirs (lanph3re, comparing on the
          phone). */}
      <h1 className="flex items-center gap-2.5 justify-self-start max-md:mb-4 md:sr-only">
        {/* The mark bare, not on the sidebar's primary tile (lanph3re):
            a page header is type, and a filled tile beside it read as a
            button. currentColor keeps it in the heading's own ink. */}
        <BrandMark className="size-6 shrink-0" />
        <span className="text-xl font-semibold tracking-tight">{t('Chess Vault')}</span>
      </h1>
      {/* A column, so the phone can reorder without drawing anything
          twice: the checklist is first-run content and a returning vault
          has done most of it, so below md it takes `order-1` and lands
          under the Shortcuts grid, which is the phone's navigation and
          was the fourth block on a full vault (top of the grid measured
          at y=845 on an 844px viewport). From md the source order is
          the drawn order. */}
      <div className="flex w-full max-w-lg flex-col md:max-w-2xl lg:max-w-3xl">
        {/* Continue — the best retention surface on the page. A returning
            user lands one tap from where they left off. Before the data
            arrives, the card is reserved at last launch's size with
            skeleton rows — or, on a device that has never opened this
            vault, at the size every vault's welcome study makes — so the
            page does not jump when it fills in. */}
        {effective.continueCard && data === null && reserved !== null && (
          <div
            role="status"
            aria-label={t('Loading')}
            aria-live="polite"
            className={cn(
              'bg-card mb-4 overflow-hidden rounded-xl ring-1 ring-border',
              // Nothing but phone-only rows: a heading over an empty box
              // at this width, so the desktop reserves none of it. Decided
              // in CSS rather than from a JS breakpoint, so a window
              // dragged across `md` mid-load cannot leave one behind.
              !shownOnDesktop(reserved) && 'md:hidden',
            )}
          >
            <h2 className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
              {t('Continue')}
            </h2>
            {reserved.board && (
              <div className="border-border border-l-primary bg-primary/10 flex items-center gap-3 border-b border-l-2 px-3 py-3">
                <Skeleton className="size-24 shrink-0 rounded-sm" />
                <span className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-44 max-w-full" />
                  <Skeleton className="mt-1.5 h-4 w-24 max-w-full" />
                </span>
              </div>
            )}
            {Array.from({ length: reserved.rows }, (_, i) => (
              <div
                key={i}
                className={cn(
                  'border-border flex w-full items-center gap-2.5 border-b px-3 text-sm last:border-b-0',
                  // ListRow's own rhythm, read from the density token
                  // rather than written as the py-2 it resolves to at the
                  // comfortable rung. A compact vault draws these rows
                  // 6px shorter than a literal py-2, so the placeholder
                  // stood taller than the card it stood for and the page
                  // settled upwards by that much per row as it landed.
                  'py-(--row-py)',
                  // ListRow's coarse floor too. It was added to the row
                  // and not to this, and on a phone the placeholder stood
                  // 37px against the row's 44: measured on the demo, four
                  // stored rows moved the whole page 28px as the card
                  // filled in.
                  'pointer-coarse:min-h-11',
                  // The rows a desktop will not draw. Which of them carry
                  // the class does not matter — every placeholder here is
                  // the same — only how many, so the trailing ones take
                  // it. Real card, real mechanism: these are `md:hidden`
                  // there too.
                  i >= reserved.mdRows && 'md:hidden',
                )}
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
        {effective.continueCard && (continueRows.length > 0 || boardStudy !== null) && (
          <div
            className={cn(
              'bg-card mb-4 overflow-hidden rounded-xl ring-1 ring-border',
              // The same rule the placeholder above is drawn under, so the
              // two agree: a card of nothing but phone-only rows is a
              // "Continue" heading over an empty box on a desktop.
              !shownOnDesktop(shape) && 'md:hidden',
            )}
          >
            <h2 className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
              {t('Continue')}
            </h2>
            {/* The one place on this page that shows chess.
                Home was five panels of identical chevron rows — a vault
                holding thirty annotated games and a dozen studies showed
                its owner a settings-app list, and the board, which is the
                only thing here allowed to carry colour, appeared nowhere.
                So the top of Continue is the position you were actually
                last in, drawn from the `fen` the listing already sends.
                No extra request: this is the eager landing chunk, and
                MiniBoard is a FEN parser with no dependency on the real
                board.
                At every width. It was desktop-only, on the grounds that a
                96px board would push the phone's targets under the fold,
                and the phone drew the study as a text row instead. That
                left the launcher of a chess app with no chess on it. The
                board row replaces that text row rather than sitting above
                it, so the card grows by the board less a row, 77px at the
                comfortable rung (a 121px row for a 44px one, measured on
                the demo at 375px), and stays the
                first thing on screen.
                Marked, the way a marked shelf card is: a primary left
                edge and a 10% wash, which is the app's tint everywhere
                else. This row is "where you were", which is what marked
                means on the shelf, and it is the card's one such row.
                On the untinted theme the wash is a lifted row and no
                more; with a tint it takes the accent, so the page has
                one filled thing (the lead tile) and one washed thing
                and they read as two weights of the same colour. */}
            {boardStudy?.fen && (
              <button
                type="button"
                onClick={() => navigate('studies', encodeURIComponent(boardStudy.id))}
                className={cn(
                  'border-border border-l-primary bg-primary/10 hover:bg-accent flex w-full items-center gap-3 border-b border-l-2 px-3 py-3 text-left transition-colors duration-100',
                  // The ring inset, for the reason ListRow gives: the card
                  // clips an outline drawn outside a full-width row.
                  'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none',
                  // Under 320px (200% zoom on a 390 phone) the board is
                  // `shrink-0` and the title beside it was one glyph
                  // wide; the title goes under the board instead.
                  'max-[319px]:flex-wrap',
                )}
              >
                <MiniBoard fen={boardStudy.fen} size={96} className="shrink-0 rounded-sm" />
                {/* basis-full under 320px, or flex-1 shrinks the title
                    to a few letters beside the board instead of taking
                    the wrap the button offers. */}
                <span className="min-w-0 flex-1 max-[319px]:basis-full">
                  <span className="text-foreground block truncate text-base font-semibold">
                    {baseName(boardStudy.id)}
                  </span>
                  <span className="text-muted-foreground block truncate text-sm">
                    {t('Continue study')}
                  </span>
                </span>
                {/* Gone where the title wraps under the board: a chevron
                    alone on a third line is a row of nothing. */}
                <ChevronRight className="text-muted-foreground size-3.5 shrink-0 max-[319px]:hidden" />
              </button>
            )}
            {continueRows.map(({ icon: Icon, label, tail, detail, go, phoneOnly }) => (
              <ListRow
                key={label + detail}
                divided
                onClick={go}
                className={cn('text-sm', phoneOnly && 'md:hidden')}
              >
                <Icon className="text-muted-foreground size-3.5 shrink-0" />
                <span className="text-foreground flex min-w-0 flex-1 items-baseline gap-1.5 font-medium">
                  <span className="min-w-0 truncate">{label}</span>
                  {tail && (
                    <span className="text-muted-foreground shrink-0 font-mono text-xs font-normal tabular-nums">
                      {tail}
                    </span>
                  )}
                </span>
                {/* Under 320px a row with a date tail has no room for
                    both; the date is the fact, the detail is the caption. */}
                <span className={cn('text-muted-foreground shrink-0', tail && 'max-[319px]:hidden')}>
                  {detail}
                </span>
                <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
              </ListRow>
            ))}
          </div>
        )}

        {/* The phone's recent games, under Continue and above the
            checklist: a returning player's rounds outrank a first-run
            list. Reserved from the same dashboard shape the desktop
            stores, capped at the rows the phone draws, so the card lands
            where its placeholder stood. A device that has never seen the
            vault reserves none (WELCOME_DASH has no games), which is
            right: a fresh vault has none. */}
        {dash === null && reservedDash !== null && reservedDash.games > 0 && (
          <div role="status" aria-label={t('Loading')} aria-live="polite" className="mb-4 md:hidden">
            <PlaceholderPanel
              title={t('Recent games')}
              rows={Math.min(reservedDash.games, PHONE_GAMES)}
              icon={false}
            />
          </div>
        )}
        {dash !== null && dash.recentGames.length > 0 && (
          <RecentGamesCard
            games={dash.recentGames.slice(0, PHONE_GAMES)}
            total={dash.gamesTotal}
            className="mb-4 md:hidden"
          />
        )}

        {/* The checklist's place while the answer is in the air. Three
            fixed steps, so there is nothing to count — either last launch
            drew this card or it did not. A device that has never been here
            reserves nothing: unlike Continue and the grid, this card is
            the one thing on the page that a settled vault has finished
            with for good (reservation.ts). */}
        {data === null && reservedChecklist && (
          <div
            role="status"
            aria-label={t('Loading')}
            aria-live="polite"
            className="mb-4 max-md:order-1 max-md:mt-4 max-md:mb-0"
          >
            <PlaceholderChecklist />
          </div>
        )}

        {showChecklist && (
          // Below md: after the grid (order-1) and before the launcher
          // row (order-2); its margin moves to the top so the rhythm
          // stays one gap-4 whether or not it is drawn.
          <div className="bg-card mb-4 overflow-hidden rounded-xl ring-1 ring-border max-md:order-1 max-md:mt-4 max-md:mb-0">
            <div className="border-border flex items-center border-b px-3 pb-1.5 pt-2">
              {/* An h2 like Continue's: this was a <p>, so a reader
                  jumping by heading found one section on a page of
                  four. */}
              <h2 className="text-muted-foreground flex-1 text-sm font-medium">
                {t('Set up your vault')}
              </h2>
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
            {checklist.map((step) =>
              step.done ? (
                // A done step is a fact, not a control: it was a disabled
                // button, which most screen readers skip, so a reader
                // never heard that two of three steps were done. A plain
                // row at ListRow's rhythm, marked and quietened, not
                // struck through and lit green. The ring-and-tick pair
                // over a strikethrough is the onboarding-reward idiom, and
                // green is spoken for here: the colour grammar gives it
                // to outcomes (solved, won), so a green tick on a settings
                // shortcut reads as a result somebody earned.
                <div
                  key={step.label}
                  // Muted, not faded: muted-foreground passes 4.5:1 on
                  // the card; the disabled button's opacity-60 on top of
                  // it composited to 2.7:1 (measured), and the tick and
                  // "Done" already carry the state.
                  className="border-border text-muted-foreground flex w-full items-center gap-2.5 border-b px-3 py-(--row-py) text-sm last:border-b-0 pointer-coarse:min-h-11"
                >
                  <Check aria-hidden className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    {step.label}
                    <span className="sr-only">. {t('Done')}</span>
                  </span>
                </div>
              ) : (
                <ListRow key={step.label} divided onClick={step.go} className="text-sm">
                  {/* A pending step carries no marker at all; the row's
                      own chevron already says it is a way in, and the
                      spacer keeps the labels in one column. */}
                  <span aria-hidden className="size-3.5 shrink-0" />
                  <span className="text-foreground min-w-0 flex-1">{step.label}</span>
                  <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                </ListRow>
              ),
            )}
          </div>
        )}

        {/* The caption idiom the cards above use, carrying the way in to
            the sheet. Outside the grid deliberately: with every tile
            switched off there would otherwise be nothing left to press. */}
        <div className="mb-2 flex items-center px-1">
          {/* One caption, two rooms: below md it heads the launcher grid,
              from md the dashboard panels. The customise button is the
              same on both — the sheet's card switches apply everywhere. */}
          <h2 className="text-muted-foreground flex-1 text-sm font-medium">
            <span className="md:hidden">{t('Shortcuts')}</span>
            <span className="max-md:hidden">{t('Overview')}</span>
          </h2>
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
        <div className="grid grid-cols-2 gap-2 max-[319px]:grid-cols-1 sm:grid-cols-3 md:hidden">
          {tiles.map(({ id, label, blurb, icon: Icon, nav, count }, i) => {
            // The first tile is the lead: the whole row, laid out as a
            // row, with its glyph a size up. The order is the user's own
            // (Customise home), so whatever they put first is what the
            // page leads with. One tile and not a ranking: a second wide
            // tile would be a list.
            const lead = i === 0;
            // FILLED with primary only when it has a reason to be: a
            // schedule that wants you now. The fill is the FAB's own
            // paint, the page's one primary action, and it used to go to
            // whatever tile stood first, so demoting Board made "Set up
            // any position" the loudest thing on a phone. A tile with
            // nothing due is wide and quiet, and the Continue card's wash
            // stays the page's one marked thing.
            const figure = count === undefined ? undefined : data?.counts[count];
            const filled = lead && figure?.kind === 'due';
            return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(...nav)}
              className={cn(
                'flex rounded-xl p-3.5 text-left transition-colors duration-100',
                lead ? 'col-span-full items-center gap-3' : 'flex-col items-start gap-2',
                filled
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-card hover:bg-accent ring-border ring-1',
              )}
            >
              {/* The accent at rest, not on hover. The glyph used to turn
                  primary under the pointer, and this grid is drawn only
                  below md, where the pointer is a thumb: the one colour
                  designed into the tiles was unreachable on the one
                  device that draws them. Now it is the page's colour,
                  and Appearance's tint has somewhere on home to show.
                  On the lead's fill it is the fill's own ink instead. */}
              <Icon
                className={cn(
                  'shrink-0',
                  lead ? 'size-6' : 'size-4.5',
                  filled ? 'text-primary-foreground' : 'text-primary',
                )}
              />
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-base font-medium',
                    filled ? 'text-primary-foreground' : 'text-foreground',
                  )}
                >
                  {t(label)}
                  {figure !== undefined ? (
                    <span
                      className={cn(
                        // Its own line under the name. Inline, a figure
                        // with a unit ("58 moves") took the name's last
                        // word down with it and read as part of the
                        // name; and at 200% zoom the nowrap overflowed
                        // the tile.
                        'block font-mono text-sm font-normal',
                        // The colour grammar has no room on a primary
                        // fill: amber on the tinted blue is mud, so the
                        // filled lead's figure is its ink at 80%.
                        filled ? 'text-primary-foreground/80' : FIGURE_TONE[figure.kind],
                      )}
                    >
                      {figureText(figure)}
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
                <span
                  className={cn(
                    'block text-sm leading-snug',
                    filled ? 'text-primary-foreground/80' : 'text-muted-foreground',
                  )}
                >
                  {t(blurb)}
                </span>
              </span>
            </button>
            );
          })}
        </div>

        {/* The dashboard's place, held while the two batches are in the
            air, at the size last launch's grid came to (reservation.ts).
            Both the panels and their row counts are reserved, because the
            grid is two columns and a row of it is as tall as the taller
            panel in it — a total would have reserved the right number of
            rows in the wrong column and been wrong by the difference.

            The wait this covers is one round trip against a warm vault,
            which is what the argument for reserving nothing rested on.
            What that argument missed is that this page is CENTRED: an
            unreserved grid does not push the page down, it moves every
            other thing on it by half the grid, and the thing it moved
            furthest was the Continue card above — the one element here
            that was already reserved to the pixel. Measured at 1920x1080:
            306px, upwards, on every launch. */}
        {(data === null || dash === null) && reservedDash !== null && (
          <div
            role="status"
            aria-label={t('Loading')}
            aria-live="polite"
            className="grid gap-3 max-md:hidden lg:grid-cols-2"
          >
            {reservedDash.training > 0 && (
              <PlaceholderPanel title={t('Training')} rows={reservedDash.training} />
            )}
            {reservedDash.games > 0 && (
              <PlaceholderPanel title={t('Recent games')} rows={reservedDash.games} icon={false} />
            )}
            {reservedDash.books > 0 && (
              <PlaceholderPanel title={t('Puzzle books')} rows={reservedDash.books} books />
            )}
            {reservedDash.docs > 0 && (
              <PlaceholderPanel title={t('Recent work')} rows={reservedDash.docs} />
            )}
          </div>
        )}

        {/* The dashboard — what is happening in the vault, drawn only
            where the sidebar already does the navigating. It waits for
            both answer batches so the grid lands once instead of
            reflowing panel by panel; what holds its place until then is
            the placeholder above. A panel with nothing to say is not
            drawn — an empty box is a question, not a fact — and a vault
            with nothing at all says so once, in one card. */}
        {data !== null && dash !== null && (
          <div className="grid gap-3 max-md:hidden lg:grid-cols-2">
            {showTraining && (
              <div className="bg-card overflow-hidden rounded-xl ring-1 ring-border">
                <h2 className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
                  {t('Training')}
                </h2>
                {/* Today's count is skipped when the history endpoint did
                    not answer: a nought that is really an error would say
                    you have not trained when you may well have. */}
                {showSolvedToday && (
                  <ListRow divided onClick={() => navigate('puzzles')} className="text-sm">
                    <Puzzle className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {/* Non-null by showSolvedToday, which is the
                          condition this row is drawn under. */}
                      {t('Solved today: {n}', { n: data.solvedToday! })}
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                )}
                {showDue && (
                  <ListRow divided onClick={() => navigate('puzzles')} className="text-sm">
                    <RotateCcw className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {data.due > 0
                        ? t('{n} due for review', { n: data.due })
                        : t('Nothing due. The next review lands {when}', {
                            when: formatUntil(data.nextDue!),
                          })}
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                )}
                {/* The repertoire's own reminder, in the same panel and
                    the same words as the puzzles' — the two trainers
                    share one ladder, so what is due in each belongs on
                    one list rather than in two places to remember to
                    look. It carries the repertoire's own glyph so the
                    row says which trainer it is sending you to. */}
                {showRepertoireDue && (
                  <ListRow divided onClick={() => navigate('repertoire')} className="text-sm">
                    <Layers className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {data.repertoire.due > 0
                        ? t('{n} repertoire positions due', { n: data.repertoire.due })
                        : t('Repertoire: the next position comes back {when}', {
                            when: formatUntil(data.repertoire.nextDue!),
                          })}
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </ListRow>
                )}
              </div>
            )}

            {dash.recentGames.length > 0 && (
              <RecentGamesCard games={dash.recentGames} total={dash.gamesTotal} />
            )}

            {data.books.length > 0 && (
              <div className="bg-card overflow-hidden rounded-xl ring-1 ring-border">
                <h2 className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
                  {t('Puzzle books')}
                </h2>
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
                      <ProgressBar total={b.puzzles} solved={b.solved} failed={b.failed} showEmpty decorative />
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
              <div className="bg-card overflow-hidden rounded-xl ring-1 ring-border">
                <h2 className="text-muted-foreground border-border border-b px-3 pb-1.5 pt-2 text-sm font-medium">
                  {t('Recent work')}
                </h2>
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
                <div className="bg-card overflow-hidden rounded-xl ring-1 ring-border lg:col-span-2">
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
          className="mt-4 grid gap-1 max-md:order-2 sm:flex sm:flex-wrap sm:justify-center sm:gap-1.5 md:hidden"
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

