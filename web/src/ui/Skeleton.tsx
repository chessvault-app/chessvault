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
 * Rows inside a divided list — the shape the games lists use: an icon, a
 * name over a meta line, and something on the right.
 */
export function SkeletonListRows({
  rows = 6,
  action = false,
  className,
}: {
  rows?: number;
  /** Reserve the trailing button the real rows carry. */
  action?: boolean;
  className?: string;
}) {
  return (
    <Loading className={cn('divide-line divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-4 shrink-0 rounded" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-3', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
            <Skeleton className="h-2 w-1/4" />
          </div>
          {action && <Skeleton className="h-6 w-14 shrink-0" />}
        </div>
      ))}
    </Loading>
  );
}

/**
 * Separate bordered cards under a collection heading — what Studies and
 * Notes actually draw. They are not a divided list, and a skeleton shaped
 * like one made the page jump when the real cards arrived.
 */
export function SkeletonCards({
  cards = 5,
  heading = true,
  className,
}: {
  cards?: number;
  /** Documents are grouped under a collection name; keep its place. */
  heading?: boolean;
  className?: string;
}) {
  return (
    <Loading className={cn('flex flex-col gap-4', className)}>
      {heading && <Skeleton className="ml-1 h-2.5 w-24" />}
      <div className="flex flex-col gap-2">
        {Array.from({ length: cards }, (_, i) => (
          <div
            key={i}
            className="bg-surface border-line flex items-center gap-3 rounded-xl border px-4 py-3 shadow-[var(--shadow-panel)]"
          >
            <Skeleton className="size-4 shrink-0 rounded" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className={cn('h-3', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
              <Skeleton className="h-2 w-1/5" />
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
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-2.5 w-2/3" />
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

/** Labelled controls stacked in cards — the settings shape. */
export function SkeletonForm({ groups = 3, className }: { groups?: number; className?: string }) {
  return (
    <Loading className={cn('mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-6', className)}>
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: groups }, (_, g) => (
        <div key={g} className="border-line bg-surface flex flex-col gap-3 rounded-xl border p-4">
          <Skeleton className="h-3 w-1/4" />
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-2.5 w-1/3" />
              <Skeleton className="h-6 w-20 shrink-0" />
            </div>
          ))}
        </div>
      ))}
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
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* Two players, each behind their side's dot. */}
            {[0, 1].map((line) => (
              <div key={line} className="flex items-center gap-1.5">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <Skeleton className={cn('h-3', names[(i + line) % names.length])} />
              </div>
            ))}
            <Skeleton className="h-2 w-1/3" />
          </div>
          <Skeleton className="h-3 w-8 shrink-0" />
          <Skeleton className="size-7 shrink-0 rounded pointer-coarse:size-9" />
          <Skeleton className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </Loading>
  );
}
