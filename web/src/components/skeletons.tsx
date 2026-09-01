import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { BOARD_MAX_W } from '@/board/boardSize';
import { publishBoardHeight } from '@/board/boardBlock';
import { BoardLane } from '@/engine/EvalBar';
import { BOARD_HELD_SHELL, BOARD_WIDE_COLUMN, BOARD_WIDE_SIDE } from '@/components/layout';
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

/**
 * A stack of one-line list rows: a mark, a name, a figure at the end.
 *
 * It used to be a title bar over a detail bar in a padded, gapped box —
 * 40px of placeholder for rows that are 33. Every list that draws this is
 * a single line: the dashboard's attempts and the hub's are `ListRow
 * dense` at `text-sm`, and the map's field table is a subgrid row of the
 * same height. Measured on the dashboard: five placeholders came to 240px
 * against the 165px of rows that replaced them, and the panel — which is
 * drawn from the first paint precisely because these rows ARE its height
 * — stood 75px too tall for the whole wait and then collapsed.
 *
 * So: the dense rung from the density token, one `text-sm` line box, and
 * the hairline between rows that two of the three callers draw. No
 * padding of its own — none of the three lists has any.
 */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <Loading className={cn('divide-border divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-3 py-(--row-py-dense)">
          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
          <div className="flex h-5 min-w-0 flex-1 items-center">
            <Skeleton className={cn('h-2.5', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
          </div>
          <Skeleton className="h-2.5 w-10 shrink-0" />
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
              'bg-card flex gap-3 rounded-xl ring-1 ring-border',
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
        // border, not ring: BookCard is `border p-3` on both shelves, and
        // a ring is a box-shadow that costs no layout — so the placeholder
        // measured 120px against the card’s 122.
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
            {/* The Progress track’s own h-1, like SkeletonTiles — not the
                h-1.5 this guessed. */}
            <Skeleton className="mt-auto h-1 w-full rounded-full" />
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
export function SkeletonTiles({
  tiles = 48,
  cycles = false,
  className,
}: {
  tiles?: number;
  /**
   * Hold the place of the Cycles panel above the grid.
   *
   * That panel is drawn for any book with puzzles in it — which is the
   * same book this grid is worth drawing for — and it is a whole Panel:
   * a header, the pass's own copy, and the card's floor. Measured on the
   * demo's book at 900px, the grid started at y=153 while this was
   * showing and at y=297 once the book landed, so every tile dropped
   * 144px the moment it did.
   */
  cycles?: boolean;
  className?: string;
}) {
  return (
    <Loading className={className}>
      {cycles && (
        // The Panel's own box: pt-0 and a --card-spacing floor (ui/card),
        // a min-h-11 header with no rule under it, then the paragraph the
        // panel opens with at text-sm/relaxed.
        <div className="bg-card mb-4 flex flex-col overflow-hidden rounded-xl ring-1 ring-border pb-(--card-spacing)">
          <div className="flex min-h-11 items-center justify-between gap-2 px-(--card-spacing) pointer-coarse:min-h-13">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-7 w-32 rounded-md pointer-coarse:h-9" />
          </div>
          <div className="flex flex-col gap-1 px-(--card-spacing)">
            {['w-full', 'w-11/12', 'w-2/3'].map((w) => (
              <div key={w} className="flex h-[1.4375rem] items-center">
                <Skeleton className={cn('h-2', w)} />
              </div>
            ))}
          </div>
        </div>
      )}
      {/* The Progress track's own h-1, not the h-1.5 it used to guess. */}
      <Skeleton className="mb-3 h-1 w-full rounded-full" />
      {/* Two Select triggers, not the five filter chips the page stopped
          drawing: Status and Fidelity, at the sm trigger's h-7 (h-9 under
          a coarse pointer), wide enough for their steady prefixed faces. */}
      <div className="mb-2 flex items-center gap-2">
        <Skeleton className="h-7 w-28 rounded-md pointer-coarse:h-9" />
        <Skeleton className="h-7 w-36 rounded-md pointer-coarse:h-9" />
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
 * 58px cards. The bars were both the wrong shape and the wrong height,
 * so the page rearranged completely as the themes landed.
 */
export function SkeletonThemeCard({ className }: { className?: string }) {
  return (
    <div
      // border, not ring — ThemeCard is `border px-3 py-2.5`, so this
      // stood 56px against its 58.
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
          {/* The group heading: an h2 at text-sm, whose line box is 20px
              — measured. It was drawn on a 16px line. */}
          <div className="mb-2 flex h-5 items-center">
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
      {/* pb-3, not the pb-1.5 the header wears while the formatting
          palette is showing: a note opens READ-ONLY, and that is the state
          this stands in for. Measured at 59px against the real 65. */}
      <div className="border-border -mx-4 flex shrink-0 flex-col gap-3 border-b px-4 pb-3 pt-4 md:-mx-6 md:px-6 md:pt-6">
        {/* pointer-coarse:h-9, like every control the row holds: the back
            chevron and the edit button are icon-sm and sm, which grow to
            36px under a thumb. Pinned at h-7 the row was a button short on
            every phone. */}
        <div className="flex h-7 shrink-0 items-center gap-2 pointer-coarse:h-9">
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
 * BOARD_HELD_SHELL, BOARD_MAX_W and BOARD_WIDE_SIDE are the three rules
 * the real pages compose, so sharing them is what keeps the two in the
 * same places. A copy would drift the first time one of them moved — and
 * it had: the shell was written out by hand here with
 * `stacked:overflow-hidden` where the constant says
 * `stacked:overflow-y-auto`, so a window short enough to make the page
 * scroll clipped the placeholder instead.
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
    // In the lane, like the row it stands in for — the board it is drawn
    // beside is indented by the eval bar's reservation, and a placeholder
    // that ignores it moves the whole stack sideways when the real view
    // arrives.
    <BoardLane>
      <div className="board-box flex h-6 items-center gap-2">
        <Skeleton className="size-2 shrink-0 rounded-full" />
        <Skeleton className="h-3 w-32" />
      </div>
    </BoardLane>
  );
  return (
    // BOARD_HELD_SHELL itself, not a copy of it. The copy differed in one
    // class — stacked:overflow-hidden where the constant says
    // stacked:overflow-y-auto — so a window short enough to make the real
    // page scroll clipped the placeholder instead. Sharing the string is
    // what the constant exists for; see components/layout.
    <Loading className={cn(BOARD_HELD_SHELL, className)}>
      <div className="flex shrink-0 items-center gap-2 wide:h-9 wide:hidden pointer-coarse:h-9">
        {titleRow}
      </div>

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
          <BoardLane>
            <Skeleton className="board-box aspect-square rounded-xl" />
          </BoardLane>
          {players && playerBar}
        </div>
      </div>

      {/* The side column, at the share of the row the real one takes. */}
      {/* stacked:gap-2 and the column’s floor, both of which the real
          columns carry (StudyView, BookTrainer): at gap-3 the placeholder
          spaced its children 4px wider apart than the page does. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-3 stacked:min-h-40 stacked:gap-2',
          BOARD_WIDE_SIDE,
        )}
      >
        <div className="flex shrink-0 items-center gap-2 wide:h-9 stacked:hidden">{titleRow}</div>
        {/* What a phone has instead of the panels: the pane switcher.
            TabsList's own box — h-8 and p-[3px] on the muted track, no
            border and no gap — rather than something that looks like it.
            Measured at 28px against the strip's 32. */}
        <div className="bg-muted flex h-8 shrink-0 rounded-lg p-[3px] lg:hidden">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-full flex-1 rounded-md" />
          ))}
        </div>
        {/* The panels below are the wide layout's: a phone shows one pane
            at a time behind the tabs above, and that one is the panel that
            fills the column.

            Both headers are min-h-11 — a PanelHeader's own floor, measured
            at 44px on every panel in the app — and not the h-10 they were
            drawn at. And the chapters block carries the real panel's own
            floor and ceiling rather than standing at one row: measured on
            a three-chapter study, 90px of placeholder against a 150px
            panel, so the explorer and the moves below it started 60px too
            high. */}
        {chapters && (
          <div className="bg-card flex max-h-48 min-h-[min(6rem,15%)] shrink-0 flex-col overflow-hidden rounded-xl ring-1 ring-border max-lg:hidden">
            <div className="border-border flex min-h-11 shrink-0 items-center border-b px-3 pointer-coarse:min-h-13">
              <Skeleton className="h-2.5 w-20" />
            </div>
            {/* px-1 and no gap, like the real list: its rows are --row-h
                tall and meet. With a gap and a padding of its own the
                block came out 166px against the panel's 150. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-(--row-h) shrink-0 items-center px-2">
                  <Skeleton className={cn('h-3', i === 0 ? 'w-2/3' : 'w-1/2')} />
                </div>
              ))}
            </div>
            {/* The grip that resizes it, which is part of the panel. */}
            <div className="bg-muted h-2.5 shrink-0" />
          </div>
        )}
        {/* A panel's own box, filling the column the way the real one
            does — it was a bordered strip that stopped wherever its rows
            ran out, in a column the page fills to the bottom. */}
        <div className="bg-card flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl ring-1 ring-border p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className={cn('h-2.5 shrink-0', i % 2 ? 'w-3/5' : 'w-4/5')} />
          ))}
        </div>
        {/* Folded to its header, which is where a board page opens it:
            `enabled` is session state and starts off (store/explorer), so a
            load never finds the 300px open panel. Same min-h-11 header. */}
        {explorer && (
          <div className="bg-card shrink-0 overflow-hidden rounded-xl ring-1 ring-border max-lg:hidden">
            <div className="flex min-h-11 items-center px-3 pointer-coarse:min-h-13">
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
 * components/setting-row strips, each a bordered box holding a title at text-base
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
      {/* The page title is text-xl, whose line box is 28px — and that is
          the whole header only where the header is only the title. Every
          page that draws this passes PageHeader a `back`, whose chevron is
          `md:hidden` and icon-sm: below md, under a coarse pointer, it is
          36px and the header takes its height from it. Measured on a
          420px phone: 28px of placeholder against a 36px header. */}
      <div className="flex h-7 items-center max-md:pointer-coarse:h-9">
        <Skeleton className="h-4 w-28" />
      </div>
      {Array.from({ length: groups }, (_, g) => (
        <div key={g} className="bg-card rounded-xl ring-1 ring-border p-4">
          {/* The card's heading: an icon beside a title, on a 24px line. */}
          <div className="mb-3 flex h-6 items-center gap-2">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }, (_, i) => (
              <div
                key={i}
                className="border-border bg-muted/50 flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex h-6 items-center">
                    <Skeleton className="h-3.5 w-32" />
                  </div>
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-2 w-44" />
                  </div>
                </div>
                {/* Where a Switch stands, at the size the registry draws
                    one: 18.4 x 32 (components/ui/switch), not the h-5 w-9
                    this claimed was "its own size". */}
                <Skeleton className="h-[18.4px] w-8 shrink-0 rounded-full" />
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
 *
 * The border side comes from the caller, like FilterRow's own: a baked-in
 * border-b under an archive strip that passes border-t drew both.
 */
export function SkeletonFilterRow({ className }: { className?: string }) {
  return (
    <Loading
      className={cn(
        'border-border flex flex-wrap items-center gap-1.5 px-3 py-2',
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
export function SkeletonGameRows({
  rows = 6,
  dense = false,
  className,
}: {
  rows?: number;
  /**
   * The table's one-line row, not the card's three.
   *
   * The same list draws either shape — GameListShell already carries this
   * as a prop, and already uses it to set the virtualisation's intrinsic
   * size — but its loading branch drew the card row whatever was coming.
   * Measured on the games page in table mode: six placeholders at 85px
   * against six rows at 34, so everything below the list dropped 305px
   * the moment the games arrived. The row is GameTable's own geometry
   * (`min-h-[2.125rem] py-1`, its GRID's px-3), which is where the 34
   * comes from.
   */
  dense?: boolean;
  className?: string;
}) {
  const names = ['w-2/5', 'w-1/2', 'w-1/3', 'w-5/12', 'w-2/5', 'w-1/2'];
  if (dense)
    return (
      <Loading className={cn('divide-border divide-y', className)}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-[2.125rem] items-center gap-2 px-3 py-1">
            <Skeleton className={cn('h-2.5', names[i % names.length])} />
            <Skeleton className="ml-auto h-2.5 w-10 shrink-0" />
            <Skeleton className="h-2.5 w-8 shrink-0" />
          </div>
        ))}
      </Loading>
    );
  return (
    <Loading className={cn('divide-border divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-(--row-py)">
          {/* The real row stacks three <p>s with no gap between them: two
              players at text-base, whose line box is 24px, and the opening
              and date at text-sm, whose box is 20px. This was a gap-1
              stack of bare bars — 40px of text against the row's 68, so a
              list of eight stood about 200px short and everything below it
              jumped when the games landed. The bars stay thin; each is
              centred in a box of its line's real height.

              The padding is the density token, not the py-2 it resolves to
              at the comfortable rung: this row is every game list in the
              app, which is the list a density knob is for, and a literal
              stood 6px per row taller than the rows on a compact vault.

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
