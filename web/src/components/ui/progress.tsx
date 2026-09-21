import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn } from '@/lib/utils';

/**
 * shadcn's Progress (nova), owned: the registry's thin muted track and
 * Base UI's progressbar role. `value` fills it with the primary (the
 * primitive sizes its own Indicator from the value); ProgressIndicator
 * is exported for a bar that is more than one fill (the solved/failed
 * bar in components/progress-bar), where each fill states its width and
 * that explicit style wins over the primitive's own.
 *
 * On Android the track takes Material 3 Expressive's shape: rounded ends
 * on the fill, a 4px gap, then the inactive track, and a stop dot at the
 * far end. It is drawn entirely in styles/progress.css, off the value this
 * writes into `--progress-pct`, so there is one component on every
 * platform and an iPhone or a desktop renders what it did before.
 * `fills` is how a bar says the shape does not describe it: "many" is the
 * solved/failed bar, whose track already carries a boundary of its own.
 */
function Progress({
  className,
  value,
  children,
  fills = 'one',
  ...props
}: ProgressPrimitive.Root.Props & { fills?: 'one' | 'many' }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-fills={fills}
      value={value}
      // The gap is 4px only while there is an active track to hold it off:
      // at 0 it would be a notch at the left end of an empty bar, which is
      // what every placeholder draws.
      style={{ '--progress-pct': `${value || 0}%`, '--progress-gap': value ? '4px' : '0px' } as React.CSSProperties}
      className={cn('bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-full', className)}
      {...props}
    >
      {/* No `flex-1` on the default fill, though the registry writes one:
          the registry's nova indicator is positioned by `translateX` on a
          full-width block, where growing to the track is the point. This
          one states a `width` instead, and flex-grow on a flex track beats
          that width every time — a bar at any value drew itself full. */}
      {children ?? <ProgressIndicator className="bg-primary size-full" style={{ width: `${value || 0}%` }} />}
    </ProgressPrimitive.Root>
  );
}

function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn('h-full transition-all', className)}
      {...props}
    />
  );
}

export { Progress, ProgressIndicator };
