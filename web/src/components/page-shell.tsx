import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PullRefresh } from '@/components/pull-refresh';
import { usePullRefresh } from '@/hooks/use-pull-refresh';

/** The handler a shell with nothing to refetch never runs. Module scope,
    so it is one identity for every render. */
const NO_REFRESH = (): void => {};

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
  onRefresh,
  className,
  children,
}: {
  width: PageWidth;
  scroll?: boolean;
  /**
   * Fetch this page's data again when the reader pulls the top of it
   * down on a phone (hooks/use-pull-refresh). Given by pages whose data
   * can change outside this client, which is most of them: the vault is
   * written by the desktop app while a phone is looking at it.
   *
   * Only where the shell owns the scrolling. A page that manages its own
   * (`scroll={false}`) has to wire the hook where its scroller is, since
   * this element is not one.
   */
  onRefresh?: () => void | Promise<unknown>;
  className?: string;
  children: ReactNode;
}) {
  const pullRef = usePullRefresh({
    onRefresh: onRefresh ?? NO_REFRESH,
    enabled: scroll && onRefresh !== undefined,
  });
  return (
    <div
      ref={pullRef}
      // Marks the page's scroller for the screenshot grid (shot-grid.ts),
      // which scrolls it to picture the header's compact state.
      data-page-scroll={scroll ? '' : undefined}
      className={cn(
        'h-full min-h-0',
        // On iOS the page scrolls UNDER the floating bar: the scroller
        // reaches through main's padding band to the bottom of the screen
        // (main clips at its padding edge, so the band is inside it) and
        // the column below clears the bar's footprint instead of the
        // indicator. Only a scroller: a page that manages its own
        // scrolling does the same in its own file.
        scroll && 'ios:h-[calc(100%+var(--bottom-bar-h))]',
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
        // A page that refreshes on a pull opens that gap itself, under its
        // header. Safari's own rubber band would drag the header down with
        // everything else, so this scroller asks for none on iOS; where the
        // browser bands anyway the hook subtracts what it moved.
        scroll && onRefresh !== undefined && 'ios:overscroll-y-none',
      )}
    >
      {/* Outside the column, not in it: the column is a flex box with a
          gap, and a zero-height child there would still be worth one gap
          at the top of every adopting page. */}
      {scroll && onRefresh !== undefined && <PullRefresh />}
      <div
        // What a pull to refresh moves on iOS, where the control is a gap
        // above the content rather than a circle over it
        // (hooks/use-pull-refresh writes a transform here). The column
        // itself, not a wrapper around it: a box between the scroller and
        // this one would be a new percentage base under every `min-h-full`
        // a page passes in through className.
        data-slot="pull-content"
        className={cn(
          // The top adds --page-t, the phone's status-bar inset (styles/
          // shell.css): the column starts under it, and what scrolls
          // passes through it, as the bottom does the home indicator.
          'mx-auto flex w-full flex-col gap-4 px-4 pt-[calc(1rem+var(--page-t))] pb-[calc(2rem+var(--safe-b))] md:px-6 md:pt-6',
          scroll && 'ios:pb-[calc(1rem+var(--page-b))]',
          WIDTHS[width],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
