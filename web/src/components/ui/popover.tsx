import { Popover as PopoverPrimitive } from '@base-ui/react/popover';

import { cn } from '@/lib/utils';
import { closeByRoute, useOpenPopup } from '@/lib/popups';

/** shadcn's Popover (nova), owned: the registry's face; Base UI's focus scope, dismissal and placement. */
function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  // Closed by the router before a page turn (lib/popups): a popup closing
  // inside the turn would make React skip it.
  useOpenPopup(props.open === true, closeByRoute(props.onOpenChange));
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  onClick,
  onPointerDown,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  collisionPadding,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset' | 'collisionPadding' | 'anchor'
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        // Forwarded so a popup can hang off something that is not its
        // trigger — a caret, a cell, a point on a board. Base UI takes an
        // element, a ref, or a virtual `{ getBoundingClientRect }`.
        anchor={anchor}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          // A press inside this layer must not reach what the layer was written
          // inside: React bubbles through portals, and a card or a row that
          // opens on click would open under a menu item or a dialog's button.
          onClick={(e) => {
            onClick?.(e);
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            onPointerDown?.(e);
            e.stopPropagation();
          }}
          className={cn(
            'bg-popover text-popover-foreground ring-window-ring z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg p-2.5 text-sm shadow-md ring-1 outline-hidden duration-100',
            // iOS: glass (utilities.css). Popover and card are one token.
            'ios:glass',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
