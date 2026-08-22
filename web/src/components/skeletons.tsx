import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { BOARD_MAX_W } from '@/board/boardSize';
import { publishBoardHeight } from '@/board/boardBlock';
import { BOARD_WIDE_COLUMN, BOARD_WIDE_SHELL, BOARD_WIDE_SIDE } from '@/components/layout';
import { t } from '@/lib/i18n';

/**
 * Loading placeholders shaped like the content they stand in for — the
 * design-audit replacement for bare "Loading…" strings.
 *
 * Two rules make these help rather than hurt:
 *
 *  - they are the SHAPE of what is coming, so the page does not jump when
 *    the real thing lands. A generic stack of grey bars where a grid of
 *    cards will appear is its own kind of flicker.
 *  - they are governed by `useSlowLoad`, because a skeleton that appears
 *    and vanishes inside 200 ms reads as a glitch. Most loads here are
 *    fast enough that the right thing to show is nothing at all.
 */
import { Skeleton } from '@/components/ui/skeleton';
export { Skeleton };

/**
 * Whether a wait has gone on long enough to be worth admitting to.
 *
 * A skeleton that flashes is worse than no skeleton: the eye reads a
 * flicker as something going wrong, and it also makes a fast load FEEL
 * slower than the same load with nothing in it. So nothing is shown for
 * the first `delay` — most loads finish inside it and stay invisible — and
 * once something is shown it stays for `minVisible`, so it cannot appear
 * and vanish in the same breath.
 */
export function useSlowLoad(active: boolean, delay = 180, minVisible = 400): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (active) {
      if (shown) return;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, delay);
      return () => clearTimeout(timer);
    }
    if (!shown) return;
    const remaining = minVisible - (Date.now() - shownAt.current);
    if (remaining <= 0) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(false), remaining);
    return () => clearTimeout(timer);
  }, [active, shown, delay, minVisible]);
  return shown;
}

/** Wrapper that announces itself to screen readers exactly once. */
function Loading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} role="status" aria-label={t('Loading')} aria-live="polite">
      {children}
    </div>
  );
}

/** A stack of list-row placeholders: title line + shorter detail line. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <Loading className={cn('flex flex-col gap-1 p-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5 py-1.5">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      ))}
    </Loading>
  );
}

/** Ragged widths, so a list of placeholders does not read as a barcode. */
const NAME_WIDTHS = ['w-2/5', 'w-3/5', 'w-1/2', 'w-2/3', 'w-5/12', 'w-7/12'];

/**
 * Separate bordered cards under a collection heading — what Studies and
 * Notes actually draw. They are not a divided list, and a skeleton shaped
 * like one made the page jump when the real cards arrived.
 */
