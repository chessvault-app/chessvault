import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn's Switch (nova), owned: the registry's pill and knob, Radix's
 * switch role. `after:-inset-x-3 after:-inset-y-2` is the registry's own
 * bigger hit box. `title` is a tooltip, as on Button.
 *
 * Styled off aria-checked, not data-state: a TooltipTrigger around this
 * writes its own data-state onto the same element and Radix's switch
 * state loses. aria-checked is the switch's alone.
 */
function Switch({
  className,
  size = 'default',
  title,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: 'sm' | 'default' }) {
  const control = (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        'aria-checked:bg-primary aria-[checked=false]:bg-input dark:aria-[checked=false]:bg-input/80 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-background pointer-events-none block translate-x-0 rounded-full ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-aria-checked/switch:translate-x-[calc(100%-2px)] dark:bg-foreground dark:group-aria-checked/switch:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  );
  if (title === undefined) return control;
  return (
    <Tooltip>
      <TooltipTrigger render={control} />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export { Switch };
