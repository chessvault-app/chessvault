import { cn } from '@/lib/cn';

/**
 * Loading placeholder shaped like the content it stands in for — the
 * design-audit replacement for bare "Loading…" strings. Compose rows of
 * these to sketch the list being fetched.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-surface-2 animate-pulse rounded-md', className)} />;
}

/** A stack of list-row placeholders: title line + shorter detail line. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1 p-3', className)} aria-label="Loading" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5 py-1.5">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}
