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
        // nowrap so a Korean label is never split between syllables, and
        // min-w-0 + a truncating label so a row of chips that cannot fit
        // shortens instead of being cut off at the screen edge — which is
        // what "Lichess 둘러보기" did on a phone once nowrap arrived.
        'inline-flex min-w-0 shrink items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-primary-soft border-primary/40 text-primary'
          : 'border-line text-muted hover:border-line-strong',
      )}
    >
      <span className="min-w-0 truncate">{typeof label === 'string' ? t(label) : label}</span>
      {count !== undefined && <span className="ml-1 opacity-60">{count}</span>}
    </button>
  );
}
