import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn's Progress (nova), owned: the registry's thin muted track and
 * Radix's progressbar role. `value` fills it with the primary;
 * ProgressIndicator is exported for a bar that is more than one fill
 * (the solved/failed bar in components/progress-bar).
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
      className={cn('bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-full', className)}
      {...props}
    >
      {children ?? (
        <ProgressIndicator className="bg-primary size-full flex-1" style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
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
      className={cn('h-full transition-all', className)}
      {...props}
    />
  );
}

export { Progress, ProgressIndicator };
