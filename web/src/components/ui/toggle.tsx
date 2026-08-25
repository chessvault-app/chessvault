import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Toggle as TogglePrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import { hasTextContent } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn's Toggle (nova), owned: a two-state button (aria-pressed,
 * data-state) in the registry's faces, plus two of this app's: `chip`, the
 * pill a filter row is made of, and `plain`, a bare item for a composite
 * that styles its own (Segmented).
 */
// The lit state is read from aria-pressed (a toggle, an item of a "multiple"
// group) and aria-checked (an item of a "single" group, which is a radio),
// not from data-state alone: a Tooltip trigger wrapped around the control
// writes its own data-state over Radix's.
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-checked:bg-accent aria-checked:text-accent-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        // Outlined peers, the chosen one filled: the others' text is muted so the
        // one that is on reads from its text as well as its fill — on a card,
        // the fill alone is one rung of grey on another.
        outline: 'border border-input bg-transparent text-muted-foreground hover:bg-muted',
        plain: 'hover:bg-transparent aria-pressed:bg-transparent aria-checked:bg-transparent data-[state=on]:bg-transparent',
        chip: 'rounded-full border border-input bg-transparent px-2.5 py-1 text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-checked:text-foreground data-[state=on]:text-foreground pointer-coarse:min-h-9 pointer-coarse:px-3',
      },
      size: {
        default: 'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        /** The chip sizes itself; a height would fight the pill's padding. */
        none: '',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/**
 * `title` is a tooltip, the shadcn way (see Button): Radix's Tooltip on
 * hover and keyboard focus, never the browser's bubble, and an icon-only
 * control's title doubles as its accessible name.
 */
function Toggle({
  className,
  variant = 'default',
  size = 'default',
  title,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  const toggle = (
    <TogglePrimitive.Root
      data-slot="toggle"
      data-variant={variant}
      aria-label={props['aria-label'] ?? (hasTextContent(props.children) ? undefined : title)}
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
  if (title === undefined) return toggle;
  return (
    <Tooltip>
      <TooltipTrigger render={toggle} />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export { Toggle, toggleVariants };
