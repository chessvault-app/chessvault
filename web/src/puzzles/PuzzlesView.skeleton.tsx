import { BarChart3, ChevronRight, Eye, Info, Lightbulb, ListOrdered, Puzzle, Settings2, X } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/text-fields';
import { PageShell } from '@/components/page-shell';
import { ChipRow } from '@/components/chip-row';
import { Panel, PanelHeader } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { DIFFICULTIES, storedDifficulty, type DifficultyId } from './bands';
import { themeLabel } from './theme-labels';
import { OutlineCreate, ShelfHeader } from '@/components/shelf-outline';
import { readShelfOrder } from '@/components/shelf-toolbar';
import {
  Inert,
  Skeleton,
  SkeletonBoard,
  SkeletonBookCards,
  SkeletonSubtitle,
  SkeletonThemeCard,
  SkeletonThemeGroups,
  SkeletonTiles,
} from '@/components/skeletons';
import { parseShelfShape, EMPTY_SHELF } from '@/components/shelf-reservation';
import {
  PUZZLE_BOOK_NATURAL,
  PUZZLE_BOOK_SORTS,
  PUZZLE_SHELF_KEY,
  PUZZLE_SHELF_ORDER_KEY,
  readBookShape,
  readDashboardShape,
  readThemesShape,
} from '@/puzzles/reservation';
import { decodeSegment, navigate } from '@/lib/router';
import { useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The Puzzles section while its chunk is on the wire.
 *
 * Six pages live behind one route here, and the outline used to draw one
 * picture for all of them: `PageShell` with the word "Puzzles" in a page
 * header. For four of them that was a fraction of the page; for the two
 * trainers it was WRONG — a trainer is a board on BOARD_HELD_SHELL and
 * has no page header at all, so the placeholder drew a title where none
 * was coming and the whole layout changed underneath it when the chunk
 * landed.
 *
 * So it reads the address, as the Notes and Studies outlines do, and
 * every branch draws the same component the page itself draws while its
 * own answers are out. The pieces those pages and this module share live
 * here (the hub's two rows, the theme card, the book page's
 * reservation), so neither side can restate the other's geometry.
 */
export default function PuzzlesOutline({ params = [] }: { params?: string[] }) {
  const head = params[0] ?? '';
  if (head === 'hub') return <HubOrDashboard />;
  if (head === 'themes') return <ThemesOutline />;
  if (head === 'dashboard') return <DashboardOutline />;
  if (head === 'books')
    return params[1] ? <BookOutline slug={decodeSegment(params[1])} /> : <PuzzleShelfOutline />;
  return <TrainerOutline params={params} />;
}

/* -------------------------------------------------------------- hub */

/**
 * `#/puzzles/hub` is the launcher on a phone and the dashboard above it
 * — a media query, rendered rather than redirected (HubPage) — and the
 * two are different pages, so the outline asks the same question.
 */
function HubOrDashboard() {
  const phone = useMediaQuery('(max-width: 47.9375rem)');
  return phone ? <HubOutline /> : <DashboardOutline />;
}

/**
 * The launcher, whole.
 *
 * This page can promise its shape before it has any data: three place
 * rows and three cards, always. Whether a card is a puzzle or an empty
 * slot changes what is on it, never its size, so the settled layout is
 * this layout with the content taken out.
 */
function HubOutline() {
  return (
    <PageShell width="medium" className="h-full gap-2 pb-3">
      {/* mb-2 on top of the column's gap-2, as HubPage draws it: the
          title keeps the shell's 16px to the row under it while the
          cards below stay 8px apart. Without it every row here stood
          8px high of where it lands. */}
      <PageHeader title={t('Puzzles')} className="mb-2" />
      <HubPlaceRow />
      <HubPlaceRow />
      <HubPlaceRow />
      {/* The boards take the page's slack and sit on the bottom edge,
          which is what the launcher's height is for. */}
      <div className="flex flex-1 flex-col justify-end gap-2">
        <HubPuzzleRow />
        <HubPuzzleRow />
        <HubPuzzleRow />
      </div>
    </PageShell>
  );
}

/**
 * The cards' own height budget, shared with the real ones.
 *
 * The floor is a board a position can be read off (84px, with the card's
 * padding): below it the cards were squares of noise on a 568 phone. A
 * screen that cannot hold three at the floor scrolls, which is the
 * shell's escape hatch, rather than shrinking them past legibility.
 *
 * Here rather than in HubPage because both the page and this outline
 * draw boxes against them.
 */
export const HUB_CARD_FILL = 'min-h-24 max-h-[12.25rem] flex-1';
export const HUB_BOARD_FILL = 'h-full max-h-48 w-auto';
/**
 * The two card boxes, which the page and this outline both draw: a puzzle
 * card (and the empty slot, which is the same box), and a place row. The
 * ring costs no layout, so slot and card are the same box; the page adds
 * only its hover, its press and `text-left`.
 */
export const HUB_CARD_SHAPE = 'bg-card ring-card-ring flex w-full items-stretch gap-3 rounded-xl ring-1 px-2.5 py-1.5';
export const HUB_PLACE_SHAPE = 'bg-card ring-card-ring flex w-full shrink-0 items-center gap-3 rounded-xl ring-1 px-3 py-2.5';

/** One of the three PLACES to go, waiting: PlaceCard with its words out. */
export function HubPlaceRow() {
  return (
    <div className={HUB_PLACE_SHAPE}>
      <Skeleton className="size-10 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The title's text-base line box (24px) and the detail's text-sm
            (20px), so the row is the height the real one will be. */}
        <div className="flex h-6 items-center">
          <Skeleton className="h-2.5 w-24" />
        </div>
        <div className="flex h-5 items-center">
          <Skeleton className="h-2 w-2/3" />
        </div>
      </div>
      <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
    </div>
  );
}

