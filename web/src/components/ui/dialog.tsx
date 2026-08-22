import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ChevronLeft, X, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { CoverParent } from '@/ui/coverParent';
import { registerOpenDialog, soleTextField } from '@/ui/dialogFocus';
import { useSheetCover } from '@/ui/sheetCover';
import { useSheetDrag } from '@/ui/sheetDrag';

export { CoverParent };

/**
 * shadcn's Dialog, owned — and underneath it Radix's, which brings the
 * focus trap, the scroll lock, the Escape and outside-press dismissal, the
 * layer stacking (one Escape closes one dialog, topmost first) and the
 * aria wiring that every window in the app used to carry by hand.
 *
 * What this file adds is the app's window physics, which no registry file
 * has and which were each learned on a device:
 *
 *   - EVERY window is a bottom sheet on a phone and a centred card on a
 *     desktop. A window that had replaced the app — edge to edge, no sense
 *     of what it was over — was the shape that was tried first; a sheet
 *     rising from the thumb's own edge reads as a thing ON the page, and
 *     it is pushed away by dragging it from anywhere on itself (sheetDrag).
 *   - A page and a layer (see CoverParent): a default-sized window opened
 *     from inside another parks it and grows the back chevron; a small one
 *     floats over it, capped to its height, and grows the chevron only
 *     once it has hidden the window completely (sheetCover).
 *   - The keyboard: the layer is pinned to the visible band while one is
 *     up (`vv-band`, index.css), the sheet takes a share of THAT, and a
 *     window whose only input is a text field puts the caret in it as it
 *     opens — synchronously, in the ref, because iOS raises the keyboard
 *     only for a focus it can trace to the tap (soleTextField).
 *   - Android's Back gesture is a close request, via CloseWatcher where the
 *     platform has it; Escape still goes through Radix where it has not.
 *   - Nothing is transitioned on a phone: animating against iOS's own
 *     keyboard animation is what made earlier attempts jump about. The
 *     desktop card fades and scales in the stock way.
 *
 * The one structural departure from the stock file: DialogContent renders
 * its Content INSIDE the Overlay rather than beside it. The overlay is the
 * layout box — it centres the card on a desktop, packs it to the bottom
 * edge on a phone, and is what the keyboard band pins — and a card that
 * positioned itself `fixed` on its own would measure its percentages
 * against the viewport the keyboard has just covered.
 */

/**
 * How a DialogContent closes itself (the X, the drag, a page's back).
 * Radix keeps `onOpenChange` on the Root; the wrapper below hands it down.
 */
const DialogCloseContext = React.createContext<() => void>(() => {});

function Dialog({ onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const close = React.useCallback(() => onOpenChange?.(false), [onOpenChange]);
  return (
    <DialogCloseContext.Provider value={close}>
      <DialogPrimitive.Root data-slot="dialog" onOpenChange={onOpenChange} {...props} />
    </DialogCloseContext.Provider>
  );
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * The scrim, and the layout box (see the note at the top). `vv-band`: while
 * the keyboard is up this is pinned to the band that can be seen rather
 * than to the layout viewport, which is the thing iOS has just shifted.
 */
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('vv-band bg-scrim fixed inset-0 z-50 flex justify-center', className)}
      {...props}
    />
  );
}

/** The phone breakpoint every window turns into a sheet under. */
const PHONE = '(max-width: 39.9375rem)';

