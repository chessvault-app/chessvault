import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

export interface Segment<T extends string> {
  value: T;
  /** Text, or an icon and text — whatever the segment reads as. */
  label: ReactNode;
  /** For an icon-only segment, which has no visible name. */
  title?: string;
  /**
   * The colour this segment answers to when it is the live one — a site's
   * own green, say. Where a segment stands for something that HAS a
   * colour, the raised surface alone made the two look interchangeable.
   */
  accent?: string;
}

/**
 * One choice out of two or three, all of them visible.
 *
 * A pair of chips reads as two independent toggles — you cannot tell by
 * looking whether turning one on turns the other off. A segmented control
 * says it in the shape: one track, one lit segment, and the unlit ones
 * plainly part of the same thing.
 *
 * Used for the archive's provider tabs and the shelves' grid/list switch,
 * which were two different hand-rolled versions of this.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  segments,
  ariaLabel,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  segments: Segment<T>[];
  ariaLabel: string;
  /** `sm` is the icon-only size used in a toolbar. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  // Concentric radii, or the lit segment reads as clipped: a child corner
  // rounded MORE than the space left inside the parent's own curve pushes
  // through it, and the difference shows first at the top-left. The rule
  // is child = parent − border − padding, so the two sizes carry matched
  // sets rather than one radius reused at both.
  // Derived from the radius token rather than a matching literal, so the
  // pair stays concentric if the scale ever moves.
  const box = size === 'sm' ? 'rounded-lg border p-0.5' : 'rounded-xl border p-1';
  const seg =
    size === 'sm'
      ? 'h-6 rounded-[calc(var(--radius-lg)-3px)] px-1.5 text-xs'
      : 'h-7 rounded-[calc(var(--radius-xl)-5px)] px-2.5 text-xs';

  return (
    <div
      role="tablist"
      aria-label={t(ariaLabel)}
      className={cn('border-line bg-surface-inset flex shrink-0 items-center', box, className)}
    >
      {segments.map(({ value: id, label, title, accent }) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            title={title ? t(title) : undefined}
            onClick={() => onChange(id)}
            style={on && accent ? { color: accent } : undefined}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-1.5',
              'font-medium transition-colors duration-100',
              seg,
              on
                ? // Raised, and in the segment's own colour where it has
                  // one. Two grey pills side by side made the live site
                  // and the dead one look interchangeable.
                  'bg-surface-3 shadow-[var(--shadow-panel)] ' + (accent ? 'font-semibold' : 'text-fg')
                : // Dimmer than it was, so the gap between live and dead
                  // is a step rather than a shade.
                  'text-subtle hover:text-fg',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