/** One of the three PUZZLES to solve, waiting: PuzzleCard's own box. */
export function HubPuzzleRow() {
  return (
    <div className={cn(HUB_CARD_SHAPE, HUB_CARD_FILL)}>
      <Skeleton className={cn('aspect-square shrink-0 rounded-md', HUB_BOARD_FILL)} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0 self-center" />
    </div>
  );
}

/* ----------------------------------------------------------- themes */

/**
 * The themes page, whole: its header and search, the two chips over the
 * grid, and the grid this vault drew last visit.
 *
 * The histogram does not move once the puzzle database is built, so
 * after one visit the wall of seventy cards is reserved exactly; a vault
 * seen without a database reserves nothing, because its settled page is
 * an empty state (puzzles/reservation, readThemesShape).
 */
function ThemesOutline() {
  const reserved = readThemesShape();
  return (
    <PageShell width="medium">
      <Inert>
        <PageHeader
          title={t('Puzzle themes')}
          back={() => navigate('puzzles', 'hub')}
          subtitle={<SkeletonSubtitle />}
          // The page folds its field into the title row on a phone; the
          // outline says the same three things so it draws the same row.
          searchCollapse={{ label: t('Find a theme'), active: false, onClear: NOOP }}
          search={
            <SearchInput
              inputSize="sm"
              value=""
              readOnly
              placeholder={t('Find a theme')}
              aria-label={t('Find a theme')}
              className="w-full"
            />
          }
        />
        <ChipRow innerClassName="gap-2">
          {/* The lit chip is the real card with its count still a bar —
              the page's own `pending` — because its fill and its border
              are what mark it as the one you are on. */}
          <ThemeCard className="w-full sm:w-auto" label={t('All themes')} count={0} pending highlight onClick={NOOP} />
          <SkeletonThemeCard className="w-full sm:w-auto" label={t('Review failed puzzles')} />
        </ChipRow>
      </Inert>
      {reserved === null ? (
        <SkeletonThemeGroups />
      ) : reserved.length > 0 ? (
        <SkeletonThemeGroups counts={reserved} />
      ) : null}
    </PageShell>
  );
}

