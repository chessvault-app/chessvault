import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn's Switch, owned: Radix's switch role, Space/Enter, `data-state`;
 * the app's 36×20 pill with the white knob on the filled track in both
 * themes (--knob). The pill stays its size and the FINGER gets a bigger
 * one: an invisible inset extends the hit box to ~44px on coarse pointers
 * without growing the visual. `title` is a tooltip, as on Button.
 */
function Switch({
  className,
  title,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const control = (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group/switch relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200',
        'pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-[""]',
        // Styled off aria-checked, not data-state: a TooltipTrigger around
        // this (the `title` below) writes its own data-state onto the same
        // element and Radix's switch state loses. aria-checked is the
        // switch's alone.
        'aria-checked:bg-primary aria-[checked=false]:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-knob pointer-events-none block size-4 rounded-full shadow transition-transform duration-200 translate-x-0.5 group-aria-checked/switch:translate-x-[1.125rem]"
      />
    </SwitchPrimitive.Root>
  );
  if (title === undefined) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export { Switch };
