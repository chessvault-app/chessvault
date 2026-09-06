import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import { ChevronLeft, XIcon, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { CoverParent } from '@/hooks/cover-parent';
import { registerOpenDialog, soleTextField } from '@/hooks/dialog-focus';
import { useSheetCover } from '@/hooks/use-sheet-cover';

export { CoverParent };

/**
 * shadcn's Dialog (nova), owned — the registry's face, and underneath it
 * TWO of Base UI's primitives wearing one API: the Dialog on a desktop
 * (the centred card), the Drawer on a phone (the bottom sheet). Both
 * bring the focus trap, scroll lock, Escape and outside-press dismissal,
 * layer stacking and aria wiring; the Drawer also brings the sheet's
 * swipe physics — drag-to-dismiss from anywhere on the sheet, with the
 * drag belonging to a scroller until that scroller is at its top — which
 * used to be this app's own 235 lines (use-sheet-drag, retired).
 *
 * What this file still adds is the app's window physics, each learned on
 * a device:
 *
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
 *     platform has it (the app's own watcher, plus the Drawer's Android
 *     one — whichever the platform's watcher stack answers, the guard
 *     routes it through the one door); Escape still goes through the
 *     primitive where it has not.
 *   - A touch on a text field is a caret and a touch on a canvas is that
 *     canvas's own business — neither may become a drag (the guard on the
 *     sheet below; the Drawer's engine only excuses buttons and links).
 *   - Open and close are not transitioned on a phone: animating against
 *     iOS's own keyboard animation is what made earlier attempts jump
 *     about. Only the swipe's snap-back animates (180ms), matching the
 *     retired hook's release.
 *
 * The desktop keeps one structural departure from the stock file: the
 * Popup renders INSIDE the Backdrop, which is the layout box. On a phone
 * the Drawer's Viewport plays that role — scrim, layout and the keyboard
 * band in one element.
 *
 * Dismissal is routed through the Root's onOpenChange, Base UI's way: the
 * eventDetails name the reason and cancel() tells Base to stand down, so
 * Escape, Android's Back and the scrim press can be rerouted (to "back",
 * to CloseWatcher, past another layer) without ever losing the
 * primitive's own close paths. DialogContent registers its routing in
 * DialogGuardContext below.
 */

/** The phone breakpoint every window turns into a sheet under. */
const PHONE = '(max-width: 39.9375rem)';

/** Which primitive this Root is: true = the Drawer (a phone sheet). */
const SheetContext = React.createContext(false);

/** How a DialogContent closes itself; the wrapper hands onOpenChange down. */
const DialogCloseContext = React.createContext<() => void>(() => {});

/** DialogContent's dismissal routing, consulted by the Root's onOpenChange. */
interface DialogGuards {
  /** A close request from the platform (Escape, Android's Back): route it
      through the window's one door. `escape` stands down where a
      CloseWatcher will answer the same press; `closeRequest` IS that
      answer. */
  escape: () => void;
  closeRequest: () => void;
  /** A press outside the card: true when it landed on another layer — or on
      a parked window's business — and must not close THIS one. */
  ignoreOutside: (target: EventTarget | null) => boolean;
  /** A scrim press that will close: its synthesized click must not land on
      whatever was under the scrim once it is gone. */
  outsideWillClose: () => void;
}
const DialogGuardContext = React.createContext<React.RefObject<DialogGuards | null> | null>(null);

// `handle` and `render` are omitted where the two primitives brand them
// differently; nothing in the app uses either.
export interface DialogProps extends Omit<DialogPrimitive.Root.Props, 'onOpenChange' | 'handle'> {
  /** Kept to Radix's one-argument shape: every caller in the app reads only the boolean. */
  onOpenChange?: (open: boolean) => void;
}

function Dialog({ onOpenChange, ...props }: DialogProps) {
  const phone = useMediaQuery(PHONE);
  const guards = React.useRef<DialogGuards | null>(null);
  const close = React.useCallback(() => onOpenChange?.(false), [onOpenChange]);
  const handleOpenChange = (
    open: boolean,
    details: DialogPrimitive.Root.ChangeEventDetails | DrawerPrimitive.Root.ChangeEventDetails,
  ): void => {
    if (!open && guards.current) {
      // Escape: cancel keeps Base from closing AND from preventDefaulting
      // the keydown, so where CloseWatcher exists it still hears the same
      // press — the one door (see useCloseWatcher). Everywhere else the
      // guard walks through that door itself.
      if (details.reason === 'escape-key') {
        details.cancel();
        guards.current.escape();
        return;
      }
      // The Drawer's own Android CloseWatcher (the platform hands Back to
      // its newest watcher, which is this one where it exists): same door.
      if (details.reason === 'close-watcher') {
        details.cancel();
        guards.current.closeRequest();
        return;
      }
      if (details.reason === 'outside-press') {
        if (guards.current.ignoreOutside(details.event.target)) {
          details.cancel();
          return;
        }
        guards.current.outsideWillClose();
      }
      // 'swipe' — the sheet pushed away — falls through: a drag past the
      // threshold closes the window outright, as the retired hook did.
    }
    onOpenChange?.(open);
  };
  const Root = phone ? DrawerPrimitive.Root : DialogPrimitive.Root;
  return (
    <SheetContext.Provider value={phone}>
      <DialogCloseContext.Provider value={close}>
        <DialogGuardContext.Provider value={guards}>
          <Root onOpenChange={handleOpenChange} {...props} />
        </DialogGuardContext.Provider>
      </DialogCloseContext.Provider>
    </SheetContext.Provider>
  );
}

function DialogTrigger({ ...props }: Omit<DialogPrimitive.Trigger.Props, 'handle'>) {
  const Trigger: React.FC<Omit<DialogPrimitive.Trigger.Props, 'handle'>> = React.useContext(SheetContext)
    ? (DrawerPrimitive.Trigger as React.FC<Omit<DialogPrimitive.Trigger.Props, 'handle'>>)
    : DialogPrimitive.Trigger;
  return <Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  const Portal = React.useContext(SheetContext) ? DrawerPrimitive.Portal : DialogPrimitive.Portal;
  return <Portal {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  const Close = React.useContext(SheetContext) ? DrawerPrimitive.Close : DialogPrimitive.Close;
  return <Close data-slot="dialog-close" {...props} />;
}

/**
 * The scrim — the registry's — and, on a desktop, the layout box (see the
 * note at the top). The phone branch styles the Drawer's Viewport with
 * the same classes instead; this element is the Dialog's.
 */
function DialogOverlay({ className, onClick, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      // Base UI does not render a NESTED dialog's backdrop by default —
      // and in this file the Backdrop is the layout box the Popup lives
      // inside (the structural departure noted at the top), so without
      // this a window opened from inside another window rendered
      // nothing at all: the parent parked itself for a page that never
      // appeared, which read as the whole dialog just closing. Each
      // window owning its overlay is also what the outside-press guard
      // assumes (ignoreOutside compares overlay ancestry).
      forceRender
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

/**
 * Close on the platform's close request — Android's Back gesture, and in an
 * installed PWA that gesture is the only chrome an Android phone has.
 * CloseWatcher also answers Escape, so where it exists Base UI's own Escape
 * handling stands down (see the guard in Dialog) and this is the one door.
 * On a phone the Drawer arms its own watcher too (Android only); the
 * platform answers Back with whichever watcher is newest, and both roads
 * lead to the same `request` through the guard.
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

/**
 * The touches the sheet must never turn into a drag, taken verbatim from
 * the retired use-sheet-drag: a finger on a text field is a caret (the
 * sheet must not move because somebody reached for the thing they came to
 * type in — and focusing it opens the keyboard, whose viewport shift
 * arrives as a long downward drag); a canvas draws its own handles and
 * reads its own pointers, and the picture window's corner handles are
 * dragged DOWNWARDS as often as any other way. The Drawer's own engine
 * excuses only buttons and links.
 */
const NOT_A_DRAG = 'input, textarea, select, [contenteditable="true"], canvas';

/**
 * The two things a window may claim only while it is actually OPEN: the
 * count `dialogOpen()` answers from, and the CloseWatcher that makes
 * Android's Back close it.
 *
 * Mounted from INSIDE the portal, which the primitive renders nothing of
 * while the root is closed — and that is the whole point. DialogContent
 * itself is mounted by its CALLER, open or not: Base UI's Root renders
 * its children either way, and only the portal is gated on `open`. So an
 * effect written in DialogContent's body runs for a window nobody has
 * opened, and a caller that renders `<Dialog open={x}><DialogContent/>`
 * unconditionally — a perfectly ordinary shape, and the one the notes
 * header's aliases and linked mentions both use — took the lock the
 * moment it drew and held it for as long as it was on screen. Every
 * other caller happens to guard with `{open && …}`, which is why this
 * stood for as long as it did.
 *
 * What it cost: `dialogOpen()` answered yes on a page with no window on
 * it, so the board's arrow keys (AnalysisBoard asks it before stepping
 * the game) were dead on every study and game page — lanph3re's report.
 * The CloseWatcher was the same mistake wearing different clothes: a
 * window that was not open claimed Escape and the platform's Back.
 *
 * `shut` still has to be read here, not just relied on: a window mounted
 * `hidden`, or parked under a page it opened, IS inside the portal.
 */
function DialogOpenEffects({ shut, request }: { shut: boolean; request: () => void }) {
  useCloseWatcher(request, !shut);
  // The board's arrow keys listen on the window and must not step the game
  // behind an open window's scrim; this is how they ask (dialogOpen()).
  React.useEffect(() => {
    if (shut) return;
    return registerOpenDialog();
  }, [shut]);
  return null;
}

export interface DialogContentProps extends Omit<DialogPrimitive.Popup.Props, 'render'> {
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
   * The id the title row's heading carries. For the window whose only
   * field is named by its title (a rename, a "name this" prompt): the
   * caller makes one with useId, passes it here and points the field's
   * aria-labelledby at it, so the field has a name the title row already
   * shows and nothing is drawn twice. Base UI takes the id as given.
   */
  titleId?: string;
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
  titleId,
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
  const phone = React.useContext(SheetContext);
  const small = size === 'sm';

  // The second-page bookkeeping. `covered` counts child windows currently
  // over this one; `cover` is what those children call, handed down by
  // context. `height` is this card, read live.
  const [covered, setCovered] = React.useState(0);
  const card = React.useRef<HTMLElement | null>(null);
  const coverParent = React.useContext(CoverParent);

  // The X's verb: shut this window, then every window it was opened
  // inside (see CoverParent.dismissAll). Read through refs so the handle
  // below keeps ONE identity for the life of the window — `close` is
  // rebuilt from the call site's inline onOpenChange on every render, and
  // a handle that changed with it would re-run every child's cover effect
  // and rebuild its ResizeObserver each render.
  const closeRef = React.useRef(close);
  closeRef.current = close;
  const parentRef = React.useRef(coverParent);
  parentRef.current = coverParent;
  const dismissAll = React.useCallback(() => {
    closeRef.current();
    parentRef.current?.dismissAll();
  }, []);

  const asParent = React.useMemo(
    () => ({
      cover: () => {
        setCovered((c) => c + 1);
        return () => setCovered((c) => c - 1);
      },
      height: () => card.current?.offsetHeight ?? 0,
      dismissAll,
    }),
    [dismissAll],
  );

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
  // Coming back from a page: the overlay flips from visibility:hidden to
  // visible, and WebKit repaints the card from a stale layout (an iPad
  // showed the Position card cut off ~16px short, its bottom padding and
  // corners missing, until any field inside it changed). One forced
  // layout of the card as it comes back is what that tap was doing.
  const wasCovered = React.useRef(false);
  React.useLayoutEffect(() => {
    if (covered > 0) {
      wasCovered.current = true;
      return;
    }
    if (!wasCovered.current) return;
    wasCovered.current = false;
    const el = card.current;
    if (!el) return;
    const prior = el.style.display;
    el.style.display = 'none';
    void el.offsetHeight;
    el.style.display = prior;
  }, [covered]);
  // A nested page that names no destination goes back to the window it
  // covered — closing a page IS going back.
  const back = onBack ?? (!small && coverParent ? close : undefined);
  // What Escape and Android's Back mean here: for a small window on its
  // second page, "back to the first"; for everything else, close.
  const request = small ? (onBack ?? close) : close;

  // The dismissal routing the Root's onOpenChange consults (see the top).
  React.useEffect(() => {
    if (!guards) return;
    guards.current = {
      // A shut window ignores Escape outright; CloseWatcher, where it
      // exists, hears the same un-defaulted keydown and answers instead.
      escape: () => {
        if (!shut && !window.CloseWatcher) request();
      },
      // The Drawer's Android watcher already IS the platform's answer.
      closeRequest: () => {
        if (!shut) request();
      },
      // Base's outside-press listener is document-wide, so a press on a
      // LATER layer — a menu, a picker window over this one, that window's
      // own scrim — is "outside" this card too. Only a press on this
      // window's OWN scrim may close it; anything on another overlay or
      // floating layer is that layer's business. (On a phone the Drawer's
      // Viewport carries the overlay slot and contains the card, so the
      // same closest() answers for both shapes.)
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
    if (node && node !== armed.current) {
      armed.current = node;
      if (!node.contains(document.activeElement)) soleTextField(node)?.focus();
    }
  };

  // Take focus only if nothing inside already has it; otherwise the
  // sole field, else the window itself — a container, which never
  // pops a phone keyboard.
  const initialFocus = (): HTMLElement | false => {
    const node = card.current;
    if (!node || node.contains(document.activeElement)) return false;
    return soleTextField(node) ?? node;
  };
  // Hand focus back to the opener (see `opener`) — unless something
  // moved it deliberately, in which case that choice stands.
  const finalFocus = (): HTMLElement | false => {
    const active = document.activeElement;
    const backTo = opener.current;
    if (backTo && backTo.isConnected && (active === null || active === document.body)) {
      return backTo;
    }
    return false;
  };

  const inner = (
    <>
      {title === undefined && phone && (
        // No title row, but still a sheet on a phone: the grabber — a SIGN
        // that the sheet can be pushed away (the Drawer answers a drag
        // from anywhere on it), kept as markup so composed-by-hand windows
        // (AlertDialog) put their own header under it.
        //
        // pb-3.5 -mb-3.5: the strip's background reaches through the
        // card's gap-4 below it, so content scrolling under stops being
        // visible near its own resting edge — with pb-0 it slid through
        // the transparent gap and was clipped flush against the strip.
        // 14px, not the full 16: a Card's hairline is a ring drawn 1px
        // OUTSIDE its box, and a strip reaching the card's very edge
        // paints over it.
        <div className="bg-popover sticky top-0 z-10 -mx-4 -mb-3.5 px-4 pt-3 pb-3.5 max-sm:touch-none max-sm:select-none">
          <div className="bg-border mx-auto h-1 w-9 cursor-grab rounded-full" aria-hidden />
        </div>
      )}
      {title !== undefined && (
        // The title row. Pinned to the top of the card, which scrolls:
        // a ten-row list is taller than the sheet holding it, and a way
        // back you have to scroll up to find is not one.
        //
        // pb-3.5 -mb-3.5: same reach-through as the grabber strip above —
        // scrolled content used to stay visible in the transparent gap-4
        // and get clipped flush against the title's baseline, which read
        // as the title stamped over the content. 14px, not the full 16,
        // so a first-child Card's outside ring stays visible.
        <div className="bg-popover sticky top-0 z-10 -mx-4 -mb-3.5 px-4 pt-4 pb-3.5 max-sm:touch-none max-sm:select-none">
          {/* The grabber, phones only. */}
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
            {/* py-1 -my-1: truncate's overflow-hidden clips at the PADDING
                edge, and DialogTitle's leading-none makes the line box
                exactly one em — so a descender ('g' in "Opening") was
                sheared flat on every titled window. The padding gives the
                glyphs room inside the clip box; the negative margin gives
                the row its height back, so nothing else moves. */}
            <DialogTitle id={titleId} className="-my-1 min-w-0 flex-1 truncate py-1">
              {t(title)}
            </DialogTitle>
            {actions}
            {/* A way out for the mouse, and only for the mouse: a phone
                has three already — drag the sheet down, tap the scrim,
                press Back.

                Out, not back: it shuts this window and every window this
                one was opened inside, so it means the same thing on page
                three of a chain as it does on page one. It was the
                primitive's own Close, which shuts one Root — and one Root
                is one PAGE here, so on a nested page the X uncovered the
                parent and read as a second chevron. The chevron beside it
                is the control that steps back; this one leaves. */}
            <Button
              data-slot="dialog-close"
              variant="ghost"
              size="icon-sm"
              title={t('Close')}
              aria-label={t('Close')}
              className="-my-1 -mr-1.5 hidden shrink-0 sm:inline-flex"
              onClick={dismissAll}
            >
              <XIcon />
            </Button>
          </div>
        </div>
      )}
      <CoverParent.Provider value={asParent}>{children}</CoverParent.Provider>
    </>
  );

  // The registry's card. overscroll-contain: a scroll this window cannot
  // use is its own business. [&>*]:shrink-0: children keep their size and
  // the WINDOW scrolls (which is also what hands the Drawer its swipe
  // arbitration: the drag is the sheet's only once this scroller is at
  // its top).
  const cardClass = cn(
    'bg-popover text-popover-foreground ring-border flex w-full flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4 text-sm ring-1 outline-none [&>*]:shrink-0',
    title !== undefined ? 'pt-0' : 'pt-4 max-sm:pt-0',
    className,
  );
  const cardStyle: React.CSSProperties = {
    ...style,
    // The parent's height as a VARIABLE, read into the min() below,
    // so the parent's number and the band's own are both ceilings.
    ...(phone && small && cap ? ({ '--sheet-cap': `${cap}px` } as React.CSSProperties) : undefined),
    // The page floor, phones only, capped by the same 88% the
    // max-height uses.
    ...(phone && !small && pageMinH ? { minHeight: `min(${pageMinH}px, 88%)` } : undefined),
  };

  if (phone) {
    return (
      <DialogPortal>
        <DialogOpenEffects shut={shut} request={request} />
        {/* display:contents, events only: React bubbles through portals,
            and a press inside this layer must not reach what the layer was
            written inside — a card or a row that opens on click would open
            under a sheet's button. The stop lives HERE, past the Viewport,
            because the Viewport's own pointerdown is where the Drawer's
            swipe begins. */}
        <div
          className="contents"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* The Viewport is the old overlay in one element: the scrim,
              the layout box that packs the sheet to the bottom edge, and
              the band the keyboard pins (`vv-band`). It carries the
              overlay slot so the outside-press guard reads the same
              closest() on both shapes. */}
          <DrawerPrimitive.Viewport
            data-slot="dialog-overlay"
            className={cn(
              'vv-band fixed inset-0 isolate z-50 flex items-end justify-center bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
              // Parked under a page: out of sight, but still laid out, so
              // the page over it can read the height it is matching.
              covered > 0 && 'invisible',
            )}
            // Inline, because `hidden` has to beat `flex` whatever order
            // the stylesheet emitted them in.
            style={hidden ? { display: 'none' } : undefined}
          >
            <DrawerPrimitive.Popup
              data-slot="dialog-content"
              data-size={size}
              // Only when it is one: an explicit `role={undefined}` would
              // override the `dialog` the primitive sets, not leave it alone.
              {...(alert ? { role: 'alertdialog' } : {})}
              ref={setNode}
              onClick={onClick}
              // A touch that must stay a caret or a canvas's own gesture is
              // stopped before the Viewport can begin a swipe with it.
              onPointerDown={(e) => {
                onPointerDown?.(e);
                if ((e.target as Element | null)?.closest?.(NOT_A_DRAG)) e.stopPropagation();
              }}
              initialFocus={initialFocus}
              finalFocus={finalFocus}
              style={cardStyle}
              className={cn(
                cardClass,
                // A BOTTOM SHEET, rising from the thumb's own edge,
                // stopping short of the top.
                //
                // The floor under the last row is 3.25rem plus the safe
                // area, not the 1.25rem it used to be: a sheet that ends
                // in the controls being aimed at left the last one flush
                // in the home-gesture band at the screen's very edge —
                // first patched as a hand spacer in the opening map's
                // coverage sheet, then promoted here so every sheet rests
                // the same way (lanph3re's call). A sheet that ends in a
                // FOOTER keeps the old floor: the muted band is already
                // the finish, and its reclaim margins (DialogFooter,
                // AlertDialogFooter, and any sticky bar marked
                // sheet-footer) are written against that number.
                'rounded-t-lg pb-[calc(3.25rem+var(--safe-b))]',
                'has-data-[slot=dialog-footer]:pb-[calc(1.25rem+var(--safe-b))]',
                'has-data-[slot=alert-dialog-footer]:pb-[calc(1.25rem+var(--safe-b))]',
                'has-data-[slot=sheet-footer]:pb-[calc(1.25rem+var(--safe-b))]',
                small
                  ? cn(
                      // The lower of two ceilings: the sheet this one was
                      // opened over, and the room the screen has for one;
                      // `fill` makes that ceiling the floor as well.
                      'max-h-[min(var(--sheet-cap,100%),var(--sheet-band))]',
                      fill && 'min-h-[min(var(--sheet-cap,100%),var(--sheet-band))]',
                    )
                  : // 88% of THIS LAYER, not 88dvh: while a keyboard is up
                    // the layer IS the band above it.
                    (fill ? 'h-[var(--sheet-band)]' : 'max-h-[88%]'),
                // The Drawer's swipe, consumed: the engine publishes the
                // drag as a CSS variable and the release as data states.
                // Open and close do not animate (see the note at the top);
                // the snap-back keeps the retired hook's 180ms.
                'transform-[translate3d(0,var(--drawer-swipe-movement-y,0px),0)] transition-transform duration-[180ms] ease-in-out will-change-transform',
                'data-swiping:duration-0 data-swiping:select-none data-starting-style:duration-0 data-ending-style:duration-0',
              )}
              {...props}
            >
              {inner}
            </DrawerPrimitive.Popup>
          </DrawerPrimitive.Viewport>
        </div>
      </DialogPortal>
    );
  }

  return (
    <DialogPortal>
      <DialogOpenEffects shut={shut} request={request} />
      <DialogOverlay
        // `optical-center`, not `items-center`: the card sits a little
        // above the geometric middle (see the utility in index.css) — the
        // classic dialog placement, and the same rule the board pages and
        // the empty states follow. `grid` is passed alongside so the merge
        // retires the overlay's own `flex`; its `justify-center` is a
        // no-op on the utility's single full-width column.
        className="grid optical-center p-4"
        style={hidden ? { display: 'none' } : covered > 0 ? { visibility: 'hidden' } : undefined}
      >
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          data-size={size}
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
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          style={cardStyle}
          className={cn(
            cardClass,
            'h-auto max-h-full rounded-xl',
            small ? 'max-w-sm' : size === 'full' ? 'max-w-4xl' : 'max-w-lg',
            // The desktop card arrives the stock way.
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100',
          )}
          {...props}
        >
          {inner}
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
  // The footer's Cancel is the X in words, so it has to mean what the X
  // means — out of the whole chain, not back one page. Inside the card
  // this context is the window's OWN handle (DialogContent provides it to
  // its children), so `dismissAll` here already starts with this window.
  const chain = React.useContext(CoverParent);
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        // On a phone the card's own floor (the safe area) is below this
        // band; the band keeps its corners square there.
        //
        // The margin reclaims the sheet's whole footer floor
        // (1.25rem + the safe area); the padding puts back only
        // 0.5rem + the safe area, which is what every sticky
        // `sheet-footer` row rests on. Putting the full 1.25rem back left
        // this band 12px deeper under its buttons than every other sheet
        // footer in the app -- measured 20px + safe here against 8px +
        // safe there, which is the gap lanph3re spotted on a phone.
        'max-sm:-mb-[calc(1.25rem+var(--safe-b))] max-sm:rounded-b-none max-sm:pb-[calc(0.5rem+var(--safe-b))]',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <Button variant="outline" onClick={chain?.dismissAll}>
          {t('Close')}
        </Button>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  const Title = React.useContext(SheetContext) ? DrawerPrimitive.Title : DialogPrimitive.Title;
  return (
    <Title
      data-slot="dialog-title"
      className={cn('font-heading text-base leading-none font-medium', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  const Description = React.useContext(SheetContext)
    ? DrawerPrimitive.Description
    : DialogPrimitive.Description;
  return (
    <Description
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
