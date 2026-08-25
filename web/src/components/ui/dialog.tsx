import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { ChevronLeft, XIcon, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { CoverParent } from '@/hooks/cover-parent';
import { registerOpenDialog, soleTextField } from '@/hooks/dialog-focus';
import { useSheetCover } from '@/hooks/use-sheet-cover';
import { useSheetDrag } from '@/hooks/use-sheet-drag';

export { CoverParent };

/**
 * shadcn's Dialog (nova), owned — the registry's face, and underneath it
 * Base UI's focus trap, scroll lock, Escape and outside-press dismissal,
 * layer stacking and aria wiring. What this file adds is the app's window
 * physics, each learned on a device:
 *
 *   - EVERY window is a bottom sheet on a phone and the registry's centred
 *     card on a desktop; the sheet is pushed away by dragging it from
 *     anywhere on itself (use-sheet-drag).
 *   - A page and a layer (see CoverParent): a default-sized window opened
 *     from inside another parks it and grows the back chevron; a small one
 *     floats over it, capped to its height, and grows the chevron only
 *     once it has hidden the window completely (use-sheet-cover).
 *   - The keyboard: the layer is pinned to the visible band while one is
 *     up (`vv-band`, index.css), the sheet takes a share of THAT, and a
 *     window whose only input is a text field puts the caret in it as it
 *     opens — synchronously, in the ref, because iOS raises the keyboard
 *     only for a focus it can trace to the tap (soleTextField).
 *   - Android's Back gesture is a close request, via CloseWatcher where the
 *     platform has it; Escape still goes through Base UI where it has not.
 *   - Nothing is transitioned on a phone: animating against iOS's own
 *     keyboard animation is what made earlier attempts jump about.
 *
 * One structural departure from the stock file: DialogContent renders its
 * Popup INSIDE the Backdrop rather than beside it. The overlay is the
 * layout box — it centres the card, packs it to the bottom edge on a
 * phone, and is what the keyboard band pins.
 *
 * Dismissal is routed through the Root's onOpenChange, Base UI's way: the
 * eventDetails name the reason and cancel() tells Base to stand down, so
 * Escape and the scrim press can be rerouted (to "back", to CloseWatcher,
 * past another layer) without ever losing the primitive's own close paths.
 * DialogContent registers its routing in DialogGuardContext below.
 */

/** How a DialogContent closes itself; the wrapper hands onOpenChange down. */
const DialogCloseContext = React.createContext<() => void>(() => {});

/** DialogContent's dismissal routing, consulted by the Root's onOpenChange. */
interface DialogGuards {
  /** Escape pressed (Base stands down): route it through the window's one door. */
  escape: () => void;
  /** A press outside the card: true when it landed on another layer — or on
      a parked window's business — and must not close THIS one. */
  ignoreOutside: (target: EventTarget | null) => boolean;
  /** A scrim press that will close: its synthesized click must not land on
      whatever was under the scrim once it is gone. */
  outsideWillClose: () => void;
}
const DialogGuardContext = React.createContext<React.RefObject<DialogGuards | null> | null>(null);

export interface DialogProps extends Omit<DialogPrimitive.Root.Props, 'onOpenChange'> {
  /** Kept to Radix's one-argument shape: every caller in the app reads only the boolean. */
  onOpenChange?: (open: boolean) => void;
}

function Dialog({ onOpenChange, ...props }: DialogProps) {
  const guards = React.useRef<DialogGuards | null>(null);
  const close = React.useCallback(() => onOpenChange?.(false), [onOpenChange]);
  return (
    <DialogCloseContext.Provider value={close}>
      <DialogGuardContext.Provider value={guards}>
        <DialogPrimitive.Root
          onOpenChange={(open, details) => {
            if (!open && guards.current) {
              // Escape: cancel keeps Base from closing AND from
              // preventDefaulting the keydown, so where CloseWatcher exists
              // it still hears the same press — the one door (see
              // useCloseWatcher). Everywhere else the guard walks through
              // that door itself.
              if (details.reason === 'escape-key') {
                details.cancel();
                guards.current.escape();
                return;
              }
              if (details.reason === 'outside-press') {
                if (guards.current.ignoreOutside(details.event.target)) {
                  details.cancel();
                  return;
                }
                guards.current.outsideWillClose();
              }
            }
            onOpenChange?.(open);
          }}
          {...props}
        />
      </DialogGuardContext.Provider>
    </DialogCloseContext.Provider>
  );
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * The scrim — the registry's — and the layout box (see the note at the
 * top). `vv-band`: while the keyboard is up this is pinned to the band that
 * can be seen rather than to the layout viewport iOS has just shifted.
 */
function DialogOverlay({ className, onClick, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      // A press on the scrim closes the window (Base UI, from its document
      // listeners — which is why the pointerdown itself is NOT stopped
      // here: React would stop the native event at the portal's root and
      // Base would never hear it). The CLICK must go no further: React
      // bubbles through portals, and a window written inside a shelf card
      // would hand the click to the card, which opens — a rename dismissed
      // by a tap beside it opened the study it was renaming.
      onClick={(e) => {
        onClick?.(e);
        e.stopPropagation();
      }}
      className={cn(
        'vv-band fixed inset-0 isolate z-50 flex justify-center bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs',
        'sm:data-open:animate-in sm:data-open:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

/** The phone breakpoint every window turns into a sheet under. */
const PHONE = '(max-width: 39.9375rem)';

/**
 * Close on the platform's close request — Android's Back gesture, and in an
 * installed PWA that gesture is the only chrome an Android phone has.
 * CloseWatcher also answers Escape, so where it exists Base UI's own Escape
 * handling stands down (see the guard in Dialog) and this is the one door.
 */
function useCloseWatcher(onClose: () => void, active: boolean): void {
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    if (!active || !window.CloseWatcher) return;
    const watcher = new window.CloseWatcher();
    watcher.onclose = () => close.current();
    return () => watcher.destroy();
  }, [active]);
}

export interface DialogContentProps extends DialogPrimitive.Popup.Props {
  /**
   * The window's name, drawn in the title row every window shares — one
   * closing idiom per app, so no window has to be read before it can be
   * dismissed. Translated here. Omit it to compose DialogHeader and
   * DialogTitle by hand, the stock way.
   */
  title?: string;
  icon?: LucideIcon;
  /** One control on the title line — Paste, say. Never a close button. */
  actions?: React.ReactNode;
  /**
   * This window is showing a second PAGE of itself, and this goes back to
   * the first; or it came from another window, and this returns there.
   * Escape and Android's Back go back rather than out, for a small window.
   */
  onBack?: () => void;
  /** Out of sight, still mounted — for a window that has opened another as a sibling. */
  hidden?: boolean;
  /**
   * `sm` is the one-question window (a confirm, a rename, a picker);
   * `default` a window (a form, a list); `full` a wide one on a DESKTOP.
   * On a phone every one of them is the bottom sheet.
   */
  size?: 'sm' | 'default' | 'full';
  /** Open as tall as this window is allowed to be — phones only. */
  fill?: boolean;
  /** A question that must be answered before anything else: the alertdialog role. */
  alert?: boolean;
}

function DialogContent({
  className,
  children,
  title,
  icon: Icon,
  actions,
  onBack,
  hidden = false,
  size = 'default',
  fill = false,
  alert = false,
  onClick,
  onPointerDown,
  ref,
  style,
  ...props
}: DialogContentProps) {
  const close = React.useContext(DialogCloseContext);
  const guards = React.useContext(DialogGuardContext);
  const phone = useMediaQuery(PHONE);
  const small = size === 'sm';

  // The second-page bookkeeping. `covered` counts child windows currently
  // over this one; `cover` is what those children call, handed down by
  // context. `height` is this card, read live.
  const [covered, setCovered] = React.useState(0);
  const card = React.useRef<HTMLElement | null>(null);
  const asParent = React.useMemo(
    () => ({
      cover: () => {
        setCovered((c) => c + 1);
        return () => setCovered((c) => c - 1);
      },
      height: () => card.current?.offsetHeight ?? 0,
    }),
    [],
  );
  const coverParent = React.useContext(CoverParent);

  // A PAGE parks the window it came from and opens AS TALL AS it, on a
  // phone — a floor, not a size, measured once in the same effect.
  const [pageMinH, setPageMinH] = React.useState(0);
  React.useEffect(() => {
    if (small || hidden || !coverParent) return;
    setPageMinH(coverParent.height());
    return coverParent.cover();
  }, [small, hidden, coverParent]);

  // A LAYER never parks its parent; it is capped to it, and grows the
  // chevron once it has hidden it completely — see use-sheet-cover.
  const { cap, covered: coversParent, ref: coverRef } = useSheetCover(small && phone);

  const shut = hidden || covered > 0;
  // A nested page that names no destination goes back to the window it
  // covered — closing a page IS going back.
  const back = onBack ?? (!small && coverParent ? close : undefined);
  // What Escape and Android's Back mean here: for a small window on its
  // second page, "back to the first"; for everything else, close.
  const request = small ? (onBack ?? close) : close;
  useCloseWatcher(request, !shut);

  // The dismissal routing the Root's onOpenChange consults (see the top).
  React.useEffect(() => {
    if (!guards) return;
    guards.current = {
      // A shut window ignores Escape outright; CloseWatcher, where it
      // exists, hears the same un-defaulted keydown and answers instead.
      escape: () => {
        if (!shut && !window.CloseWatcher) request();
      },
      // Base's outside-press listener is document-wide, so a press on a
      // LATER layer — a menu, a picker window over this one, that window's
      // own scrim — is "outside" this card too. Only a press on this
      // window's OWN scrim may close it; anything on another overlay or
      // floating layer is that layer's business.
      ignoreOutside: (target) => {
        if (shut) return true;
        const node = target instanceof Element ? target : null;
        const layer = node?.closest(
          '[data-slot=dialog-overlay],[role=listbox],[role=menu],[role=tooltip],[role=dialog],[role=alertdialog]',
        );
        if (!layer) return false;
        return layer !== card.current?.closest('[data-slot=dialog-overlay]');
      },
      outsideWillClose: () => suppressNextClick(),
    };
    return () => {
      guards.current = null;
    };
  });

  // The board's arrow keys listen on the window and must not step the game
  // behind an open window's scrim; this is how they ask (dialogOpen()).
  React.useEffect(() => {
    if (shut) return;
    return registerOpenDialog();
  }, [shut]);

  const drag = useSheetDrag(close);

  // Whatever had the focus when this window opened — read on the FIRST
  // RENDER, before anything inside has mounted, and not left to the
  // primitive: it reads document.activeElement in its mount effect, by
  // which time a field's own autoFocus (or the ref below) has put the
  // caret inside the window — so it would remember the field and drop
  // focus on the body when the window closes.
  const opener = React.useRef<HTMLElement | null | undefined>(undefined);
  if (opener.current === undefined) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  // The sole-text-field focus happens HERE, in the ref callback, not in
  // the primitive's mount autofocus: a ref attaches synchronously inside
  // the tap that opened the dialog, and iOS only raises the keyboard for a
  // focus it can trace to a user gesture. Guarded per node.
  const armed = React.useRef<HTMLElement | null>(null);
  const setNode = (node: HTMLDivElement | null): void => {
    card.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
    coverRef(node);
    if (phone) drag.ref(node);
    if (node && node !== armed.current) {
      armed.current = node;
      if (!node.contains(document.activeElement)) soleTextField(node)?.focus();
    }
  };

  return (
    <DialogPortal>
      <DialogOverlay
        className={cn(
          'max-sm:items-end max-sm:p-0 sm:items-center sm:p-4',
          // Parked under a page: out of sight, but still laid out, so the
          // page over it can read the height it is matching.
          covered > 0 && 'invisible',
        )}
        // Inline, because `hidden` has to beat the phone's `flex` whatever
        // order the stylesheet emitted them in.
        style={hidden ? { display: 'none' } : undefined}
      >
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          data-size={size}
          // Only when it is one: an explicit `role={undefined}` would
          // override the `dialog` the primitive sets, not leave it alone.
          {...(alert ? { role: 'alertdialog' } : {})}
          ref={setNode}
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
          // Take focus only if nothing inside already has it; otherwise the
          // sole field, else the window itself — a container, which never
          // pops a phone keyboard.
          initialFocus={() => {
            const node = card.current;
            if (!node || node.contains(document.activeElement)) return false;
            return soleTextField(node) ?? node;
          }}
          // Hand focus back to the opener (see `opener`) — unless something
          // moved it deliberately, in which case that choice stands.
          finalFocus={() => {
            const active = document.activeElement;
            const backTo = opener.current;
            if (backTo && backTo.isConnected && (active === null || active === document.body)) {
              return backTo;
            }
            return false;
          }}
          style={{
            ...style,
            ...(phone ? drag.style : undefined),
            // The parent's height as a VARIABLE, read into the min() below,
            // so the parent's number and the band's own are both ceilings.
            ...(phone && small && cap ? ({ '--sheet-cap': `${cap}px` } as React.CSSProperties) : undefined),
            // The page floor, phones only, capped by the same 88% the
            // max-height uses.
            ...(phone && !small && pageMinH ? { minHeight: `min(${pageMinH}px, 88%)` } : undefined),
          }}
          className={cn(
            // The registry's card. overscroll-contain: a scroll this window
            // cannot use is its own business. [&>*]:shrink-0: children keep
            // their size and the WINDOW scrolls.
            'bg-popover text-popover-foreground ring-foreground/10 flex w-full flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4 text-sm ring-1 outline-none [&>*]:shrink-0',
            title !== undefined ? 'pt-0' : 'pt-4 max-sm:pt-0',
            // A BOTTOM SHEET on a phone, whatever the window is: rising from
            // the thumb's own edge, stopping short of the top, with the
            // same 1.25rem floor under its last row.
            'max-sm:rounded-t-lg max-sm:pb-[calc(1.25rem+var(--safe-b))]',
            small
              ? cn(
                  // The lower of two ceilings: the sheet this one was opened
                  // over, and the room the screen has for one; `fill` makes
                  // that ceiling the floor as well.
                  'max-h-full max-sm:max-h-[min(var(--sheet-cap,100%),var(--sheet-band))]',
                  fill && 'max-sm:min-h-[min(var(--sheet-cap,100%),var(--sheet-band))]',
                  'sm:max-w-sm sm:rounded-xl',
                )
              : cn(
                  // 88% of THIS LAYER, not 88dvh: while a keyboard is up the
                  // layer IS the band above it.
                  fill ? 'max-sm:h-[var(--sheet-band)]' : 'max-sm:max-h-[88%]',
                  'sm:h-auto sm:max-h-full sm:rounded-xl',
                  size === 'full' ? 'sm:max-w-4xl' : 'sm:max-w-lg',
                ),
            // The desktop card arrives the stock way; a phone sheet does not
            // animate at all (see the note at the top).
            'sm:data-open:animate-in sm:data-open:fade-in-0 sm:data-open:zoom-in-95 sm:duration-100',
            className,
          )}
          {...props}
        >
          {title === undefined && phone && (
            // No title row, but still a sheet on a phone: the grabber and
            // the drag handle it stands for. Composed-by-hand windows
            // (AlertDialog) put their own header under it.
            <div
              className="bg-popover sticky top-0 z-10 -mx-4 px-4 pt-3 pb-0 max-sm:touch-none max-sm:select-none"
              {...drag.handlers}
            >
              <div className="bg-border mx-auto h-1 w-9 cursor-grab rounded-full" aria-hidden />
            </div>
          )}
          {title !== undefined && (
            // The title row. Pinned to the top of the card, which scrolls:
            // a ten-row list is taller than the sheet holding it, and a way
            // back you have to scroll up to find is not one. On a phone the
            // grabber sits above the title, and the whole row is the
            // mouse's drag handle — a finger may start anywhere.
            <div
              className="bg-popover sticky top-0 z-10 -mx-4 px-4 pt-4 pb-0 max-sm:touch-none max-sm:select-none"
              {...(phone ? drag.handlers : {})}
            >
              {/* The grabber, phones only: a SIGN that the sheet can be
                  pushed away, not the only place that answers. */}
              <div className="bg-border mx-auto mb-3 h-1 w-9 cursor-grab rounded-full sm:hidden" aria-hidden />
              <div className="flex items-center gap-2">
                {/* The chevron: a page's way back, or a layer's once it has
                    hidden the window it was opened from. */}
                {(back || coversParent) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('Back')}
                    aria-label={t('Back')}
                    className="-my-1 -ml-1.5 shrink-0"
                    onClick={back ?? close}
                  >
                    <ChevronLeft />
                  </Button>
                )}
                {Icon && <Icon className="text-muted-foreground size-4 shrink-0" />}
                <DialogTitle className="min-w-0 flex-1 truncate">{t(title)}</DialogTitle>
                {actions}
                {/* A way out for the mouse, and only for the mouse: a phone
                    has three already — drag the sheet down, tap the scrim,
                    press Back. */}
                <DialogPrimitive.Close
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('Close')}
                      aria-label={t('Close')}
                      className="-my-1 -mr-1.5 hidden shrink-0 sm:inline-flex"
                    />
                  }
                >
                  <XIcon />
                </DialogPrimitive.Close>
              </div>
            </div>
          )}
          <CoverParent.Provider value={asParent}>{children}</CoverParent.Provider>
        </DialogPrimitive.Popup>
      </DialogOverlay>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />;
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        // On a phone the card's own floor (the safe area) is below this
        // band; the band keeps its corners square there.
        'max-sm:-mb-[calc(1.25rem+var(--safe-b))] max-sm:rounded-b-none max-sm:pb-[calc(1.25rem+var(--safe-b))]',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>{t('Close')}</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-base leading-none font-medium', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
