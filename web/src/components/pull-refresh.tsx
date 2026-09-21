import type { Ref } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * What a pull to refresh draws: a circle that comes down over the top of
 * the list with the finger, fills in as it goes, and spins while the
 * refetch is out (hooks/use-pull-refresh drives it).
 *
 * One drawing on both phones rather than two. iOS reveals its spinner in
 * the gap its rubber band opens and Material drops a raised circle over
 * the content, and the difference between them is a wrapper the whole of
 * a page's content would have to travel inside: every adopting list would
 * need a second element, and a page that scrolls under the floating bar
 * would be moving the band it scrolls under. The circle is what Material
 * draws and what iOS's own rubber band puts the same spinner in, so on
 * iOS the native band moves the page under it and the two read as one
 * gesture. A second drawing can be had later for the price of that
 * wrapper; it is not worth it yet.
 *
 * Sticky with no height of its own, so it takes no room in the column and
 * asks nothing of the scroller around it: at rest it is a zero-height line
 * at the top of the list and the circle hangs above it, out of sight,
 * until a finger pulls it down.
 *
 * `aria-hidden`: the refetch it stands for changes rows a reader is
 * already on, and the page says so in its own words. There is nothing
 * here for a pointer either, so it never takes a tap meant for the first
 * row.
 */
export function PullRefresh({ ref, className }: { ref: Ref<HTMLDivElement>; className?: string }) {
  return (
    <div
      ref={ref}
      aria-hidden
      data-slot="pull-refresh"
      // Fine pointers have the page's own controls and never see this.
      className={cn('group pointer-events-none sticky top-0 z-20 h-0 pointer-fine:hidden', className)}
    >
      <div
        className={cn(
          'bg-card ring-card-ring text-muted-foreground absolute top-0 left-1/2 -ml-4 flex size-8 items-center justify-center rounded-full opacity-(--pull-p,0) shadow-md ring-1',
          // The circle starts above the list's first pixel, so a pull that
          // goes nowhere shows nothing at all, and turns half a revolution
          // on the way down: the glyph is the pull's own dial before it is
          // a spinner.
          '[transform:translate3d(0,calc(var(--pull-y,0px)-2.5rem),0)_rotate(calc(var(--pull-p,0)*180deg))]',
          // The release springs back on the app's one spring
          // (styles/pane-swipe.css). Taken away while the finger is down,
          // where a transition would put the circle a frame behind it.
          'transition-[transform,opacity] duration-(--pane-turn) ease-(--pane-turn-ease)',
          'group-data-[pull=pulling]:transition-none',
        )}
      >
        {/* Still while it is being pulled, spinning once the refetch is
            out. The registry's spinner spins on sight, which here would
            say "working" before anything had been asked for. */}
        <Spinner className="glyph animate-none group-data-[pull=refreshing]:animate-spin" />
      </div>
    </div>
  );
}