/**
 * Close on the platform's close request — Android's Back gesture, and in an
 * installed PWA that gesture is the only chrome an Android phone has.
 *
 * CloseWatcher is the purpose-built API: no history entries to push and
 * silently consume, the MOST RECENT watcher alone answers each request,
 * and Android's predictive-back animation rides it for free. It also
 * answers Escape, so where it exists Radix's own Escape handling is told
 * to stand down (see DialogContent) and this is the one door; where it is
 * missing — older WebKit — Radix answers Escape and iOS has no Back
 * gesture to lose.
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

export interface DialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /**
   * The window's name, drawn in the quiet title strip every window shares
   * — one closing idiom per app, so no window has to be read before it can
   * be dismissed. Translated here. Omit it to compose DialogHeader and
   * DialogTitle by hand, the stock way.
   */
  title?: string;
  icon?: LucideIcon;
  /** One control on the title line — Paste, say. Never a close button. */
  actions?: React.ReactNode;
  /**
   * This window is showing a second PAGE of itself, and this goes back to
   * the first; or it came from another window, and this returns there.
   * Escape and Android's Back go back rather than out, for a small window:
   * Back that skips a page is Back that loses your place.
   */
  onBack?: () => void;
  /**
   * Out of sight, still mounted — for a window that has opened another one
   * as a sibling rather than a child: unmounting it would take the state of
   * whatever it contains with it, including the very button that opened
   * the second window. Hidden, it is still there to come back to.
   */
  hidden?: boolean;
  /**
   * `sm` is the one-question window — a confirm, a rename, a picker — a
   * small centred card, and on a phone a sheet sized to its content and
   * capped to the window it was asked over. `default` is a window — a form,
   * a list — and `full` a wide one on a DESKTOP, for a task rather than a
   * question (browsing an archive); `full` says nothing on a phone, where
   * every window is the same shape.
   */
  size?: 'sm' | 'default' | 'full';
  /**
   * Open as tall as this window is allowed to be, instead of as tall as its
   * own content — phones only. For a window whose content is a workspace
   * or a list that filters: one height means the body scrolls and the
   * footer stays where it was, instead of the sheet snapping to a new
   * height on every keystroke. Not for the questions.
   */
  fill?: boolean;
  /**
   * A question that must be answered before anything else happens — a
   * confirmation. Changes the role only: AlertDialog is the spelling.
   */
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
  onEscapeKeyDown,
  onPointerDownOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ref,
  style,
  ...props
}: DialogContentProps) {
  const close = React.useContext(DialogCloseContext);
  const phone = useMediaQuery(PHONE);
  const small = size === 'sm';

  // The second-page bookkeeping. `covered` counts child windows currently
  // over this one; `cover` is what those children call, handed down by
  // context. Registering is an effect, so a child that unmounts — or is
  // itself hidden — always releases what it took. `height` is this card,
  // read live, because a card's height is its content's.
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
  // phone: the elite window is pinned at 88% and its database manager is
  // three rows, and a sheet that snaps between those heights reads as two
  // windows, not one window turning its page. Measured once, in the same
  // effect that parks the parent — the parent is still painted when the
  // effect runs. A floor, not a size, so a page taller than its window
  // still grows.
  const [pageMinH, setPageMinH] = React.useState(0);
  React.useEffect(() => {
    if (small || hidden || !coverParent) return;
    setPageMinH(coverParent.height());
    return coverParent.cover();
  }, [small, hidden, coverParent]);

  // A LAYER never parks its parent; it is capped to it, and grows the
  // chevron once it has hidden it completely — see sheetCover.
  const { cap, covered: coversParent, ref: coverRef } = useSheetCover(small && phone);

  // Out of sight for either reason: told to be, or covered by a page.
  const shut = hidden || covered > 0;
  // A nested page that names no destination goes back to the window it
  // covered — closing a page IS going back.
  const back = onBack ?? (!small && coverParent ? close : undefined);
  // What Escape and Android's Back mean here: for a small window on its
  // second page, "back to the first"; for everything else, close.
  const request = small ? (onBack ?? close) : close;
  useCloseWatcher(request, !shut);

  // The board's arrow keys listen on the window and must not step the game
  // behind an open window's scrim; this is how they ask (dialogOpen()).
  React.useEffect(() => {
    if (shut) return;
    return registerOpenDialog();
  }, [shut]);

  // Every window is a sheet on a phone, and none is on a desktop — a
  // centred card that slides away downwards is not answering any question
  // the pointer asked.
  const drag = useSheetDrag(close);

  // The sole-text-field focus happens HERE, in the ref callback, not in
  // Radix's mount autofocus: a ref attaches synchronously inside the tap
  // that opened the dialog, and iOS only raises the keyboard for a focus it
  // can trace to a user gesture — from an effect it focuses the field and
  // leaves the keyboard down. Guarded per node, because React re-runs ref
  // callbacks on every render; the caret is placed once per opening.
  const armed = React.useRef<HTMLElement | null>(null);
  // Whatever had the focus when this window opened — read on the FIRST
  // RENDER, before anything inside has mounted, and not left to Radix: its
  // FocusScope reads document.activeElement in its mount effect, by which
  // time a field's own autoFocus (or the ref below) has put the caret
  // inside the window — so it would remember the field, try to return
  // focus to a node that no longer exists when the window closes, and
  // drop it on the body instead.
  const opener = React.useRef<HTMLElement | null | undefined>(undefined);
  if (opener.current === undefined) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
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
          // Bottom edge on a phone; the middle of the band on a desktop,
          // with the window's own margin from the screen's edge.
          'max-sm:items-end max-sm:p-0 sm:items-center',
          small ? 'sm:p-3' : size === 'full' ? 'sm:p-6' : 'sm:p-4',
          // Parked under a page: out of sight, but still laid out, so the
          // page over it can read the height it is matching.
          covered > 0 && 'invisible',
        )}
        // Inline, because `hidden` has to beat the phone's `flex` whatever
        // order the stylesheet emitted them in.
        style={hidden ? { display: 'none' } : undefined}
      >
        <DialogPrimitive.Content
          data-slot="dialog-content"
          data-size={size}
          // Only when it is one: an explicit `role={undefined}` would
          // override the `dialog` Radix sets, not leave it alone.
          {...(alert ? { role: 'alertdialog' } : {})}
          // The title strip names the window (aria-labelledby, via
          // DialogTitle); there is no description, and saying so is what
          // keeps Radix from asking for one.
          aria-describedby={undefined}
          ref={setNode}
          // Escape: preventDefault keeps Radix from closing on its own,
          // and the request goes through the one door — CloseWatcher where
          // it exists (it hears Escape too), else straight from here.
          onEscapeKeyDown={(e) => {
            onEscapeKeyDown?.(e);
            if (e.defaultPrevented) return;
            e.preventDefault();
            if (!window.CloseWatcher) request();
          }}
          // A press on the scrim closes. The tap's synthesized click must
          // not land on whatever was under the scrim — a row, a tile — once
          // the scrim is gone. A layer that is not one of Radix's (a menu
          // or a listbox the app still portals itself) is INSIDE for this
          // purpose; Radix would read a press in it as a press outside.
          onPointerDownOutside={(e) => {
            onPointerDownOutside?.(e);
            if (e.defaultPrevented) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest?.('[role=listbox],[role=menu],[role=tooltip],[role=dialog],[role=alertdialog]')) {
              e.preventDefault();
              return;
            }
            suppressNextClick();
          }}
          // Take focus only if nothing inside already has it — the ref
          // above may have put the caret in the sole field. Otherwise the
          // field is asked for again (for a window mounted hidden, whose
          // fields appear only when it is shown), and failing that the
          // window itself takes the focus: a container, which never pops a
          // phone keyboard. Radix would have picked the first control,
          // which on a phone is a keyboard nobody asked for.
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus?.(e);
            if (e.defaultPrevented) return;
            e.preventDefault();
            const node = card.current;
            if (!node || node.contains(document.activeElement)) return;
            const field = soleTextField(node);
            if (field) field.focus();
            else node.focus({ preventScroll: true });
          }}
          // Hand focus back to the opener (see `opener`) — unless something
          // moved it deliberately (a verb in this window focused a field
          // behind it), in which case that choice stands. Always our own
          // restore rather than Radix's, whose idea of the opener is wrong
          // for the reason given above.
          onCloseAutoFocus={(e) => {
            onCloseAutoFocus?.(e);
            if (e.defaultPrevented) return;
            e.preventDefault();
            const active = document.activeElement;
            const back = opener.current;
            if (back && back.isConnected && (active === null || active === document.body)) {
              back.focus({ preventScroll: true });
            }
          }}
          style={{
            ...style,
            ...(phone ? drag.style : undefined),
            // The parent's height as a VARIABLE, read into the min() below,
            // so the parent's number and the band's own are both ceilings
            // and the smaller one wins — whichever the keyboard leaves.
            ...(phone && small && cap ? ({ '--sheet-cap': `${cap}px` } as React.CSSProperties) : undefined),
            // The page floor, phones only. min() with the same 88% the
            // max-height uses, so a floor measured with the keyboard down
            // cannot pin the sheet taller than the band the keyboard leaves.
            ...(phone && !small && pageMinH ? { minHeight: `min(${pageMinH}px, 88%)` } : undefined),
          }}
          className={cn(
            // overscroll-contain: a scroll this window cannot use is its own
            // business — without it, reaching the end of a list inside a
            // sheet hands the rest of the gesture to whatever is behind it.
            // [&>*]:shrink-0: children keep their size and the WINDOW
            // scrolls; a flex column would rather squash a form than
            // overflow, and that is what it did the moment the keyboard
            // shortened the sheet.
            'bg-popover text-popover-foreground border-border flex w-full flex-col overflow-y-auto overscroll-contain',
            'border px-3 pb-3 pt-0 shadow-pop outline-none [&>*]:shrink-0',
            small ? 'gap-2' : 'gap-3',
            // A BOTTOM SHEET on a phone, whatever the window is: rising from
            // the thumb's own edge, stopping short of the top. 1.25rem under
            // the last row so a short sheet does not end right at the home
            // indicator.
            'max-sm:rounded-t-2xl max-sm:pb-[calc(1.25rem+var(--safe-b))]',
            small
              ? // The lower of two ceilings: the sheet this one was opened
                // over, and the room the screen has for one (`--sheet-band`,
                // which knows about the notch and the keyboard). `fill`
                // makes that ceiling the floor as well.
                cn(
                  'max-h-full max-sm:max-h-[min(var(--sheet-cap,100%),var(--sheet-band))]',
                  fill && 'max-sm:min-h-[min(var(--sheet-cap,100%),var(--sheet-band))]',
                  'sm:max-w-sm sm:rounded-xl',
                )
              : // 88% of THIS LAYER, not 88dvh: dvh does not shrink for a
                // keyboard, and while one is up the layer IS the band above
                // it. `fill` is a height rather than a second max-height —
                // two max-h utilities on one element are settled by emit
                // order, not by the order written here.
                cn(
                  fill ? 'max-sm:h-[var(--sheet-band)]' : 'max-sm:max-h-[88%]',
                  'sm:h-auto sm:max-h-full sm:rounded-xl',
                  size === 'full' ? 'sm:max-w-4xl' : 'sm:max-w-[32rem]',
                ),
            // The desktop card arrives the stock way; a phone sheet does not
            // animate at all (see the note at the top).
            'sm:data-open:animate-in sm:data-open:fade-in-0 sm:data-open:zoom-in-95 sm:duration-100',
            className,
          )}
          {...props}
        >
          {title !== undefined && (
            // The title strip. Pinned to the top of the card, which scrolls:
            // a ten-row list is taller than the sheet holding it, and the
            // strip scrolling away took the label and the back chevron with
            // it — a way back you have to scroll up to find is not one. The
            // rule under it is the DESKTOP's, where every window and panel
            // draws one; a bottom sheet draws none. On a phone the grabber
            // sits above the title, and the whole strip is the mouse's drag
            // handle — a finger may start anywhere (sheetDrag).
            <div
              className="border-border bg-popover sticky top-0 z-10 -mx-3 px-3 pb-2 pt-3 max-sm:touch-none max-sm:select-none sm:border-b"
              {...(phone ? drag.handlers : {})}
            >
              {/* The grabber, phones only: a SIGN that the sheet can be
                  pushed away, not the only place that answers. */}
              <div className="bg-border mx-auto mb-2 h-1 w-9 cursor-grab rounded-full sm:hidden" aria-hidden />
              <div className="flex items-center gap-2">
                {/* The chevron: a page's way back, or a layer's once it has
                    hidden the window it was opened from. Standing over a
                    window you can still see, the scrim, the drag and Back
                    all say how to leave. */}
                {(back || coversParent) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('Back')}
                    aria-label={t('Back')}
                    className="-my-1 -ml-1 shrink-0"
                    onClick={back ?? close}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                )}
                {Icon && <Icon className="text-subtle size-3.5 shrink-0" />}
                <DialogPrimitive.Title
                  data-slot="dialog-title"
                  className="text-subtle min-w-0 flex-1 truncate text-sm font-normal"
                >
                  {t(title)}
                </DialogPrimitive.Title>
                {actions}
                {/* A way out for the mouse, and only for the mouse. A phone
                    has three already — drag the sheet down, tap the scrim,
                    press Back. A desktop window has the scrim and Escape,
                    and both are invisible: a window that is only a list of
                    settings had nothing on screen that said how to leave. */}
                <DialogPrimitive.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('Close')}
                    aria-label={t('Close')}
                    className="-my-1 -mr-1 hidden shrink-0 sm:inline-flex"
                  >
                    <X className="size-3.5" />
                  </Button>
                </DialogPrimitive.Close>
              </div>
            </div>
          )}
          <CoverParent.Provider value={asParent}>{children}</CoverParent.Provider>
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-none font-medium', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
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
