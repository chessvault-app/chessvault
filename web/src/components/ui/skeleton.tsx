import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn's Skeleton: the grey line box a wait is drawn with. The shapes —
 * cards where cards will be, the tile grid where the grid will be — are
 * composed from this in ui/Skeleton (see docs/design-principles.md,
 * "Waiting").
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

export { Skeleton };
