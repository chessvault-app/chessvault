import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

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
    <div className={className} role="status" aria-label="Loading" aria-live="polite">
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

/**
 * Rows of the shape the document lists actually use: an icon, a name over
 * a meta line, and something on the right. Widths vary a little so it
 * reads as a list of different things rather than a barcode.
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
  const widths = ['w-2/5', 'w-3/5', 'w-1/2', 'w-2/3', 'w-5/12', 'w-7/12'];
  return (
    <Loading className={cn('divide-line divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-4 shrink-0 rounded" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-3', widths[i % widths.length])} />
            <Skeleton className="h-2 w-1/4" />
          </div>
          {action && <Skeleton className="h-6 w-14 shrink-0" />}
        </div>
      ))}
    </Loading>
  );
}

/** The puzzle shelf: a cover, a title, a count and a progress bar. */
export function SkeletonBookCards({ cards = 4, className }: { cards?: number; className?: string }) {
  return (
    <Loading className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="bg-surface border-line flex gap-3 rounded-xl border p-3">
          {/* Same aspect as a real cover, so nothing reflows when it lands. */}
          <Skeleton className="h-[6.5rem] w-[4.6rem] shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-2.5 w-1/3" />
            <Skeleton className="mt-auto h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </Loading>
  );
}

/** A book's puzzle grid: square numbered tiles. */
export function SkeletonTiles({ tiles = 36, className }: { tiles?: number; className?: string }) {
  return (
    <Loading
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5',
        className,
      )}
    >
      {Array.from({ length: tiles }, (_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </Loading>
  );
}
