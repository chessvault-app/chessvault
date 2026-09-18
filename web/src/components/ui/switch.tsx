import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn's Switch (nova), owned: the registry's pill and knob, Base UI's
 * switch role. `after:-inset-x-3 after:-inset-y-2` is the registry's own
 * bigger hit box; on a coarse pointer the box is stretched to the app's
 * 36px floor (DESIGN.md, Buttons) whatever the pill's own height, since
 * the registry's 34px was measured 2px short. `title` is a tooltip, as
 * on Button.
 *
 * Styled off aria-checked, the one signal the switch role guarantees —
 * it survived a data-attribute collision already (a Radix TooltipTrigger
 * used to overwrite data-state).
 */
function Switch({
  className,
  size = 'default',
  title,
  ...props
}: SwitchPrimitive.Root.Props & { size?: 'sm' | 'default'; title?: string }) {
  const control = (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 pointer-coarse:after:inset-y-[calc((100%-2.25rem)/2)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        'aria-checked:bg-primary aria-[checked=false]:bg-input dark:aria-[checked=false]:bg-input/80 disabled:cursor-not-allowed disabled:opacity-50',
        // iOS: the platform's own switch ("Platform-specific design",
        // docs/design-principles.md): a 51 by 31pt track, green when on
        // (--switch-on, tokens.css), a 27pt white thumb with a shadow. The
        // registry's switch is what every other platform draws.
        'ios:data-[size=default]:h-[31px] ios:data-[size=default]:w-[51px] ios:aria-checked:bg-switch-on',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'bg-background pointer-events-none block translate-x-0 rounded-full ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-aria-checked/switch:translate-x-[calc(100%-2px)] dark:bg-foreground dark:group-aria-checked/switch:bg-primary-foreground',
          // iOS: 27px, white in both themes, a shadow, and 2px in from
          // the track's ends (49px inside the 1px border, less 27).
          'ios:group-data-[size=default]/switch:size-[27px] ios:group-data-[size=default]/switch:translate-x-[1px] ios:group-data-[size=default]/switch:group-aria-checked/switch:translate-x-[21px] ios:bg-white ios:shadow-md',
        )}
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