/**
 * One theme, as a chip: its name, and how many puzzles carry it.
 *
 * Here rather than in ThemesPage because the outline draws the lit "All
 * themes" chip with this component's own `pending` state, and a second
 * copy of its box would be a second answer to how tall a chip is.
 * ThemesPage imports it back.
 */
export function ThemeCard({
  label,
  count,
  onClick,
  highlight = false,
  className,
  icon: Icon = Puzzle,
  pending,
}: {
  label: string;
  count: number;
  onClick: () => void;
  highlight?: boolean;
  className?: string;
  icon?: typeof Puzzle;
  /** The count is not known yet, so it is a bar rather than a 0. */
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left',
        'transition-colors duration-100',
        highlight
          ? 'bg-muted border-primary/30 hover:border-primary/60'
          : 'bg-card border-card-ring hover:border-card-ring hover:bg-accent',
        className,
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0 transition-colors',
          highlight ? 'text-primary' : 'text-muted-foreground group-hover:text-primary',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate type-row font-medium', highlight ? 'text-primary' : 'text-foreground')}>
          {label}
        </span>
        <span className="text-muted-foreground block font-mono type-row-sub">
          {pending ? (
            // A zero that becomes six million is a number the page stated
            // and then took back; the placeholder says nothing instead.
            <Skeleton className="my-1 block h-2 w-10" />
          ) : (
            COMPACT.format(count)
          )}
        </span>
      </span>
    </button>
  );
}

/** The page's own formatter, English on purpose: a compact count is
    read as a figure, and 6.1M is the same figure in every language. */
const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/* -------------------------------------------------------- dashboard */

/**
 * The dashboard's top: its title, the review slot, and the Training
 * panel's own figures.
 *
 * The TOP and not the whole page, on Settings' precedent and for its
 * reason (settings/SettingsPage.skeleton): this page renders correctly
 * with no data at all — every figure is an ellipsis and every panel
 * draws its own placeholder — so an outline of the whole of it would be
 * the page's own layout written a second time, in a chunk that exists to
 * be small. What is drawn is the part that decides whether anything
 * MOVES; the panels below arrive into empty space and push nothing down.
 *
 * The review slot is the one thing on it that changes size, and it is
 * remembered: a button, or that button with a one-line note under it
 * (puzzles/reservation, `review`).
 */
