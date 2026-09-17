import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

import { cn } from '@/lib/utils';

/**
 * shadcn's Tooltip (nova), owned: the inverted chip with its arrow. Base UI
 * brings the delay, the skip-delay across neighbouring controls, hover AND
 * keyboard focus as openers, nothing on touch, and placement inside the
 * window. One provider at the root (main.tsx); Button wraps itself in one
 * of these whenever it is given a `title`.
 */
function TooltipProvider({ delay = 400, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />;
}

/**
 * Whether the page is being driven by a finger. Base UI opens nothing for
 * a touch POINTER, but a tap is followed by the browser's compatibility
 * mouse events and, on a focusable trigger, by focus, and either can open
 * a tip: a tap on a game row raised its opening's name over the list
 * (lanph3re's report, on an iPhone; Playwright's touch emulation sends no
 * such events and raised none in 8 taps, so this is unverified there).
 * iOS also re-sends its sticky hover when a hidden page is shown again,
 * long after the tap, which is why this is a modality and not a timeout.
 * A real mouse or a key takes it back, so a laptop with a touchscreen
 * keeps its mouse's tips and a phone with a keyboard its focus ones.
 */
let byTouch = false;
if (typeof document !== 'undefined') {
  const onPointer = (e: PointerEvent): void => {
    byTouch = e.pointerType === 'touch';
  };
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', onPointer, opts);
  document.addEventListener('pointermove', onPointer, opts);
  document.addEventListener('keydown', () => (byTouch = false), opts);
}

function Tooltip({ onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      onOpenChange={(open, details) => {
        if (open && byTouch) {
          details.cancel();
          return;
        }
        onOpenChange?.(open, details);
      }}
      {...props}
    />
  );
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 0,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'bg-foreground text-background z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md px-3 py-1.5 text-xs has-data-[slot=kbd]:pr-1.5',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] data-[side=bottom]:top-1 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
