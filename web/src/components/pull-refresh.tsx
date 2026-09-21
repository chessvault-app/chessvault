import { Spinner } from '@/components/ui/spinner';
import { currentPlatform } from '@/lib/platform';
import { cn } from '@/lib/utils';

/**
 * What a pull to refresh draws (hooks/use-pull-refresh drives it), which
 * is not the same control on the two phones.
 *
 * It was one drawing until 2026-09-21 — Material's raised circle on
 * both — on the argument that iOS's own rubber band would move the page
 * under it and the two would read as one gesture. On lanph3re's phone
 * they read as two: the band dragged the whole page, header included,
 * about 200pt down, and the circle, drawn at a fixed spot, sat on the
 * header's buttons in the middle of the gap the band had opened.
 *
 * So each platform gets its own, from the same two custom properties.
 * `--pull-gap` is how tall the gap at the top of the scroller is, and
 * `--pull-own` how much of it the app opened rather than the browser,
 * which is what lets iOS place the indicator against the TRUE top of the
 * scroller while this element rides down with the content.
 *
 * iOS (UIRefreshControl): no container at all. The bare spoke indicator,
 * 28px in the muted ink, centred across the page and centred in the band
 * between the status-bar inset and the content as that band grows. It
 * fades and scales in with the pull and turns once the refetch is out.
 * Its vertical place is one expression: this box sits at the content's
 * top, the gap's own top is `--pull-gap` above that, and the middle of
 * what is left under the inset is `(--page-t - --pull-gap) / 2` from
 * here, plus back down by whatever part of the gap the app itself made.
 *
 * Android and a narrow desktop window (Material): the raised circle,
 * travelling down over content that never moves, resting clear of the
 * page header's row rather than on it.
 *
 * Sticky with no height of its own, so it takes no room in the column and
 * asks nothing of the scroller around it: at rest it is a zero-height line
 * at the top of the list and the indicator hangs out of sight until a
 * finger pulls it down.
 *
 * `aria-hidden`: the refetch it stands for changes rows a reader is
 * already on, and the page says so in its own words. There is nothing
 * here for a pointer either, so it never takes a tap meant for the first
 * row.
 *
 * The hook finds it by `data-slot`, inside the scroller it was given, so
 * nothing has to be threaded back: a ref handed from the hook to this
 * component as a prop is a shape the React Compiler refuses.
 */
export function PullRefresh({ className }: { className?: string }) {
  // Branched in TypeScript, not by stacking `ios:` on one element: the
  // two are different boxes at different sizes in different places, which
  // is the geometry case the platform rule allows, and drawing both would
  // put two `role="status"` spinners in the tree for one gesture. The
  // platform is decided before the first render and never changes
  // (lib/platform.ts), so this read is constant for the session.
  const ios = currentPlatform() === 'ios';
  return (
    <div
      aria-hidden
      data-slot="pull-refresh"
      // Fine pointers have the page's own controls and never see this.
      className={cn('group pointer-events-none sticky top-0 z-20 h-0 pointer-fine:hidden', className)}
    >
      <div
        // The placements are two rules in styles/pull-refresh.css; both
        // are expressions over --pull-gap, --pull-own and --page-t.
        data-slot="pull-indicator"
        className={cn(
          'text-muted-foreground absolute top-0 left-1/2 flex items-center justify-center opacity-(--pull-p,0)',
          ios
            ? // No container: iOS's own control is the activity indicator
              // and nothing else. 28px, and the negative margins centre
              // the box on the point the placement computes.
              '-mt-3.5 -ml-3.5 size-7'
            : // Material's raised circle, in the card's fill over the
              // content it travels across.
              'bg-card ring-card-ring -mt-4 -ml-4 size-8 rounded-full shadow-md ring-1',
          // The release springs back on the app's one spring
          // (styles/pane-swipe.css). Taken away while the finger is down,
          // where a transition would put the indicator a frame behind it.
          'transition-[transform,opacity] duration-(--pane-turn) ease-(--pane-turn-ease)',
          'group-data-[pull=pulling]:transition-none',
        )}
      >
        {/* Still while it is being pulled, spinning once the refetch is
            out. The registry's spinner spins on sight, which here would
            say "working" before anything had been asked for. iOS's turn
            is its own stepped one: `animate-spin` would smooth the ring
            the drawing steps a spoke at a time (components/ui/spinner). */}
        <Spinner
          className={cn(
            'animate-none',
            ios
              ? 'size-7 group-data-[pull=refreshing]:animate-[spin_1s_steps(8)_infinite]'
              : 'glyph group-data-[pull=refreshing]:animate-spin',
          )}
        />
      </div>
    </div>
  );
}
