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
      title={title ? t(title) : undefined}
      onClick={onClick}
      className={cn(
        // inline-flex so an icon-bearing label and the count share one
        // centreline instead of fighting over baselines.
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
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
