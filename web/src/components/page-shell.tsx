import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * How wide a scrolling page's column is allowed to get. Three named
 * widths instead of one per page: a width is a statement about the kind
 * of content, not about the page, so pages of the same kind must agree.
 *
 * A width is NOT how a page picks its layout — it is how the scrolling
 * family, one of the three in `components/layout.ts`, varies inside itself. Board
 * and canvas pages have no width to choose.
 *
 * - `xwide`: a data table beside a details column — the one layout that
 *   earns more than `wide`, because every extra pixel is another table
 *   column shown instead of shed (the games page).
 * - `wide`: layouts that split into columns or card grids and would
 *   waste the split on anything narrower (studies, notes).
 * - `medium`: one column read top to bottom — dashboards, shelves,
 *   reference pages. Wider only stretches the lines.
 * - `narrow`: forms and settings, where the eye travels label→control
 *   and the shortest line wins.
 */
export type PageWidth = 'xwide' | 'wide' | 'medium' | 'narrow';

// Complete literals — the Tailwind scanner reads class names from this
// file, and names assembled from fragments would never be emitted.
const WIDTHS: Record<PageWidth, string> = {
  xwide: 'max-w-[96rem]',
  wide: 'max-w-6xl',
  medium: 'max-w-3xl',
  narrow: 'max-w-2xl',
};

/**
 * The shared shell of every scrolling page: a centered column with one
 * gutter scale and one bottom inset, so pages differ by their chosen
 * width and nothing else.
 *
 * The shell scrolls the OUTER element, keeping the scrollbar at the
 * viewport edge rather than at the column's. Pages that manage their own
 * scrolling (the games collection's per-panel scroll, viewport-fitting
 * lists) pass `scroll={false}` and take over via `className`, which is
 * merged onto the inner column and wins on conflict.
 *
 * The bottom inset includes `--safe-b` so the last row clears the iOS
 * home indicator; on anything without safe areas it is plain 2rem.
 *
 * The scrollbar's room is reserved whether or not there is a scrollbar,
 * on both edges, so the column sits in the same place on every page. The
 * bar is 10px (index.css asks for a thin one), it comes out of the
 * scroller's content box, and `mx-auto` then centres the column inside
 * whatever is left — so a page whose content fits drew its column 5px to
 * the right of one whose content does not. Measured on the puzzle pages
 * at 1920: the shelf's column started at 680 and the dashboard's, which
 * scrolls, at 675, off the same max-w-3xl. Two pages of the same family
 * that do not line up read as two different templates, which is what
 * lanph3re saw. `both-edges` rather than plain `stable` because the
 * column is centred: reserving only the end edge keeps it still but
 * leaves it permanently 5px off the middle.
 */
export function PageShell({
  width,
  scroll = true,
  className,
  children,
}: {
  width: PageWidth;
  scroll?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'h-full min-h-0',
        // The gutter is a WIDE, fine-pointer fix: the 5px centring
        // artifact above needs a drawn scrollbar and a centred column
        // with room around it to exist. At phone widths — real phones
        // (overlay bars, coarse pointer) and narrow desktop windows
        // alike — the reservation put these pages 12px deeper than the
        // pages that scroll themselves (Home, Games), and lanph3re saw
        // the two gutters side by side. So it is scoped twice: md, and
        // pointer-fine (whether scrollbar-gutter reserves space for
        // overlay bars varies by browser, so coarse pointers never
        // trust it).
        scroll && 'overflow-y-auto md:pointer-fine:[scrollbar-gutter:stable_both-edges]',
      )}
    >
      <div
        className={cn(
          'mx-auto flex w-full flex-col gap-4 px-4 pt-4 pb-[calc(2rem+var(--safe-b))] md:px-6 md:pt-6',
          WIDTHS[width],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
