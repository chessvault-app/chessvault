import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn's Progress, owned: Radix's progressbar role and aria-valuenow
 * over the app's bordered track — a track that stays visible when empty,
 * so nothing at 0% is still plainly a bar. `value` fills it with the
 * primary; ProgressIndicator is exported for a bar that is more than one
 * fill (the solved/failed bar in components/progress-bar).
 */
function Progress({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        'bg-surface-inset border-border-strong relative flex h-2 w-full overflow-hidden rounded-full border',
        className,
      )}
      {...props}
    >
      {children ?? (
        <ProgressIndicator className="bg-primary" style={{ width: `${value ?? 0}%` }} />
      )}
    </ProgressPrimitive.Root>
  );
}

function ProgressIndicator({
  className,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Indicator>) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn('h-full transition-[width]', className)}
      {...props}
    />
  );
}

export { Progress, ProgressIndicator };
