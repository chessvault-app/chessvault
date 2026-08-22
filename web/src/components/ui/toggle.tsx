import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Toggle as TogglePrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn's Toggle, owned: a two-state button (aria-pressed, data-state).
 * `chip` is this app's filter chip — the outlined pill that fills with the
 * accent when it is on; `default`/`outline` are the stock faces.
 */
const toggleVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'rounded-lg bg-transparent hover:bg-accent hover:text-foreground data-[state=on]:bg-muted',
        outline:
          'rounded-lg border border-border bg-transparent hover:bg-accent hover:text-foreground data-[state=on]:bg-muted',
        /** Bare: for a composite that styles its own items (Segmented). */
        plain: '',
        chip:
          'rounded-full border text-sm px-2.5 py-1 pointer-coarse:min-h-9 pointer-coarse:px-3 ' +
          'border-border text-muted-foreground hover:border-border-strong ' +
          'data-[state=on]:bg-primary-soft data-[state=on]:border-primary/40 data-[state=on]:text-primary',
      },
      size: {
        default: 'h-8 min-w-8 px-2.5 text-sm',
        sm: 'h-7 min-w-7 px-2 text-sm',
        lg: 'h-9 min-w-9 px-2.5 text-base',
        /** The chip sizes itself; a height would fight the pill's padding. */
        none: '',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Toggle({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      data-variant={variant}
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
