import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn's Skeleton: the grey line box a wait is drawn with. The shapes —
 * cards where cards will be, the tile grid where the grid will be — are
 * composed from this in ui/Skeleton (see docs/design-principles.md,
 * "Waiting").
 *
 * The fill is the registry's own accent, not muted. This copy said muted
 * for a while, and the tonal light theme (2026-09-07) then put the page
 * ground on the same 97% rung as muted: a bar drawn on the page painted
 * nothing at all, on every page that waits on the ground rather than in
 * a card. Sampled on the demo's licences page at 390: bar 245,245,245 on
 * a ground of 245,245,245; with accent, 237 on 245. Accent is the rung
 * above the page, above a muted well, and two rungs under a white card,
 * so one fill reads everywhere but on a surface that is already accent:
 * a lit chip, or the primary/10 well of home's Continue row, which in
 * light composites to the same 231. Those two sites pass the primary at
 * 20%, the rung deeper in the well's own ink.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('bg-accent animate-pulse rounded-md', className)} {...props} />;
}

export { Skeleton };
