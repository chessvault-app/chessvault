import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Loading, NAME_WIDTHS } from './primitives';

/**
 * A stack of one-line list rows: a mark, a name, a figure at the end.
 *
 * It used to be a title bar over a detail bar in a padded, gapped box —
 * 40px of placeholder for rows that are 33. Every list that draws this is
 * a single line: the dashboard's attempts and the hub's are `ListRow
 * dense` at `text-sm`, and the map's field table is a subgrid row of the
 * same height. Measured on the dashboard: five placeholders came to 240px
 * against the 165px of rows that replaced them, and the panel — which is
 * drawn from the first paint precisely because these rows ARE its height
 * — stood 75px too tall for the whole wait and then collapsed.
 *
 * So: the dense rung from the density token, one `text-sm` line box, and
 * the hairline between rows that two of the three callers draw. No
 * padding of its own — none of the three lists has any.
 */
export function SkeletonRows({
  rows = 6,
  className,
  nameWidth = 'w-16',
}: {
  rows?: number;
  className?: string;
  /** The name column's own width. The hub's log is an id at `w-16`; the
      dashboard's is a motif at `w-28 sm:w-32`. Everything else about the
      two rows is deliberately identical (HubPage's own comment). */
  nameWidth?: string;
}) {
  return (
    <Loading className={cn('divide-border divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        // The divider and the floor on different boxes, as the real list
        // has them: a `li` carries the hairline and the ListRow inside it
        // carries min-h-11. Both on one border-box element and the border
        // eats a pixel of the floor, so every row came out 1px short.
        <div key={i} className="flex items-center pr-1.5">
          <div
            // ListRow's own floor under a coarse pointer: 44px, where these
            // rows were 33 and the dashboard's list grew 11px a row on a phone.
            className="flex min-w-0 flex-1 items-center gap-2.5 px-3 pr-1.5 py-(--row-py-dense) pointer-coarse:min-h-11"
          >
            {/* A bar, not an icon: the mark on these rows is the attempt's
                outcome (solved, failed), which is the data being waited
                for. */}
            <Skeleton className="glyph shrink-0 rounded-sm" />
            {/* Both lists these stand for are five columns, not three: a
                mark, a name, the difficulty word, a right-aligned time and
                the eye beside the row. Drawn as three, every row re-laid
                itself out sideways when the answers came. */}
            {/* Each cell on the row's own line box: the rows these stand
                for are `ListRow dense` at `type-row`, so 20px on a
                desktop and 24 on a phone. Pinned at 20, the row was 4px
                short on a fine-pointer window under md; on a touch screen
                ListRow's 44px floor hid it on both sides. */}
            <div className={cn('type-row-box flex shrink-0 items-center', nameWidth)}>
              <Skeleton className={cn('h-2.5 max-w-full', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
            </div>
            <div className="type-row-box flex w-14 shrink-0 items-center">
              <Skeleton className="h-2.5 w-10" />
            </div>
            <div className="type-row-box ml-auto flex w-20 shrink-0 items-center justify-end">
              <Skeleton className="h-2.5 w-12" />
            </div>
          </div>
          {/* PreviewEye is an icon-xs button: size-6, and size-9 under a
              thumb. Kept, not drawn, as the chevrons elsewhere are. */}
          <span aria-hidden className="size-6 shrink-0 pointer-coarse:size-9" />
        </div>
      ))}
    </Loading>
  );
}

/**
 * The licences page's rows: a chevron, a package name, its version and a
 * licence pill on the page's own button, which is `px-2
 * py-(--row-py-dense)` with a 36px floor under a coarse pointer — not
 * ListRow's dense rung, which carries that floor at every pointer. The
 * page drew SkeletonRows for a while, and the demo measured the
 * difference: ten placeholders at 33px against rows of 37 on a desktop,
 * and 44 (ListRow's coarse floor) against the same 37 on a phone.
 *
 * Those two numbers are the row as it stood in 2026-09-11. It has since
 * taken the density token and the type rungs, and this had kept a literal
 * copy of the old arithmetic, which is what the tokens exist to stop.
 *
 * Two boxes a row, as the page draws it: the hairline is the list item's
 * and the padding is the button's inside it. With the padding on the
 * divided box itself, the border came out of the row and every one was a
 * pixel short.
 */
/** Leading inventory rows that print no version; see the row below. */
const VERSIONLESS_LICENCE_ROWS = 9;

export function SkeletonLicenceRows({ rows = 10, className }: { rows?: number; className?: string }) {
  return (
    <Loading className={cn('divide-border divide-y', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}>
          {/* The page's own row (LicensesPage): the density token, and the
              36px floor only under a coarse pointer. Both were pinned —
              `py-1.5` and an unconditional `min-h-9` — which is the
              settled height on a touch screen and nowhere else. On a
              fine-pointer desktop the row is 32px comfortable and 26
              compact, so ten placeholders stood 40px over the rows at one
              rung and 100 at the other. */}
          <div className="flex items-center gap-2 px-2 py-(--row-py-dense) pointer-coarse:min-h-9">
            {/* The row's own chevron (LicensesPage), closed: it is the same
                glyph on every row and depends on nothing the page is
                waiting for. */}
            <ChevronRight className="text-muted-foreground glyph shrink-0" aria-hidden />
            {/* The name, the version and the pill share one WRAPPING box,
                as the row does: below sm the name takes `basis-full` and
                the other two drop to a line of their own. Drawn as three
                siblings on one line, the placeholder was a 36px row where
                the settled one is 62 — 26px each, 260 over the ten this
                reserves, on every phone. The row took the wrap one day
                after this placeholder was written and it was never told. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
              {/* The package name, on the row's own `type-row`. */}
              <div className="type-row-box flex min-w-0 basis-full items-center sm:flex-1 sm:basis-0">
                <Skeleton className={cn('h-2.5', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
              </div>
              {/* The version, on the rows that have one. The inventory
                  opens with the copied assets (web/vite.licenses.ts
                  ASSETS), which carry no version, and the first installed
                  package is the tenth row: checked against the built
                  index.json, entries 0-8 print none and entry 9 is the
                  first that does. A bar on all ten stood where nine
                  settled rows have nothing. Add an asset and this number
                  moves with it. */}
              {i >= VERSIONLESS_LICENCE_ROWS && (
                <div className="type-row-sub-box flex shrink-0 items-center">
                  <Skeleton className="h-2.5 w-10" />
                </div>
              )}
              {/* The licence pill: a `type-row-sub` line in `py-px` inside
                  a border, so its box is that line plus 4 — 20px from md
                  and 24 below it, which no type box states on its own.
                  Widths measured at 81-114px across the names that
                  actually stand here (MIT to Apache-2.0), so they are
                  ragged rather than one 48px stub that ended nowhere near
                  them. */}
              <Skeleton
                className={cn('h-5 shrink-0 rounded-full max-md:h-6', ['w-20', 'w-24', 'w-28', 'w-20'][i % 4])}
              />
            </div>
          </div>
        </div>
      ))}
    </Loading>
  );
}
