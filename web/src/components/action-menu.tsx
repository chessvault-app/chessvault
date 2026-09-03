import { useState, type ReactElement, type ReactNode } from 'react';
import { useRender } from '@base-ui/react/use-render';

import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/lib/i18n';
import { isCoarsePointer, useMediaQuery } from '@/lib/media';

export interface MenuAction {
  label: string;
  /** Any icon component taking a class: a lucide icon, or the app's own. */
  icon: React.ComponentType<{ className?: string }>;
  /** Destructive items are tinted and sit last, away from the thumb. */
  danger?: boolean;
  /**
   * Offered but not available yet — a verb whose job is already running.
   *
   * Opt-in, because the alternative a caller reaches for otherwise is
   * dropping the item from the list, and a menu whose contents change
   * under you is a menu you have to read twice. The verb stays where it
   * was, dimmed, and says so by being unpressable.
   */
  disabled?: boolean;
  /**
   * On the item itself — for one that only belongs on some devices.
   *
   * A row whose icons are visible on a desktop should not list those same
   * icons again inside its own overflow menu; `pointer-fine:hidden` drops
   * the duplicate where the icon is already on screen, without the menu
   * having to know what a pointer is.
   */
  className?: string;
  onSelect: () => void;
}

/** Where a menu stops being a sheet and becomes a popover. */
const WIDE = '(min-width: 40rem)';

/**
 * The child rendered as itself with these props merged on — Base UI's
 * render machinery, standing where Radix's Slot used to: the phone
 * branches have no Trigger part to hand the child to.
 */
function RenderChild({ children, ...props }: { children: ReactElement } & Record<string, unknown>) {
  return useRender({ render: children, props });
}

/**
 * A row's actions: a list of verbs, each with a name and a whole row to be
 * pressed in.
 *
 * A card used to wear its verbs — a pencil, a folder-in, a bin, three of
 * them per row, revealed on hover and permanently visible on touch. That
 * is a lot of chrome repeated down a list, and on a phone they were three
 * small targets in the corner of a card you were probably trying to open.
 * One ⋯ opens this instead.
 *
 * On a desktop it is shadcn's DropdownMenu under the control it came from
 * (Base UI: menu role, arrow keys and typeahead, first verb focused,
 * placed inside the window) — a bar sliding up from the bottom of a 1400px
 * window is a long way from a button in the middle of it, and a mouse
 * has no reach problem to solve. On a phone it is the app's bottom sheet
 * (components/ui/dialog, with the scrim, the drag and Back every other
 * phone window has), rising where the thumb already is.
 *
 * The child is the trigger and is rendered as itself (the `render` prop):
 * a Button, with its own title and size.
 */
