import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn's Card (nova), owned: the registry's file, with the registry's own
 * spacing model intact. The root owns the vertical padding and the gap
 * between slots; CardHeader, CardContent and CardFooter pad themselves
 * horizontally from the same `--card-spacing`. Two rules do the work that
 * every call site here used to hand-roll — `gap-(--card-spacing)` is what
 * puts air between a body and the footer below it, and
 * `has-data-[slot=card-footer]:pb-0` drops the root's own floor when a
 * footer is present so the muted band reaches the card's bottom edge
 * without negative margins.
 *
 * Two departures from the registry text, neither of them about spacing:
 * the slots are semantic elements (`section`/`header`/`h2`) rather than
 * four `div`s, and the title uses this app's `font-heading` token — the
 * registry's `cn-font-heading` class does not exist outside its own
 * stylesheet, so copying it verbatim would silently drop the heading font.
 */
function Card({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'section'> & { size?: 'default' | 'sm' }) {
  return (
    <section
      data-slot="card"
      data-size={size}
      className={cn(
        'group/card bg-card text-card-foreground ring-foreground/10 flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm ring-1 [--card-spacing:var(--card-pad)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="card-title"
      className={cn('font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-muted-foreground text-sm', className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      // py-3, not the card's 16: the rows in here are buttons that carry
      // their own height (36px on touch), and most are ghosts whose
      // padding is invisible — 16px above and below made the band read
      // ~26px deep either side of the text. Horizontal keeps the card's
      // spacing so the contents line up with the content edge above.
      className={cn('bg-muted/50 flex items-center rounded-b-xl border-t px-(--card-spacing) py-3', className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
