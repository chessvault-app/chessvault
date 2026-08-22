import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn's Tooltip, owned. Radix brings the delay, the skip-delay across
 * neighbouring controls, hover AND keyboard focus as openers (the old
 * delegated `title` promoter never showed on focus), nothing on touch
 * (where there is no hover and the native behaviour — nothing — is
 * right), and placement inside the window. The face is the app's: a quiet
 * card in the popover colours, not the stock inverted chip.
 *
 * One provider at the root (main.tsx); Button wraps itself in one of these
 * whenever it is given a `title`, which is how most of the app's tooltips
 * arrive.
 */

function TooltipProvider({
  delayDuration = 400,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // Pointer-transparent, like the title bubble it replaces: a tip
          // must never take the press meant for the control under it.
          'border-border bg-popover text-muted-foreground pointer-events-none z-50 w-fit max-w-80 origin-(--radix-tooltip-content-transform-origin) rounded-md border px-2 py-1 text-xs leading-[1.4] shadow-pop',
          'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
