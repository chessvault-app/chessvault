import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Loading } from './primitives';

/**
 * Themes: titled groups, each a responsive grid of small labelled cards.
 *
 * Not SkeletonRows, which is what this page used to draw — a stack of
 * full-width bars for a page whose content is a 2-to-4 column grid of
 * 58px cards. The bars were both the wrong shape and the wrong height,
 * so the page rearranged completely as the themes landed.
 */
export function SkeletonThemeCard({
  className,
  label,
}: {
  className?: string;
  /** The word this card will carry, where the card sizes itself to it.
      In the grid the column sets the width and this is not needed; the
      review chip is `w-auto` and shrink-wrapped to 84px against the
      186px its own label gives the card that replaces it. */
  label?: string;
}) {
  return (
    <div
      // border, not ring — ThemeCard is `border px-3 py-2.5`, so this
      // stood 56px against its 58.
      className={cn(
        'bg-card border-card-ring flex items-center gap-2.5 rounded-xl border px-3 py-2.5',
        className,
      )}
    >
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <div className="min-w-0 flex-1">
        {/* ThemeCard's own two lines: the name on `type-row`, the count
            under it on `type-row-sub`. Both were pinned at the desktop
            number, so the card stood 8px short of the one it stands in
            for on every phone, and a grid of seventy themes about 280px. */}
        <div className="type-row-box flex items-center">
          {label ? (
            // The chip's width comes from this word, so it is laid out in
            // the type the card will set it in: without `type-row
            // font-medium` it shrink-wrapped narrower than the card that
            // replaces it, which is the one thing the label is for.
            <span className="relative type-row font-medium">
              <span className="invisible whitespace-nowrap">{label}</span>
              <Skeleton className="absolute inset-y-1 left-0 w-full" />
            </span>
          ) : (
            <Skeleton className="h-2.5 w-2/3" />
          )}
        </div>
        <div className="type-row-sub-box flex items-center">
          <Skeleton className="h-2 w-8" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonThemeGroups({
  groups = 3,
  cards = 6,
  counts,
  className,
}: {
  groups?: number;
  cards?: number;
  /**
   * Cards per group, where the caller knows better than the 3×6 guess —
   * the themes page stores the histogram its vault drew last visit,
   * which does not move once the puzzle database is built.
   */
  counts?: number[];
  className?: string;
}) {
  const shape = counts ?? Array.from({ length: groups }, () => cards);
  return (
    <Loading className={className}>
      {shape.map((n, g) => (
        // The real groups end at their last card; a margin under the last
        // placeholder group stood the page 16px taller than it settles.
        <section key={g} className="mb-4 last:mb-0">
          {/* The group heading: an h2 on `type-row` (ThemesPage,
              ThemeGroup), so 20px on a desktop and 24 on a phone. It was
              drawn on a 16px line, then on a pinned 20, which is the
              desktop half of the same mistake. */}
          <div className="type-row-box mb-2 flex items-center">
            <Skeleton className="h-2.5 w-28" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: n }, (_, i) => (
              <SkeletonThemeCard key={i} />
            ))}
          </div>
        </section>
      ))}
    </Loading>
  );
}