export function SkeletonCards({
  cards = 5,
  layout = 'list',
  gridClassName = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3',
  className,
}: {
  cards?: number;
  /**
   * The shelf's own arrangement, which it knows before the documents
   * arrive — it is a stored preference, not something the answer decides.
   *
   * It has to be here because the two are not the same card. A grid card
   * carries the document's first board at 64px and two lines of its
   * words; a list row carries neither. Drawn as a list either way, the
   * placeholder stood 52px against the grid card's 109 and in one column
   * against two or three, so a grid shelf rearranged completely as it
   * landed.
   */
  layout?: 'grid' | 'list';
  /** The grid's columns, which the studies and notes shelves differ on. */
  gridClassName?: string;
  className?: string;
}) {
  const grid = layout === 'grid';
  return (
    <Loading className={className}>
      {/* No heading bar. Documents ARE grouped under a collection name,
          but only a named one draws a header — the root group, which is
          where a shelf's documents sit unless somebody has filed them,
          renders its cards with nothing above them. So the bar stood for
          something that usually is not there, and the cards jumped up its
          height as the shelf landed. */}
      <div className={grid ? gridClassName : 'flex flex-col gap-1.5'}>
        {Array.from({ length: cards }, (_, i) => (
          <div
            key={i}
            className={cn(
              'bg-card border-border flex gap-3 rounded-xl border shadow-panel',
              grid ? 'items-start px-4 py-3' : 'items-center px-3 py-2',
            )}
          >
            {/* The first board, where the document has one. Its 64px is
                shorter than the text beside it, so a document without one
                makes no difference to the height. */}
            <Skeleton
              className={cn('shrink-0', grid ? 'size-16 rounded-md' : 'size-4 rounded-sm')}
            />
            <div className="min-w-0 flex-1">
              {/* Title on a 24px line, then the quiet stat line on 16. */}
              <div className="flex h-6 items-center">
                <Skeleton className={cn('h-3.5', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-2 w-1/5" />
              </div>
              {grid && (
                // ONE line of excerpt, though the card clamps at two.
                // Measured on a real shelf, a grid card is 88-90px: the
                // 64px board governs where there is one, and where there
                // is not the text does — 24 + 16 + 4 + 22. Two lines put
                // the text at 83 and the card at 109, which is why the
                // placeholder stood a fifth taller than what replaced it.
                <div className="mt-1 flex h-[1.35rem] items-center">
                  <Skeleton className="h-2 w-full" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** The puzzle shelf: a cover, a title, a count and a progress bar. */
export function SkeletonBookCards({ cards = 4, className }: { cards?: number; className?: string }) {
  return (
    <Loading className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', className)}>
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          className="bg-card border-border flex w-full items-stretch gap-3 rounded-xl border p-3"
        >
          {/* Exactly the cover's own box (h-24 w-[4.5rem]), so the card is
              the size it will be rather than the size it looks like. */}
          <Skeleton className="h-24 w-[4.5rem] shrink-0 rounded-md" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-2.5 w-1/3" />
            <Skeleton className="mt-auto h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </Loading>
  );
}

/**
 * A book's puzzle page: the progress bar and filter chips it wears above
 * the grid, then the grid itself — same columns, gap and tile shape as the
 * real one, so nothing moves when the puzzles arrive.
 */
export function SkeletonTiles({ tiles = 48, className }: { tiles?: number; className?: string }) {
  const chips = ['w-12', 'w-14', 'w-16', 'w-16', 'w-24'];
  return (
    <Loading className={className}>
      <Skeleton className="mb-3 h-1.5 w-full rounded-full" />
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chips.map((w, i) => (
          <Skeleton key={i} className={cn('h-6 rounded-full', w)} />
        ))}
      </div>
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
        {Array.from({ length: tiles }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    </Loading>
  );
}

/**
 * Themes: titled groups, each a responsive grid of small labelled cards.
 *
 * Not SkeletonRows, which is what this page used to draw — a stack of
 * full-width bars for a page whose content is a 2-to-4 column grid of
 * 54px cards. The bars were both the wrong shape and the wrong height,
 * so the page rearranged completely as the themes landed.
 */
export function SkeletonThemeCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'bg-card border-border flex items-center gap-2.5 rounded-xl border px-3 py-2.5',
        className,
      )}
    >
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <div className="min-w-0 flex-1">
        {/* A name at text-sm on a 20px line, over a count on 16. */}
        <div className="flex h-5 items-center">
          <Skeleton className="h-2.5 w-2/3" />
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className="h-2 w-8" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonThemeGroups({
  groups = 3,
  cards = 6,
  className,
}: {
  groups?: number;
  cards?: number;
  className?: string;
}) {
  return (
    <Loading className={className}>
      {Array.from({ length: groups }, (_, g) => (
        <section key={g} className="mb-4">
          {/* The group heading, on its own uppercase 16px line. */}
          <div className="mb-2 flex h-4 items-center">
            <Skeleton className="h-2.5 w-28" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: cards }, (_, i) => (
              <SkeletonThemeCard key={i} />
            ))}
          </div>
        </section>
      ))}
    </Loading>
  );
}

/**
 * A written document: the note's sticky header, then paragraphs of ragged
 * lines where its prose goes.
 *
 * The column and the header carry the note page's own classes rather than
 * an approximation of them. It used to be p-6 and gap-6 with a single bar
 * for a title, against a page whose header is a 59px block over a rule
 * with the document under it — so the words landed roughly a header lower
 * than where they had been drawn.
 */
export function SkeletonDocument({ className }: { className?: string }) {
  /**
   * The note editor's own vertical rhythm, expressed in em against the
   * editor's font size rather than in the px it used to resolve to. The
   * numbers are .note-editor's own: blocks 0.6em apart, body on a 1.7
   * line, h1 at 1.5em and h2 at 1.25em each with a 1em margin of their
   * own. In px they had to be recomputed by hand every time the type
   * scale moved, and the move that just happened proved they would not be.
   *
   * The bars used to be evenly spaced from the very top of the box, so the
   * prose arrived about a line below where the placeholder had drawn it —
   * the first block's own margin is what the box does not have.
   */
  const para = (lines: string[], key: string) => (
    <div key={key} className="mt-[0.6em]">
      {lines.map((w, i) => (
        <div key={i} className="flex h-[1.7em] items-center">
          <Skeleton className={cn('h-3', w)} />
        </div>
      ))}
    </div>
  );
  return (
    <Loading
      className={cn(
        'mx-auto flex h-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1rem+var(--safe-b))] md:px-6 md:pb-6',
        className,
      )}
    >
      {/* The header the note keeps at the top of its column: a 28px row of
          back, name, edit and save, over the rule under it. */}
      <div className="border-border -mx-4 flex shrink-0 flex-col gap-3 border-b px-4 pb-1.5 pt-4 md:-mx-6 md:px-6 md:pt-6">
        <div className="flex h-7 shrink-0 items-center gap-2">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <Skeleton className="h-3.5 min-w-0 flex-1" />
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <Skeleton className="h-6 w-16 shrink-0 rounded-md" />
        </div>
      </div>
      <div className="text-base min-h-0 flex-1">
        <div className="mt-[1.5em] flex h-[2.55em] items-center">
          <Skeleton className="h-5 w-2/5" />
        </div>
        {para(['w-full', 'w-11/12', 'w-4/5'], 'a')}
        <div className="mt-[1.25em] flex h-[2.125em] items-center">
          <Skeleton className="h-4 w-1/3" />
        </div>
        {para(['w-full', 'w-full', 'w-3/5'], 'b')}
        {para(['w-10/12', 'w-full', 'w-2/3'], 'c')}
      </div>
    </Loading>
  );
}

/**
 * A board beside its panel — the shape every playing surface takes.
 *
 * Built from the board pages' OWN layout constants rather than from
 * something that looks like them. It carried p-4 against their p-3, no
 * wide-screen shell at all, and a board capped at min(70vh,40rem) — which
 * on a 1920 desktop drew a 540px board where the page draws 736, in a
 * column that is not where the page puts one. Every element on it moved
 * when the document arrived.
 *
 * BOARD_WIDE_SHELL, BOARD_MAX_W and BOARD_WIDE_SIDE are the three rules
 * the real pages compose, so sharing them is what keeps the two in the
 * same places. A copy would drift the first time one of them moved.
 */
export function SkeletonBoard({
  players = false,
  chapters = false,
  explorer = false,
  className,
}: {
  /**
   * Reserve the two player bars a GAME wears, above and below its board.
   *
   * PlayerBar draws nothing until the headers are loaded, so a game's board
   * used to sit where a study's does and then take on 24px above it, 24
   * below and the gaps between. A study has no players and passes nothing.
   */
  players?: boolean;
  /** A study's chapter list, which a game and a trainer do not have. */
  chapters?: boolean;
  /** The explorer, docked at the foot of the column on a wide screen. */
  explorer?: boolean;
  className?: string;
}) {
  const titleRow = (
    // A way back, the name, the edit toggle and the save state. Drawn at
    // the top of the page on a phone and in the side column on a wide
    // screen, which is why it is written once and placed twice.
    <>
      <Skeleton className="size-7 shrink-0 rounded-md" />
      <Skeleton className="h-3.5 min-w-0 flex-1" />
      <Skeleton className="size-7 shrink-0 rounded-md" />
      <Skeleton className="h-6 w-16 shrink-0 rounded-md" />
    </>
  );
  const playerBar = (
    <div className="flex h-6 w-full items-center gap-2 px-0.5">
      <Skeleton className="size-2 shrink-0 rounded-full" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
  return (
    <Loading
      className={cn(
        'flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-hidden',
        BOARD_WIDE_SHELL,
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 wide:h-9 wide:hidden">{titleRow}</div>

      {/* The board's column, and inside it the one width budget every view
          that shows a board shares. */}
      <div className={BOARD_WIDE_COLUMN}>
        <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          {/* 40px on a wide screen whatever it holds, so the board top
              stays put; on a phone only there when there is a game. */}
          <div
            className={cn(
              'w-full items-end wide:flex wide:h-10',
              players ? 'flex' : 'hidden wide:flex',
            )}
          >
            {players && playerBar}
          </div>
          <Skeleton className="aspect-square w-full rounded-xl" />
          {players && playerBar}
        </div>
      </div>

      {/* The side column, at the share of the row the real one takes. */}
      <div className={cn('flex min-h-0 flex-1 flex-col gap-3', BOARD_WIDE_SIDE)}>
        <div className="flex shrink-0 items-center gap-2 wide:h-9 stacked:hidden">{titleRow}</div>
        {/* What a phone has instead of the panels: the pane switcher. */}
        <div className="bg-muted border-border flex shrink-0 gap-0.5 rounded-lg border p-px lg:hidden">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 flex-1 rounded-md" />
          ))}
        </div>
        {/* The panels below are the wide layout's: a phone shows one pane
            at a time behind the tabs above, and that one is the panel that
            fills the column. Measured on a study at 1920 — chapters 92px
            (a 40px header, its rows, and the 10px grip that resizes it),
            explorer 42px collapsed to its header — because the column
            without them started its main panel 104px too high and ended
            it 42px too low. */}
        {chapters && (
          <div className="bg-card border-border flex shrink-0 flex-col overflow-hidden rounded-xl border shadow-panel max-lg:hidden">
            <div className="border-border flex h-10 shrink-0 items-center border-b px-3">
              <Skeleton className="h-2.5 w-20" />
            </div>
            <div className="flex h-10 items-center px-2">
              <Skeleton className="h-3 w-2/3" />
            </div>
            <div className="bg-muted h-2.5 shrink-0" />
          </div>
        )}
        {/* A panel's own box, filling the column the way the real one
            does — it was a bordered strip that stopped wherever its rows
            ran out, in a column the page fills to the bottom. */}
        <div className="bg-card border-border flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl border p-3 shadow-panel">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className={cn('h-2.5 shrink-0', i % 2 ? 'w-3/5' : 'w-4/5')} />
          ))}
        </div>
        {explorer && (
          <div className="bg-card border-border shrink-0 overflow-hidden rounded-xl border shadow-panel max-lg:hidden">
            <div className="flex h-10 items-center px-3">
              <Skeleton className="h-2.5 w-16" />
            </div>
          </div>
        )}
      </div>
    </Loading>
  );
}

/**
 * Labelled controls stacked in cards — the settings shape.
 *
 * Shaped against what Settings actually draws, which it was not: a card is
 * ui/SettingRow strips, each a bordered box holding a title at text-base
 * over a blurb at text-sm, and this drew two bare bars in the open. The
 * card came out around 118px against the real 194, so the page grew by
 * about half a card each as the settings landed.
 *
 * It owns no width or padding of its own any more — the caller puts it in
 * the same PageShell the settled page uses, so the column and the gutters
 * cannot disagree, and the leading box stands in for the page header
 * rather than for nothing.
 */
export function SkeletonForm({ groups = 3, className }: { groups?: number; className?: string }) {
  return (
    <Loading className={cn('flex flex-col gap-4', className)}>
      {/* The page title is text-xl, whose line box is 28px. */}
      <div className="flex h-7 items-center">
        <Skeleton className="h-4 w-28" />
      </div>
      {Array.from({ length: groups }, (_, g) => (
        <div key={g} className="border-border bg-card rounded-xl border p-4">
          {/* The card's heading: an icon beside a title, on a 24px line. */}
          <div className="mb-3 flex h-6 items-center gap-2">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }, (_, i) => (
              <div
                key={i}
                className="border-border bg-surface-inset flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex h-6 items-center">
                    <Skeleton className="h-3.5 w-32" />
                  </div>
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-2 w-44" />
                  </div>
                </div>
                {/* Where a Switch stands: h-5 w-9, its own size. */}
                <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </Loading>
  );
}

/**
 * The filter strip a list of games wears above its rows: three narrow
 * selects and a button, on the same 28px trigger height (36 under a
 * coarse pointer) inside the same px-3 py-2 as GameFilters' FilterRow.
 *
 * It exists because that row is drawn only once there are games to
 * filter, so a list that is still loading has nothing there and every row
 * below moves down by its 45px the moment the games arrive.
 */
export function SkeletonFilterRow({ className }: { className?: string }) {
  return (
    <Loading
      className={cn(
        'border-border flex flex-wrap items-center gap-1.5 border-b px-3 py-2',
        className,
      )}
    >
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-7 min-w-0 flex-1 rounded-md pointer-coarse:h-9" />
      ))}
      <Skeleton className="h-7 w-14 shrink-0 rounded-md pointer-coarse:h-9" />
    </Loading>
  );
}

/**
 * A game row: two players over a line of date and opening, a result, the
 * peek eye and the collect button.
 *
 * Its own shape rather than the generic list row, which starts with an
 * icon a game row does not have and is a line shorter — so the list
 * resized under you when the games landed.
 */
export function SkeletonGameRows({ rows = 6, className }: { rows?: number; className?: string }) {
  const names = ['w-2/5', 'w-1/2', 'w-1/3', 'w-5/12', 'w-2/5', 'w-1/2'];
  return (
    <Loading className={cn('divide-border divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          {/* The real row stacks three <p>s with no gap between them: two
              players at text-base, whose line box is 20px, and the opening
              and date at text-sm, whose box is 16px. This was a gap-1
              stack of bare bars — 40px of text against the row's 56, so a
              list of eight stood about 128px short and everything below it
              jumped when the games landed. The bars stay thin; each is
              centred in a box of its line's real height.

              Two players, each behind their side's dot. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {[0, 1].map((line) => (
              <div key={line} className="flex h-6 items-center gap-1.5">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <Skeleton className={cn('h-3.5', names[(i + line) % names.length])} />
              </div>
            ))}
            <div className="flex h-5 items-center">
              <Skeleton className="h-2 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-8 shrink-0" />
          <Skeleton className="size-7 shrink-0 rounded-sm pointer-coarse:size-9" />
          <Skeleton className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </Loading>
  );
}
