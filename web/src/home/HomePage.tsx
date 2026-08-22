import { BookOpen, Check, ChevronRight, Grid3x3, Library, Puzzle, SlidersHorizontal, X } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { normaliseHomeLayout, type HomeLayout } from '@shared/homeLayout';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/list-row';
import { Skeleton } from '@/components/skeletons';
import { KnightIcon } from '@/components/knight-icon';
import { useDifficultyWord } from '@/puzzles/bands';
import { t } from '@/lib/i18n';
import { HOME_DESTINATIONS, type HomeCount } from './destinations';
import { chartedMoves, launcherColumns, resolveHomeLayout } from './layout';

// Lazy, alone among this page's imports, and for the same reason the page
// itself is eager: Sheet brings a portal, the drag, the cover measurement
// and the focus trap, and most launches never open it. The landing chunk
// pays for what every launch draws and nothing else.
const CustomiseDialog = lazy(() =>
  import('@/home/CustomiseDialog').then((m) => ({ default: m.CustomiseDialog })),
);

/**
 * The landing page. It used to be six static tiles — four duplicating the
 * sidebar, five destinations unreachable, nothing for a returning user to
 * resume and nothing for a new one to start with. It is still a launcher,
 * but it leads with what you were doing (Continue), tells a fresh vault
 * what to set up first (each step ends in a feature lighting up), reaches
 * everything, and the counts it shows are all yours — the puzzle tile
 * used to show the 6.1M Lichess pool in the slot every other tile used
 * for personal counts, which read as a lie until decoded.
 *
 * The two rows of destinations are no longer written here: they come from
 * the catalogue in `destinations.ts`, arranged by `layout.ts`. Which of
 * them are tiles is a property of the vault, not of this file.
 */

interface DocMeta {
  id: string;
  updatedAt: string;
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

function latest(v: unknown): DocMeta | null {
  const list = (v as { studies?: DocMeta[] })?.studies;
  if (!Array.isArray(list) || list.length === 0) return null;
  return [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null;
}

/** A study id is a path; the card shows its name. */
const baseName = (id: string): string => id.split('/').at(-1) ?? id;

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
      const [studies, notes, games, puzzles, settings, books, map] = await Promise.all([
        grab('/api/studies'),
        grab('/api/notes'),
        grab('/api/games/docs'),
        grab('/api/puzzles/meta'),
        grab('/api/settings'),
        grab('/api/puzzlebooks'),
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
      const meta = puzzles as { ready?: boolean; user?: { attempts?: number; wins?: number } } | null;
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
      // YOUR solves — a personal number like every other tile's, not the
      // size of the Lichess pool.
      const wins = meta?.user?.wins;
      if (typeof wins === 'number' && wins > 0) counts.puzzles = wins;
      // Both maps exist the moment the page is first opened, so the number
      // that means anything is the moves under them, and none of them is
      // no number rather than a nought.
      const charted = chartedMoves(map);
      if (charted > 0) counts.openingmap = charted;
      setData({
        counts,
        lastStudy: latest(studies),
        lastGame: latest(games),
        attempts: meta?.user?.attempts ?? 0,
        puzzleDbReady: meta?.ready === true,
        hasProfile: Boolean(profile?.chesscom || profile?.lichess),
        hasPuzzleBook: Array.isArray((books as { books?: unknown[] })?.books)
          ? ((books as { books: unknown[] }).books.length > 0)
          : false,
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

  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

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
                  icon: BookOpen,
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
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] place-items-center overflow-y-auto overflow-x-hidden p-6">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="bg-primary text-primary-foreground grid size-14 place-items-center rounded-2xl">
            <KnightIcon className="size-9" />
          </div>
          <div>
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('Chess Vault')}</h1>
            <p className="text-subtle text-base">{t('Your chess, in plain files.')}</p>
          </div>
        </div>

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
                <Icon className="text-subtle size-3.5 shrink-0" />
                <span className="text-foreground min-w-0 flex-1 truncate font-medium">{label}</span>
                <span className="text-subtle shrink-0">{detail}</span>
                <ChevronRight className="text-subtle size-3.5 shrink-0" />
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
                {step.done ? (
                  <Check className="text-good size-3.5 shrink-0" />
                ) : (
                  <span className="border-border-strong size-3.5 shrink-0 rounded-full border" />
                )}
                <span
                  className={
                    step.done ? 'text-subtle min-w-0 flex-1 line-through' : 'text-foreground min-w-0 flex-1'
                  }
                >
                  {step.label}
                </span>
                {!step.done && <ChevronRight className="text-subtle size-3.5 shrink-0" />}
              </ListRow>
            ))}
          </div>
        )}

        {/* The caption idiom the cards above use, carrying the way in to
            the sheet. Outside the grid deliberately: with every tile
            switched off there would otherwise be nothing left to press. */}
        <div className="mb-2 flex items-center px-1">
          <p className="text-muted-foreground flex-1 text-sm font-medium">
            {t('Shortcuts')}
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

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map(({ id, label, blurb, icon: Icon, nav, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => navigate(...nav)}
              className="bg-card hover:-strong hover:bg-accent group flex flex-col items-start gap-2 rounded-xl ring-1 ring-foreground/10 p-3.5 text-left transition-colors duration-100"
            >
              <Icon className="text-subtle group-hover:text-primary size-4.5 transition-colors" />
              <span>
                <span className="text-foreground block text-base font-medium">
                  {t(label)}
                  {count !== undefined && data?.counts[count] !== undefined ? (
                    <span className="text-subtle font-mono text-sm font-normal">
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
                <span className="text-subtle block text-sm leading-snug">{t(blurb)}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Everything not on the grid, reachable. Below sm this is a
            launcher row: equal columns, icon over label, with labels free
            to break ("Puzzle books") inside their cell.

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
          className="mt-4 grid gap-1 sm:flex sm:flex-wrap sm:justify-center sm:gap-1.5"
          style={{ gridTemplateColumns: `repeat(${launcherColumns(launchers.length)}, minmax(0, 1fr))` }}
        >
          {launchers.map(({ id, label, icon: Icon, nav }) => (
            <Button
              key={id}
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
          ))}
        </div>
        )}

        {/* The sheet is a layer over this page, so the arrangement being
            edited is the one on screen behind it — on a desktop, at least;
            a phone's sheet covers it, which is why the sheet itself shows
            both groups rather than describing them. */}
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