export function ActionMenu({
  title,
  actions,
  children,
  detail,
  align = 'end',
  open,
  onOpenChange,
}: {
  title: string;
  actions: MenuAction[];
  /** The control that opens it. */
  children: ReactElement;
  /** Anything above the verbs — a detail line, say. */
  detail?: ReactNode;
  /** Which edge of the trigger the desktop menu hangs from. */
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const wide = useMediaQuery(WIDE);
  // Uncontrolled unless the caller holds the state (to light its trigger).
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const setOpen = (next: boolean): void => {
    setOwn(next);
    onOpenChange?.(next);
  };

  if (wide) {
    return (
      <DropdownMenu open={isOpen} onOpenChange={setOpen}>
        <DropdownMenuTrigger render={children} />
        <DropdownMenuContent align={align} className="w-56">
          {/* One group holding the label and its verbs: Base UI's
              GroupLabel only exists inside a Group (the registry's own
              composition rule too). */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t(title)}</DropdownMenuLabel>
            {/* The dropdown's own indent for a detail line — px-3 was on
                the detail itself before, where it doubled as a sheet
                indent bug; see the sheet branch. */}
            {detail && <div className="px-3">{detail}</div>}
            {actions.map((action) => (
              <MenuRow key={action.label} action={action} kind="dropdown" />
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <RenderChild
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={(e: React.MouseEvent) => {
          // A ⋯ on a card that opens on press: the press is the menu's,
          // not the card's.
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </RenderChild>
      {isOpen && (
        <ActionSheetBody title={title} actions={actions} detail={detail} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/**
 * The same verbs, opened by a right-click at the pointer — or, on a phone,
 * by a long press (the platform's contextmenu event) into the same sheet.
 * The child is the thing being acted on: a row, a card.
 */
export function ActionContextMenu({
  title,
  actions,
  children,
  disabled = false,
  beforeOpen,
}: {
  title: string;
  actions: MenuAction[];
  children: ReactElement;
  disabled?: boolean;
  /**
   * Runs at the press, before the menu opens; returning false leaves it
   * shut. Opt-in, and for the caller whose child is one trigger over many
   * things — a move list, where a row per menu would be a media query and
   * a menu root per move. Such a caller reads the press here to learn
   * which of them was hit, and refuses the ones with nothing to offer.
   *
   * The press is refused rather than answered with an empty menu: a popup
   * that opens holding nothing reads as a bug, and is one more thing to
   * dismiss.
   */
  beforeOpen?: (event: React.MouseEvent) => boolean;
}) {
  // The width is only half the question here, unlike the ⋯ menu above,
  // where it is the whole of it. The branch below is a RIGHT-CLICK menu,
  // and a thumb has no right click — it has the long press, which the
  // narrow branch answers with the app's own sheet. Read on width alone, a
  // phone held sideways is 812px and got the desktop popup: the wrong
  // shape for a thumb, and Base UI's trigger brings touch handlers of its
  // own that swallowed the touchstart, which left the pane swipe dead on
  // the one pane that has this menu in it (hooks/use-pane-swipe).
  const wide = useMediaQuery(WIDE) && !isCoarsePointer();
  const [open, setOpen] = useState(false);

  if (disabled) return children;

  if (wide) {
    return (
      <ContextMenu>
        {/* The guard rides the trigger, not the child: Base UI runs a
            caller's handler BEFORE its own and lets it stop that one
            (`preventBaseUIHandler`), which is the only way to see the
            press and still leave the menu shut. */}
        <ContextMenuTrigger
          render={children}
          onContextMenu={(event) => {
            if (beforeOpen && !beforeOpen(event)) event.preventBaseUIHandler();
          }}
        />
        <ContextMenuContent className="w-56">
          <ContextMenuGroup>
            <ContextMenuLabel>{t(title)}</ContextMenuLabel>
            {actions.map((action) => (
              <MenuRow key={action.label} action={action} kind="context" />
            ))}
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <>
      <RenderChild
        onContextMenu={(e: React.MouseEvent) => {
          if (beforeOpen && !beforeOpen(e)) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </RenderChild>
      {open && <ActionSheetBody title={title} actions={actions} onClose={() => setOpen(false)} />}
    </>
  );
}

function MenuRow({ action, kind }: { action: MenuAction; kind: 'dropdown' | 'context' }) {
  const { label, icon: Icon, danger, disabled, className, onSelect } = action;
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem;
  return (
    <Item
      variant={danger ? 'destructive' : 'default'}
      disabled={disabled}
      className={className}
      onClick={() => onSelect()}
    >
      <Icon />
      {t(label)}
    </Item>
  );
}

/**
 * The phone's half: the verbs as full-width rows in a bottom sheet, titled
 * with what they are about. The sheet brings the scrim, the drag, Back and
 * the focus; this is only the list.
 */
function ActionSheetBody({
  title,
  actions,
  detail,
  onClose,
}: {
  title: string;
  actions: MenuAction[];
  detail?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="sm" title={title} className="gap-0">
        {/* pt-3.5 gives back what the title strip's -mb-3.5 takes: that
            reach-through is written against the card's default gap-4, and
            this sheet sets gap-0, so an unpadded first child is pulled
            14px up UNDER the opaque sticky strip — seen on the studies
            shelf, where the collection note's first line rose clipped
            flush at the strip's edge. The rows below survive the same
            pull only because their py-3 absorbs it. */}
        {detail && <div className="pt-3.5">{detail}</div>}
        {/* -mx-2: a row's icon starts where the title does, the way a
            dropdown's label text sits over its items' icons. With the
            rows inside the sheet's padding, the title, the icons and the
            labels made three left edges (16, 28, 56) and a lit row looked
            shifted against its own heading. mt-2: the lit row's pill used
            to touch the title.

            pt-3.5 where there is no detail line: the strip's reach-through
            is taken out of whichever child comes first, and with no detail
            that is this list — mt-2 gave back 8 of the 14, so the first
            row sat 6px under the opaque strip with its top clipped. The
            padding pays the 14 back inside the list, leaving mt-2 to be
            the gap it says it is. */}
        <div className={cn('-mx-2 mt-2 flex flex-col', !detail && 'pt-3.5')}>
          {actions.map(({ label, icon: Icon, danger, disabled, className, onSelect }) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => {
                onClose();
                onSelect();
              }}
              className={cn(
                // A sheet row is a touch target: a whole row to be tapped in.
                'flex items-center gap-3 rounded-lg px-2 py-3 text-left text-base transition-colors duration-100',
                danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent',
                // The registry's own two, so a dimmed sheet row and a
                // dimmed dropdown row are dimmed the same amount.
                'disabled:pointer-events-none disabled:opacity-50',
                className,
              )}
            >
              <Icon className={cn('size-4 shrink-0', !danger && 'text-muted-foreground')} />
              {t(label)}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
