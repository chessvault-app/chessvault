import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

export interface Segment<T extends string> {
  value: T;
  /** Text, or an icon and text — whatever the segment reads as. */
  label: ReactNode;
  /** For an icon-only segment, which has no visible name. */
  title?: string;
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
  return (
    <div
      role="tablist"
      aria-label={t(ariaLabel)}
      className={cn(
        'border-line bg-surface-inset flex shrink-0 items-center rounded-lg border p-0.5',
        className,
      )}
    >
      {segments.map(({ value: id, label, title }) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            title={title ? t(title) : undefined}
            onClick={() => onChange(id)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md',
              'font-medium transition-colors duration-100',
              size === 'sm' ? 'h-6 px-1.5 text-xs' : 'h-7 px-2.5 text-xs',
              on
                ? // The lit segment is a raised surface, not a coloured
                  // block: the colour in this row belongs to the site marks.
                  'bg-surface-3 text-fg shadow-[var(--shadow-panel)]'
                : 'text-subtle hover:text-fg',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
