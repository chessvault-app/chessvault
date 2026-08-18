import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
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
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-surface-2 animate-pulse rounded-md', className)} />;
}

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
              'bg-surface border-line flex gap-3 rounded-xl border shadow-[var(--shadow-panel)]',
              grid ? 'items-start px-4 py-3' : 'items-center px-3 py-2',
            )}
          >
            {/* The first board, where the document has one. Its 64px is
                shorter than the text beside it, so a document without one
                makes no difference to the height. */}
            <Skeleton
              className={cn('shrink-0', grid ? 'size-16 rounded-md' : 'size-4 rounded')}
            />
            <div className="min-w-0 flex-1">
              {/* Title on a 20px line, then the quiet stat line on 16. */}
              <div className="flex h-5 items-center">
                <Skeleton className={cn('h-3', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-2 w-1/5" />
              </div>
              {grid && (
                // The excerpt: two clamped lines of text-xs on a 1.35rem
                // line, which is most of what makes a grid card tall.
                <div className="mt-1">
                  {[0, 1].map((line) => (
                    <div key={line} className="flex h-[1.35rem] items-center">
                      <Skeleton className={cn('h-2', line ? 'w-3/5' : 'w-full')} />
                    </div>
                  ))}
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
          className="bg-surface border-line flex w-full items-stretch gap-3 rounded-xl border p-3"
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
        'bg-surface border-line flex items-center gap-2.5 rounded-xl border px-3 py-2.5',
        className,
      )}
    >
      <Skeleton className="size-4 shrink-0 rounded" />
      <div className="min-w-0 flex-1">
        {/* A name at text-xs over a count, both 16px lines. */}
        <div className="flex h-4 items-center">
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

/** A written document: a heading, then paragraphs of ragged lines. */
export function SkeletonDocument({ className }: { className?: string }) {
  const paragraphs = [
    ['w-full', 'w-11/12', 'w-4/5'],
    ['w-full', 'w-full', 'w-3/5'],
    ['w-10/12', 'w-full', 'w-2/3'],
  ];
  return (
    <Loading className={cn('mx-auto flex w-full max-w-3xl flex-col gap-6 p-6', className)}>
      <Skeleton className="h-5 w-1/3" />
      {paragraphs.map((lines, p) => (
        <div key={p} className="flex flex-col gap-2.5">
          {lines.map((w, i) => (
            <Skeleton key={i} className={cn('h-2.5', w)} />
          ))}
        </div>
      ))}
    </Loading>
  );
}

/**
 * A board beside its panel — the shape every playing surface takes.
 *
 * The board is a real square, so the column widths settle before the
 * position arrives instead of snapping when it does.
 */
export function SkeletonBoard({ className }: { className?: string }) {
  return (
    <Loading className={cn('flex h-full flex-col gap-3 p-4', className)}>
      {/* The page's own header — a way back and a title — which the board
          skeleton used to drop, leaving a study loading with no way out. */}
      <div className="flex shrink-0 items-center gap-2">
        <Skeleton className="size-7 shrink-0 rounded-md" />
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <Skeleton className="aspect-square w-full max-w-[min(70vh,40rem)] shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* The side column's own title and its line of detail, which a
            stacked layout does not draw here — it puts the title at the
            top of the page instead, where this skeleton's header already
            stands in for it. Drawn on a phone as well, they were two bars
            standing for nothing. */}
        <div className="stacked:hidden">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-2.5 w-2/3" />
        </div>
        {/* What a phone has there instead: the pane switcher, one panel at
            a time behind a segmented track of icon tabs (ui/PaneTabs). */}
        <div className="bg-surface-2 border-line flex shrink-0 gap-0.5 rounded-lg border p-px lg:hidden">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 flex-1 rounded-md" />
          ))}
        </div>
        <div className="border-line mt-2 flex flex-col gap-2 rounded-lg border p-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className={cn('h-2.5', i % 2 ? 'w-3/5' : 'w-4/5')} />
          ))}
        </div>
      </div>
      </div>
    </Loading>
  );
}

/**
 * Labelled controls stacked in cards — the settings shape.
 *
 * Shaped against what Settings actually draws, which it was not: a card is
 * ui/SettingRow strips, each a bordered box holding a title at text-sm
 * over a blurb at text-xs, and this drew two bare bars in the open. The
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
      {/* The page title is text-lg, whose line box is 28px. */}
      <div className="flex h-7 items-center">
        <Skeleton className="h-4 w-28" />
      </div>
      {Array.from({ length: groups }, (_, g) => (
        <div key={g} className="border-line bg-surface rounded-xl border p-4">
          {/* The card's heading: an icon beside a title, on a 20px line. */}
          <div className="mb-3 flex h-5 items-center gap-2">
            <Skeleton className="size-4 shrink-0 rounded" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }, (_, i) => (
              <div
                key={i}
                className="border-line bg-surface-inset flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <div className="flex h-4 items-center">
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
        'border-line flex flex-wrap items-center gap-1.5 border-b px-3 py-2',
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
    <Loading className={cn('divide-line divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          {/* The real row stacks three <p>s with no gap between them: two
              players at text-sm, whose line box is 20px, and the opening
              and date at text-xs, whose box is 16px. This was a gap-1
              stack of bare bars — 40px of text against the row's 56, so a
              list of eight stood about 128px short and everything below it
              jumped when the games landed. The bars stay thin; each is
              centred in a box of its line's real height.

              Two players, each behind their side's dot. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {[0, 1].map((line) => (
              <div key={line} className="flex h-5 items-center gap-1.5">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <Skeleton className={cn('h-3', names[(i + line) % names.length])} />
              </div>
            ))}
            <div className="flex h-4 items-center">
              <Skeleton className="h-2 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-8 shrink-0" />
          <Skeleton className="size-7 shrink-0 rounded pointer-coarse:size-9" />
          <Skeleton className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </Loading>
  );
}
