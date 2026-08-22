import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn's Card, owned: the standard raised surface — every pane in the
 * app sits in one (ui/Panel composes it, with its resize grip and scroll
 * rules). The face is the app's: the card fill, a border, the panel lift
 * (shadow-panel), rounded-xl.
 */
function Card({ className, ...props }: React.ComponentProps<'section'> & { asChild?: never }) {
  return (
    <section
      data-slot="card"
      className={cn('bg-card text-card-foreground border-border flex flex-col rounded-xl border shadow-panel', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="card-header"
      className={cn('border-border flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3', className)}
      {...props}
    />
  );
}

/** The small-caps label voice every panel is titled in. */
function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="card-title"
      className={cn('text-subtle label-caps min-w-0 flex-1 truncate text-xs', className)}
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
      className={cn('flex shrink-0 items-center justify-end gap-1', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-3', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('border-border flex items-center border-t px-3 py-2', className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
