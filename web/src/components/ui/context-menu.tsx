import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu';

import { cn } from '@/lib/utils';
import { closeByRoute, useOpenPopup } from '@/lib/popups';
import { MENU_ITEM } from '@/components/ui/dropdown-menu';

/**
 * shadcn's ContextMenu (nova), owned — the same menu as DropdownMenu,
 * opened at the pointer by a right-click (or a long press), so it shares
 * that file's row classes and face.
 */

const CONTENT =
  // iOS: glass (utilities.css). Popover and card are one token, and the
  // glass is max-md: it is the phone's material, and `ios:` alone
  // reached an iPad (popover.tsx has the measurement).
  'max-md:ios:glass bg-popover text-popover-foreground ring-window-ring z-50 min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg p-1 shadow-md ring-1 duration-100 outline-none ' +
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95';

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  // Closed by the router before a page turn (lib/popups).
  useOpenPopup(props.open === true, closeByRoute(props.onOpenChange));
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuGroup({ ...props }: ContextMenuPrimitive.Group.Props) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

function ContextMenuContent({
  className,
  onClick,
  onPointerDown,
  ...props
}: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
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
          className={cn(CONTENT, 'max-h-(--available-height)', className)}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ContextMenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(MENU_ITEM, className)}
      {...props}
    />
  );
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: ContextMenuPrimitive.GroupLabel.Props & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn('text-muted-foreground truncate px-1.5 py-1 text-xs max-md:type-row-sub font-medium data-inset:pl-7', className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuGroup,
};
