import * as React from 'react';
import { type VariantProps } from 'class-variance-authority';
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';

import { cn } from '@/lib/utils';
import { hasTextContent } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toggleVariants } from '@/components/ui/toggle';

/**
 * shadcn's ToggleGroup (nova), owned: a strip of Toggles that is one
 * choice (the default — Base UI's `value` is always an array, one entry
 * long here — with the roving tab stop and the arrow keys) or several
 * (`multiple`). `spacing={0}` joins the items into one control with
 * shared corners — the segmented shape.
 */
const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & { spacing?: number; orientation?: 'horizontal' | 'vertical' }
>({ size: 'default', variant: 'default', spacing: 2, orientation: 'horizontal' });

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = 'horizontal',
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & { spacing?: number }) {
  // One context object per distinct set of values: a fresh literal each
  // render re-rendered every item (and its Tooltip) on every parent render.
  const context = React.useMemo(
    () => ({ variant, size, spacing, orientation }),
    [variant, size, spacing, orientation],
  );
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      orientation={orientation}
      style={{ '--gap': spacing } as React.CSSProperties}
      className={cn(
        'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={context}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

/**
 * `title` is a tooltip, the shadcn way (see Button): the Tooltip on
 * hover and keyboard focus, never the browser's bubble, and an icon-only
 * control's title doubles as its accessible name.
 */
function ToggleGroupItem({
  className,
  children,
  variant = 'default',
  size = 'default',
  title,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants> & { title?: string }) {
  const context = React.useContext(ToggleGroupContext);
  const item = (
    <TogglePrimitive
      aria-label={props['aria-label'] ?? (hasTextContent(children) ? undefined : title)}
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        'shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t',
        toggleVariants({ variant: context.variant || variant, size: context.size || size }),
        className,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
  if (title === undefined) return item;
  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export { ToggleGroup, ToggleGroupItem };
