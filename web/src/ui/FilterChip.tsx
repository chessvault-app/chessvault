import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/**
 * THE filter chip — one style for every filter row in the app.
 *
 * A string label is translated here rather than at each call site: filter
 * rows are built from `[id, label]` tuples in array literals, which is
 * exactly the shape a call-site t() keeps getting forgotten in. A
 * ReactNode label is passed through — the caller composed it and owns it.
 */
export function FilterChip({
  label,
  count,
  active,
  title,
  onClick,
}: {
  label: React.ReactNode;
  count?: number;
  active: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // On or off is a colour and nothing else without this: a filter
      // chip is a toggle, and a screen reader read every one of them the
      // same whether it was filtering or not.
      aria-pressed={active}
      title={title ? t(title) : undefined}
      onClick={onClick}
      className={cn(
        // inline-flex so an icon-bearing label and the count share one
        // centreline instead of fighting over baselines.
        // nowrap AND shrink-0: a chip is its label. Letting chips shrink so
        // one crowded row would fit made every chip inside a ChipRow — a
        // scroller, where shrinking is exactly wrong — collapse to "X…" on
        // the puzzles dashboard. A row that cannot fit its chips scrolls or
        // wraps; the chip itself never shortens.
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-sm font-medium transition-colors',
        // The same growth every small Button gets under a thumb.
        'pointer-coarse:min-h-9 pointer-coarse:px-3',
        active
          ? 'bg-primary-soft border-primary/40 text-primary'
          : 'border-line text-muted hover:border-line-strong',
      )}
    >
      {typeof label === 'string' ? t(label) : label}
      {count !== undefined && <span className="ml-1 opacity-60">{count}</span>}
    </button>
  );
}
