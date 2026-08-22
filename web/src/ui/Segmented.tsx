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
  even = false,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  segments: Segment<T>[];
  ariaLabel: string;
  /** `sm` is the icon-only size used in a toolbar. */
  size?: 'sm' | 'md';
  /**
   * Halves (or thirds) of exactly equal width, whatever the labels say.
   *
   * The default sizes each segment by its own label first (see the
   * flex-auto note below), which is right for a control read on its
   * own. It is wrong for a COLUMN of them: stacked as fields in a form,
   * two tracks whose lit pills break at 48% and at 50% read as two
   * controls of slightly different make, and the eye finds the 7px it
   * cannot name. Where the segments are stacked, this lines them up.
   */
  even?: boolean;
  className?: string;
}) {
  // Concentric radii, or the lit segment reads as clipped: a child corner
  // rounded MORE than the space left inside the parent's own curve pushes
  // through it, and the difference shows first at the top-left. The rule
  // is child = parent − border − padding, so the two sizes carry matched
  // sets rather than one radius reused at both.
  // Derived from the radius token rather than a matching literal, so the
  // pair stays concentric if the scale ever moves.
  // The coarse-pointer height is set on the BOX and the segments fill it,
  // rather than growing the segments and letting the padding and border
  // add themselves on top. That way this lands on exactly the 36px a
  // Button's `icon-sm` and a Select take on touch — a toolbar is a row,
  // and 34 or 38 would be as visibly wrong as the 30 it used to be.
  const box =
    size === 'sm'
      ? 'rounded-lg border p-0.5 pointer-coarse:h-9'
      : 'rounded-xl border p-1 pointer-coarse:h-9';
  const seg =
    size === 'sm'
      ? 'h-6 pointer-coarse:h-full rounded-[calc(var(--radius-lg)-3px)] px-1.5 text-sm'
      : 'h-7 pointer-coarse:h-full rounded-[calc(var(--radius-xl)-5px)] px-2.5 text-sm';

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
              // whitespace-nowrap: a segment is one or two words by
              // definition, and `min-w-0` lets a crowded row squeeze it
              // narrower than they are. Beside a filter field in Korean
              // that broke "스터디" across two lines inside a 28px-tall
              // pill — a control taller than its track. It shrinks the
              // row's flexible neighbour instead now.
              // flex-auto, not flex-1: both grow into a track that has been
              // stretched (the archive's is w-full), but flex-1 starts every
              // segment from a basis of ZERO, so they end up the same width
              // whatever they say — and a pair like "Databases" and "PGN
              // collections" then sets one word in a box built for two, with
              // the short one adrift in its own padding. From a basis of
              // auto each segment is as wide as its label first and shares
              // what is left after.
              'flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap',
              // basis-0 is the half of flex-1 that does the work here:
              // it takes each segment's own width out of the sum, so
              // what is shared is the whole track.
              even ? 'flex-1 basis-0' : 'flex-auto',
              'font-medium transition-colors duration-100',
              seg,
              on
                ? // Raised, and in the segment's own colour where it has
                  // one. Two grey pills side by side made the live site
                  // and the dead one look interchangeable.
                  'bg-surface-3 shadow-panel ' + (accent ? 'font-semibold' : 'text-fg')
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