function DashboardOutline() {
  const reserved = readDashboardShape();
  return (
    <PageShell width="medium" className="block">
      <Inert>
        <PageHeader className="mb-4" title={t('Puzzle dashboard')} back={() => navigate('puzzles', 'hub')} />
        {/* Train is what the slot holds when the count is not known —
            the answer may swap it for Review, in the same box. */}
        <div className="mb-4">
          {/* `disabled` and not merely inert, which is what the page's own
              wait draws: the answer may swap this button's words for
              Review, and a filled button that cannot yet do what it says
              is the one control here worth dimming. */}
          <Button variant="default" size="default" className="w-full justify-center" disabled tabIndex={-1}>
            <Puzzle className="glyph" data-icon="inline-start" />
            {t('Train')}
          </Button>
          {reserved.review === 'note' && (
            <div className="mt-2 flex h-5 items-center justify-center">
              <Skeleton className="h-2.5 w-64 max-w-full" />
            </div>
          )}
        </div>
        <Panel className="mb-4 max-lg:[--card-floor:var(--card-spacing)]">
          <PanelHeader title={t('Training')} />
          {/* The page's own figure list, with the ellipsis it prints
              while the counts are out. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-(--card-spacing) type-row sm:grid-cols-[auto_1fr_auto_1fr]">
            <DashFigure label={t('Solved')} />
            <DashFigure label={t('To review')} />
            <DashFigure label={t('Attempts')} />
          </dl>
          <p className="text-muted-foreground mt-2 max-w-prose px-(--card-spacing) text-sm">
            {t('Puzzles whose latest attempt failed. This is the review pool.')}
          </p>
        </Panel>
      </Inert>
    </PageShell>
  );
}

/** One figure of the Training panel, with the ellipsis the page prints
    while its counts are out (DashboardPage's own `…`). */
function DashFigure({ label }: { label: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground font-mono">…</dd>
    </>
  );
}

/* ------------------------------------------------------ puzzle books */

/** The puzzle-book shelf: its toolbar, and the covers it held last visit. */
function PuzzleShelfOutline() {
  const cards = parseShelfShape(readPuzzleShelf(), EMPTY_SHELF).root;
  const view = readShelfOrder(
    PUZZLE_SHELF_ORDER_KEY,
    PUZZLE_BOOK_SORTS,
    PUZZLE_BOOK_NATURAL,
    'title',
  );
  return (
    <PageShell width="medium">
      <ShelfHeader
        title={t('Puzzle books')}
        back={() => navigate('puzzles', 'hub')}
        search={t('Search books…')}
        subtitle
        sorts={PUZZLE_BOOK_SORTS}
        sort={view.sort}
        dir={view.dir}
        // One action, so the button says it rather than opening a menu.
        create={<OutlineCreate label="New book" actions={1} />}
      />
      {cards > 0 && <SkeletonBookCards cards={cards} />}
    </PageShell>
  );
}

const readPuzzleShelf = (): string | null => {
  try {
    return localStorage.getItem(PUZZLE_SHELF_KEY);
  } catch {
    return null;
  }
};

/**
 * One puzzle book: its header, and the Cycles panel over the tile grid,
 * both from this book's own stored shape (puzzles/reservation). A book
 * never opened here keeps the 48-tile guess, which is what BookPage
 * falls back to as well.
 *
 * The title is a blank rather than the slug: the slug is an id, not a
 * name, and the header holds its place rather than flashing a folder
 * name — which is what BookPage does with it too.
 */
function BookOutline({ slug }: { slug: string }) {
  const reserved = readBookShape(slug);
  return (
    <PageShell width="medium" className="block">
      <Inert>
        <PageHeader
          className="mb-4"
          title=" "
          back={() => navigate('puzzles', 'books')}
          backVisible="always"
          truncate
        />
      </Inert>
      {reserved === null ? (
        <SkeletonTiles cycles cyclesProse={cyclesProse(false)} tiles={48} />
      ) : reserved.tiles > 0 ? (
        <SkeletonTiles
          cycles
          cyclesOpen={reserved.open}
          cyclesProse={cyclesProse(reserved.nudge)}
          tiles={reserved.tiles}
        />
      ) : null}
    </PageShell>
  );
}

/**
 * What the cold Cycles panel says — the invitation, and for someone who
 * has already solved in this book, the second sentence about scoring.
 * The placeholder lays the real words out invisible and clips its bars
 * over them, so it wraps where they will; here rather than in BookPage
 * because both waits draw it.
 */
export function cyclesProse(nudge: boolean): string {
  const invite = t(
    'Work the whole book in passes. Every puzzle once per cycle, scored by first attempts, and each pass should come out faster and cleaner.',
  );
  return nudge
    ? `${invite} ${t('You are solving already. A cycle gives each pass its own score.')}`
    : invite;
}

/* ---------------------------------------------------------- trainer */

/**
 * The trainer: a board over its two panes, on the shell every board page
 * shares (BOARD_HELD_SHELL, which SkeletonBoard carries).
 *
 * NOT a page header, which is what this outline drew for every route
 * under Puzzles. The trainer's own row is one word in `text-base
 * font-semibold` with a chevron before it on a phone, and the word comes
 * from the address exactly as PuzzlesView reads it.
 *
 * Two panes while an exercise is running, opening on the trainer's own
 * (hooks/use-analyse-in-place): the engine appears only once the answer
 * is in. The Puzzle panel at the column's foot is the page's own, as it
 * stands while a puzzle is found (PuzzlePanelOutline).
 */
function TrainerOutline({ params }: { params: string[] }) {
  return (
    <SkeletonBoard
      name={trainerTitle(params)}
      panes={[Info, ListOrdered]}
      stackedPanel={t('Puzzle')}
      foot={
        <div className="contents max-lg:hidden">
          <PuzzlePanelOutline params={params} />
        </div>
      }
    />
  );
}

/* ------------------------------------------------ the Puzzle panel */

/*
 * The trainer's Puzzle panel, in the pieces its wait is made of. The page
 * (PuzzlesView) draws them and the outline below draws them, which is
 * the only way the two can be one box: the outline folded this panel to
 * its 44px header, the page waits with all of it, and the header stood
 * 184px higher the moment the chunk landed (check:skeletons, 1280x800).
 */

/** The panel's scrolling body, and the footer band at its end. */
export const PUZZLE_BODY = 'flex min-h-0 grow flex-col gap-3 overflow-y-auto px-(--card-spacing)';
export const PUZZLE_FOOT = '-mx-(--card-spacing) mt-auto flex-wrap justify-end gap-2';

/**

 * What is actually being withheld while you solve.

 *

 * The panel used to say the difficulty and themes both stay hidden until

 * the end, which is true only when the trainer chose them. You can pick

 * either yourself — and being told that the thing you just selected is a

 * secret reads as the app having lost track of what you asked for. So

 * the sentence names only what you do not already know, and says nothing

 * at all when you know both.

 */

function hiddenNote(pickedDifficulty: boolean, pickedTheme: boolean): string {

  if (pickedDifficulty && pickedTheme) return 'Find the best move.';

  if (pickedDifficulty) return 'Find the best move. The themes stay hidden until you finish.';

  if (pickedTheme) return 'Find the best move. The difficulty stays hidden until you finish.';

  return 'Find the best move. The difficulty and themes stay hidden until you finish.';

}

/** The line the panel settles on, which the wait reserves the height of. */
export function puzzleNote(
  mode: 'fresh' | 'failed' | 'single',
  puzzleId: string | undefined,
  difficulty: DifficultyId,
  theme: string,
): string {
  if (mode === 'failed')
    return t('Reviewing, not counted. Each clean solve spaces the puzzle further out, and enough in a row retire it.');
  if (mode === 'single')
    return t('Replaying puzzle #{id}, not counted. A clean solve still retires it from the review list.', {
      id: puzzleId ?? '',
    });
  return t(hiddenNote(difficulty !== 'any' && difficulty !== 'adaptive', Boolean(theme)));
}

/**
 * The panel's two lines while a puzzle is found: the side-to-play line's
 * own box (text-2xl is a 32px line), so the prose under it and the
 * actions below do not step down when the heading lands, and then the
 * sentence that is about to land, laid out invisible, with "Finding a
 * puzzle…" over it. That one is a single line and the answer wraps to two
 * on a phone, so with nothing holding the second the difficulty row and
 * every action under it stepped down the moment the puzzle arrived: 23px
 * at 390, and on a desktop the panel rose 22px instead, its column
 * handing the room back. The Cycles panel reserves its prose the same way.
 */
export function PuzzleWait({ note }: { note: string }) {
  return (
    <>
      <div className="flex h-8 items-center">
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="relative">
        <p aria-hidden className="invisible text-sm leading-relaxed">
          {note}
        </p>
        <p className="text-muted-foreground absolute inset-0 text-sm leading-relaxed">{t('Finding a puzzle…')}</p>
      </div>
    </>
  );
}

/**

 * The active difficulty (and theme), visible while solving.

 *

 * It only existed inside the gear window before — nothing on the solving

 * screen said what was being trained. The chip states it and opens the

 * window that changes it.

 */

export function DifficultyChip({

  difficulty,

  theme,

  onOpen,

}: {

  difficulty: DifficultyId;

  theme: string;

  onOpen: () => void;

}) {

  const label = DIFFICULTIES.find((d) => d.id === difficulty)?.label ?? 'Any';

  return (

    <Button

      variant="secondary"

      size="sm"

      // A settings row, not a chip: it owns the panel's width, states the

      // current pick on the left and carries the "opens something" mark

      // on the right, like the theme row inside the window it opens.

      className="w-full min-w-0 justify-start"

      title={t('Puzzle settings')}

      onClick={onOpen}

    >

      <Settings2 className="glyph shrink-0" />

      <span className="truncate">

        {difficulty === 'any' ? t('Any difficulty') : t(label)}

        {theme && ` · ${themeLabel(theme)}`}

      </span>

      <ChevronRight className="text-muted-foreground ml-auto glyph shrink-0" />

    </Button>

  );

}

/** The header's way to the dashboard. */
export function DashboardButton() {
  return (
    <Button variant="ghost" size="icon-sm" title={t('Dashboard')} onClick={() => navigate('puzzles', 'dashboard')}>
      <BarChart3 className="glyph" />
    </Button>
  );
}

/**
 * Skip, Hint and Solution: the footer's row while a puzzle is unsolved.
 *
 * Skip sits at the far end, away from Solution, and is first in the DOM
 * so the reading order is the order on screen. The three used to be one
 * right-aligned run: Hint, then Solution, then Skip, touching, with the
 * two that END the puzzle side by side under the thumb, and neither asks
 * first, because neither should have to. Solution is the consequential
 * one (it records a failed attempt), Skip costs nothing but the puzzle,
 * and having them adjacent meant one mis-tap could not be told from the
 * other. `me-auto` is all the separation this needs; a confirm on either
 * would be a question asked hundreds of times to catch a slip.
 *
 * The icon rung on a thumb: these three end a puzzle, and Solution and
 * Skip are adjacent, irreversible and one tap each, so they get 44px
 * rather than the 36px floor.
 */
export function PuzzleActions({
  onSkip,
  solving,
  onHint,
  onSolution,
}: {
  /** Absent on a replay, which has no next puzzle to skip to. */
  onSkip?: () => void;
  solving: boolean;
  onHint?: () => void;
  onSolution?: () => void;
}) {
  return (
    <>
      {onSkip && (
        <Button variant="ghost" size="sm" className="me-auto pointer-coarse:h-11" onClick={onSkip}>
          <X className="glyph" data-icon="inline-start" />
          {t('Skip')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="pointer-coarse:h-11"
        disabled={!solving}
        onClick={onHint}
        title={t('First press marks the piece, second the move (not counted as a fail)')}
      >
        <Lightbulb className="glyph" data-icon="inline-start" />
        {t('Hint')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="pointer-coarse:h-11"
        disabled={!solving}
        onClick={onSolution}
        title={t('Counts as a failed attempt')}
      >
        <Eye className="glyph" data-icon="inline-start" />
        {t('Solution')}
      </Button>
    </>
  );
}

/**
 * The whole panel as the page stands it while a puzzle is found, for the
 * outline: the same header, body and footer, held inert. What is being
 * trained is this device's stored pick and the address, which is all the
 * page has at that moment too.
 */
function PuzzlePanelOutline({ params }: { params: string[] }) {
  const mode = params[0] === 'failed' ? 'failed' : params[0] === 'id' && params[1] ? 'single' : 'fresh';
  const theme = mode === 'fresh' && params[0] === 'theme' ? (params[1] ?? '') : '';
  const difficulty = storedDifficulty();
  return (
    <Inert>
      <Panel>
        <PanelHeader title={t('Puzzle')} actions={<DashboardButton />} />
        <div className={PUZZLE_BODY}>
          <div className="flex flex-col gap-0.5">
            <PuzzleWait note={puzzleNote(mode, params[1], difficulty, theme)} />
          </div>
          {mode === 'fresh' && <DifficultyChip difficulty={difficulty} theme={theme} onOpen={NOOP} />}
          <CardFooter className={PUZZLE_FOOT}>
            <PuzzleActions onSkip={mode !== 'single' ? NOOP : undefined} solving={false} />
          </CardFooter>
        </div>
      </Panel>
    </Inert>
  );
}

/** The trainer's own word, read off the address as PuzzlesView reads it. */
function trainerTitle(params: string[]): string {
  if (params[0] === 'id' && params[1]) return t('Replay #{id}', { id: params[1] });
  if (params[0] === 'failed') return t('Review');
  return t('Puzzles');
}

const NOOP = (): void => {};
