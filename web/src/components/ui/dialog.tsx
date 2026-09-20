import * as React from 'react';
import { createPortal } from 'react-dom';
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
 *     from inside another is drawn INSIDE that window's card, over its
 *     content, and grows the back chevron; the card, its scrim, its
 *     scroller and its swipe stay the window's, and the content under
 *     the page steps aside the way the page under a pushed route does
 *     (`stack`, below). A small one floats over it, capped to its
 *     height, and grows the chevron only once it has hidden the window
 *     completely (use-sheet-cover).
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
 *   - The sheet rises from the bottom edge on the app's spring and leaves
 *     faster on the same spring run backwards (`--pane-turn`,
 *     `--pane-turn-ease-out`); the scrim fades on the same clock, and the
 *     panel itself never fades (a bottom sheet is a slab, not a ghost).
 *     It used to snap into place, because an earlier slide jumped against
 *     iOS's own keyboard animation. The jump had one cause: the ONE sheet
 *     that raises the keyboard as it opens (soleTextField) has its height
 *     changed under it mid-slide, and a `100%` translate is measured from
 *     that height. For one release that sheet skipped the entrance
 *     altogether (`data-no-enter`, set in the same ref callback that
 *     focuses the field, before the first paint), which made it the one
 *     sheet that appeared rather than rose. It now rises from a length
 *     the keyboard cannot change, the viewport's own height: a slide
 *     measured in dvh starts fully off screen whatever the sheet's box
 *     does under it, so the jump has nothing to measure from. Not yet
 *     checked against a real iOS keyboard; if it jumps, the cause is not
 *     the one this fixed. The exit plays as it always did, since by then
 *     the keyboard is down or on its way.
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
/**
 * Whether the phone's sheet is resting BELOW its tallest snap point. A
 * lowered sheet is not a scroller: the Drawer hands an upward drag to a
 * scrollable target unless that target is already at its bottom, so a
 * half-height sheet whose content overflowed could be scrolled but never
 * pulled back up to full height (the opening map's move details). While
 * it rests low the card hides its overflow and every drag is the
 * sheet's; at the top it scrolls, and a drag down from the top of that
 * scroller is the sheet's again, which is the Drawer's own rule.
 */
const SheetLoweredContext = React.createContext(false);
/**
 * The Dialog's exit, seen from its card. `leaving` is the held close (see
 * the Dialog); `depart` holds ANY way out the same way, running what it
 * is given once the exit has played (a page's Back is one: the caller's
 * own state change, which would otherwise unmount the page mid-turn);
 * `finish` is what the card calls once its exit has played, for a card
 * that plays it itself: a PAGE, which has no primitive Popup to report
 * the end of an ending style. `pageMode` is how the card tells the
 * Dialog that it is one, so the close is held for it on a desktop too.
 */
const DialogLeaveContext = React.createContext<{
  leaving: boolean;
  depart: (then: () => void) => void;
  finish: () => void;
  /** The card says whether it is a page; a setter, for the same reason as the guards. */
  setPageMode: (page: boolean) => void;
} | null>(null);

/**
 * Leave, then do it: for a window's own answer (a prompt's Done, a folder
 * picked), called from inside the card.
 *
 * The Dialog holds its exit for every close request that comes through
 * IT (the scrim, a drag, Back), but an answer went to the caller, whose
 * state change unmounted the window in the same commit, so the sheet
 * that slid away when dismissed was cut when it was answered: measured
 * on the demo at 375px, gone 40 to 48ms after the press with no frame of
 * travel, against 200ms and twelve positions for the scrim. On a desktop
 * `depart` runs what it is given at once, as it always did; on a phone
 * the answer runs once the sheet has left.
 */
export function useDialogDepart(): (then: () => void) => void {
  const leave = React.use(DialogLeaveContext);
  return leave ? leave.depart : (then) => then();
}

/** Whether the reader has asked for less motion, read when it matters. */
const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A window standing in for another (WindowOpening, for a lazy window's
 * chunk) says so as it unmounts, and the window mounted in that same
 * commit skips its entrance: it IS the window already on screen. Without
 * this the two were separate mounts, each with the mount animation, and
 * on a cold cache a phone's sheet rose twice (lanph3re's report).
 *
 * The stand-in's layout cleanup runs in the commit's mutation phase and
 * the new card's ref attaches in its layout phase, so the flag is read in
 * the commit that set it. The timeout only clears one nobody read.
 */
let handedOver = false;
export function handOverWindow(): void {
  handedOver = true;
  window.setTimeout(() => {
    handedOver = false;
  }, 0);
}

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
// A setter rather than the ref itself: the card fills it from an effect,
// and the React Compiler refuses a write to anything a context handed
// over, ref or not. Calling a function it handed over is fine.
const DialogGuardContext = React.createContext<((guards: DialogGuards | null) => void) | null>(null);

// `handle` and `render` are omitted where the two primitives brand them
// differently; nothing in the app uses either.
interface DialogProps extends Omit<DialogPrimitive.Root.Props, 'onOpenChange' | 'handle'> {
  /** Kept to Radix's one-argument shape: every caller in the app reads only the boolean. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Where the phone's sheet may rest short of its full height: fractions
   * of the viewport (`0.5`), pixels, or `rem` strings, low to high, with
   * `1` the sheet's own full height. A drag stops at the nearest one
   * instead of closing, so a sheet over a canvas can be pulled down to
   * half and leave the canvas in view. Ignored on a desktop, where the
   * window is a centred card with no height to rest at.
   */
  snapPoints?: DrawerPrimitive.Root.Props['snapPoints'];
  /** Which of `snapPoints` the sheet opens at; the first when omitted. */
  defaultSnapPoint?: DrawerPrimitive.Root.Props['defaultSnapPoint'];
}

function Dialog({
  onOpenChange,
  open,
  onOpenChangeComplete,
  snapPoints,
  defaultSnapPoint,
  ...props
}: DialogProps) {
  const phone = useMediaQuery(PHONE);
  const guards = React.useRef<DialogGuards | null>(null);
  // The snap point, held here so the card can tell whether it rests low
  // (SheetLoweredContext). Reset each time the sheet opens, as the
  // primitive's own default would be.
  const [snapPoint, setSnapPoint] = React.useState(defaultSnapPoint ?? snapPoints?.[0] ?? null);
  // Keyed on the opening alone; the points are read fresh through the event.
  const resetSnapPoint = React.useEffectEvent(() => {
    setSnapPoint(defaultSnapPoint ?? snapPoints?.[0] ?? null);
  });
  React.useEffect(() => {
    if (open) resetSnapPoint();
  }, [open]);
  const lowered = Boolean(phone && snapPoints && snapPoint !== snapPoints.at(-1));
  // The sheet's exit, held here. Nearly every window in the app mounts
  // its Root already open and unmounts it the moment the caller hears
  // onOpenChange(false), so the primitive never sees `open` flip and its
  // ending style, which is where the slide-out lives, never runs. On a
  // phone a close request flips the primitive's OWN open first, the
  // sheet leaves, and the caller is told once the primitive reports the
  // leave complete. Then `leaving` is reset: a caller that unmounted is
  // gone, one that set open=false is closed either way, and one that
  // refused (kept open=true) gets its sheet back, with the entrance.
  const [leaving, setLeaving] = React.useState(false);
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  // A page holds its close the same way on either shape: it plays its
  // own exit (DialogContent) and reports back through `finish`.
  const pageMode = React.useRef(false);
  const setPageMode = (page: boolean) => {
    pageMode.current = page;
  };
  const setGuards = (next: DialogGuards | null) => {
    guards.current = next;
  };
  // What runs once the held exit has played: the close, or whatever a
  // page's Back was going to do.
  const pending = React.useRef<(() => void) | null>(null);
  const depart = (then: () => void) => {
    if ((phone || pageMode.current) && open) {
      pending.current = then;
      setLeaving(true);
    } else then();
  };
  const close = () => depart(() => onOpenChangeRef.current?.(false));
  const finish = () => {
    const then = pending.current;
    pending.current = null;
    setLeaving(false);
    then?.();
  };
  const leave = { leaving, depart, finish, setPageMode };
  const handleOpenChangeComplete = (isOpen: boolean): void => {
    onOpenChangeComplete?.(isOpen);
    if (!isOpen && leaving) finish();
  };
  const handleOpenChange = (
    nextOpen: boolean,
    details: DialogPrimitive.Root.ChangeEventDetails | DrawerPrimitive.Root.ChangeEventDetails,
  ): void => {
    if (!nextOpen && guards.current) {
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
    if (nextOpen) onOpenChange?.(true);
    else close();
  };
  const Root = phone ? DrawerPrimitive.Root : DialogPrimitive.Root;
  // The Dialog primitive has no height to rest at and does not know the
  // props, so they are handed only to the Drawer.
  const resting =
    phone && snapPoints ? { snapPoints, snapPoint, onSnapPointChange: setSnapPoint } : undefined;
  return (
    <SheetContext value={phone}>
      <SheetLoweredContext value={lowered}>
      <DialogLeaveContext value={leave}>
      <DialogCloseContext value={close}>
        <DialogGuardContext value={setGuards}>
          <Root
            open={open === undefined ? undefined : open && !leaving}
            onOpenChange={handleOpenChange}
            onOpenChangeComplete={handleOpenChangeComplete}
            {...resting}
            {...props}
          />
        </DialogGuardContext>
      </DialogCloseContext>
      </DialogLeaveContext>
      </SheetLoweredContext>
    </SheetContext>
  );
}

function DialogTrigger({ ...props }: Omit<DialogPrimitive.Trigger.Props, 'handle'>) {
  const Trigger: React.FC<Omit<DialogPrimitive.Trigger.Props, 'handle'>> = React.use(SheetContext)
    ? (DrawerPrimitive.Trigger as React.FC<Omit<DialogPrimitive.Trigger.Props, 'handle'>>)
    : DialogPrimitive.Trigger;
  return <Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  const Portal = React.use(SheetContext) ? DrawerPrimitive.Portal : DialogPrimitive.Portal;
  return <Portal {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  const Close = React.use(SheetContext) ? DrawerPrimitive.Close : DialogPrimitive.Close;
  return <Close data-slot="dialog-close" {...props} />;
}

/**
 * The scrim — the registry's — and, on a desktop, the layout box (see the
 * note at the top). The phone branch styles the Drawer's Viewport with
 * the same classes instead; this element is the Dialog's.
 */
function DialogOverlay({
  className,
  onClick,
  enter = true,
  ...props
}: DialogPrimitive.Backdrop.Props & {
  /** Fade in as the window opens. */
  enter?: boolean;
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      // Base UI does not render a NESTED dialog's backdrop by default —
      // and in this file the Backdrop is the layout box the Popup lives
      // inside (the structural departure noted at the top), so without
      // this a window opened from inside another window rendered
      // nothing at all (back when a page was a card of its own): the
      // parent hid itself for a page that never appeared, which read as
      // the whole dialog just closing. Each
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
        enter && 'sm:data-open:animate-in sm:data-open:fade-in-0 data-handover:animate-none!',
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
  React.useLayoutEffect(() => {
    close.current = onClose;
  });
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
 * `hidden` IS inside the portal.
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
  const close = React.use(DialogCloseContext);
  const setGuards = React.use(DialogGuardContext);
  const phone = React.use(SheetContext);
  const lowered = React.use(SheetLoweredContext);
  const small = size === 'sm';

  // The second-page bookkeeping. `covered` counts the pages currently
  // drawn over this window's content; `cover` is what those pages call,
  // handed down by context, and what they hand it is their way back,
  // which is what Escape and the platform's Back mean while they are
  // up (pageRequests, newest last). `host` is the cell they draw into;
  // `height` is this card, read live.
  const [covered, setCovered] = React.useState(0);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const pageRequests = React.useRef<Array<() => void>>([]);
  const card = React.useRef<HTMLElement | null>(null);
  const coverParent = React.use(CoverParent);
  const leave = React.use(DialogLeaveContext);

  // The X's verb: shut this window, then every window it was opened
  // inside (see CoverParent.dismissAll). Read through refs so the handle
  // below keeps ONE identity for the life of the window — `close` changes
  // with the props it is built from, and a handle that changed with it
  // would re-run every child's cover effect and rebuild its
  // ResizeObserver each time.
  const closeRef = React.useRef(close);
  const parentRef = React.useRef(coverParent);
  React.useLayoutEffect(() => {
    closeRef.current = close;
    parentRef.current = coverParent;
  });
  const dismissAll = () => {
    closeRef.current();
    parentRef.current?.dismissAll();
  };

  const asParent = {
    cover: (request: () => void) => {
      pageRequests.current.push(request);
      setCovered((c) => c + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pageRequests.current = pageRequests.current.filter((r) => r !== request);
        setCovered((c) => c - 1);
      };
    },
    height: () => card.current?.offsetHeight ?? 0,
    host,
    dismissAll,
  };

  // A LAYER never covers its parent; it is capped to it, and grows the
  // chevron once it has hidden it completely — see use-sheet-cover.
  const { cap, covered: coversParent, ref: coverRef } = useSheetCover(small && phone);

  // A PAGE: a default-sized window opened from inside another. It is
  // drawn inside that window's card (see `stack` below), not as a card
  // of its own, and the Dialog holds its close for it (pageMode).
  const page = !small && !hidden && Boolean(coverParent);
  // Told before paint, so a close in the same commit already knows.
  React.useLayoutEffect(() => {
    leave?.setPageMode(page);
  });
  const shut = hidden;
  // A nested page that names no destination goes back to the window it
  // covered — closing a page IS going back. A page's own Back rides the
  // held exit (depart), so the turn plays before the caller's state
  // change unmounts it; a Back handed to a first window or a layer is
  // the caller's, as it always was.
  const back = onBack ? (page && leave ? () => leave.depart(onBack) : onBack) : page ? close : undefined;
  // What Escape, Android's Back and a swipe mean here: for a small window
  // on its second page, "back to the first"; for everything else, out.
  // A PAGE included: a dismissal from inside a chain leaves the whole
  // chain, since the chevron is the one control that steps back and a
  // gesture that lands you on a window you had already walked past is
  // a Back button in disguise (lanph3re's call, 2026-09-13). While a
  // page is up over THIS window, they mean what that page says
  // (`route`, in the guards below), which is the same thing.
  const request = small ? (onBack ?? close) : page ? dismissAll : close;
  const requestRef = React.useRef(request);
  React.useLayoutEffect(() => {
    requestRef.current = request;
  });
  const route = () => {
    const top = pageRequests.current.at(-1);
    (top ?? requestRef.current)();
  };

  // The page tells its parent it is up for as long as it stands, and
  // lets go as it STARTS to leave, so the content under it returns on
  // the same clock the page leaves on.
  const release = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    if (!page || !coverParent) return;
    const done = coverParent.cover(() => requestRef.current());
    release.current = done;
    return () => {
      done();
      release.current = null;
    };
  }, [page, coverParent]);
  const leaving = Boolean(page && leave?.leaving);
  React.useEffect(() => {
    if (!leaving || !leave) return;
    release.current?.();
    // With motion reduced the exit plays no animation, so nothing
    // would report its end; and a fallback in case an animation is
    // cut short (a tab hidden mid-exit fires no animationend).
    if (reducedMotion()) {
      leave.finish();
      return;
    }
    const fallback = window.setTimeout(leave.finish, 600);
    return () => window.clearTimeout(fallback);
  }, [leaving, leave]);

  // The content UNDER a page: it steps a third of the way left and
  // darkens as the page arrives (the router's own push, index.css),
  // then is out of sight and inert until the page leaves, when it comes
  // back the same way. Instant, both ways, under reduced motion and on a
  // desktop, where a page fades in over it.
  const [under, setUnder] = React.useState<'shown' | 'leaving' | 'hidden' | 'returning'>('shown');
  React.useLayoutEffect(() => {
    const animate = phone && !reducedMotion();
    if (covered > 0) {
      setUnder((u) => (u === 'hidden' || u === 'leaving' ? u : animate ? 'leaving' : 'hidden'));
    } else {
      setUnder((u) => (u === 'shown' || u === 'returning' ? u : animate ? 'returning' : 'shown'));
    }
  }, [covered, phone]);

  // The dismissal routing the Root's onOpenChange consults (see the top).
  React.useEffect(() => {
    if (!setGuards) return;
    setGuards({
      // A shut window ignores Escape outright; CloseWatcher, where it
      // exists, hears the same un-defaulted keydown and answers instead.
      escape: () => {
        if (!shut && !window.CloseWatcher) route();
      },
      // The Drawer's Android watcher already IS the platform's answer.
      closeRequest: () => {
        if (!shut) route();
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
    });
    return () => {
      setGuards(null);
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
      if (handedOver) {
        // Taking over from a stand-in: no entrance, for the card or for
        // the scrim around it (the Viewport, or a desktop's Backdrop).
        handedOver = false;
        node.dataset.handover = '';
        const scrim = node.closest<HTMLElement>('[data-slot=dialog-overlay]');
        if (scrim) scrim.dataset.handover = '';
      }
      if (!node.contains(document.activeElement)) {
        const field = soleTextField(node);
        if (field) {
          // This window will raise the keyboard as it opens, and its
          // height will change under the entrance: its slide is measured
          // in viewport height, not its own (see the note at the top).
          // Set before the first paint, which is when the animation's
          // start is read.
          node.dataset.noEnter = '';
          field.focus();
        } else if (page) {
          // A page has no Popup of its own to take the focus: the
          // content it covers has just gone inert, which drops whatever
          // focus was in it, so the page takes it, as a container.
          node.focus({ preventScroll: true });
        }
      }
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
      <CoverParent value={asParent}>{children}</CoverParent>
    </>
  );

  // The registry's card. overscroll-contain: a scroll this window cannot
  // use is its own business. [&>*]:shrink-0: children keep their size and
  // the WINDOW scrolls (which is also what hands the Drawer its swipe
  // arbitration: the drag is the sheet's only once this scroller is at
  // its top). overflow-x-hidden, said outright: a page arriving from the
  // right stands outside the card for a third of a second, and an
  // `auto` x-axis (which is what `overflow-y-auto` alone implies) would
  // make that a horizontal scroll range for as long as it did.
  const cardClass = cn(
    'bg-popover text-popover-foreground ring-window-ring flex w-full flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-4 text-sm ring-1 outline-none [&>*]:shrink-0',
    title !== undefined ? 'pt-0' : 'pt-4 max-sm:pt-0',
    className,
  );
  const cardStyle: React.CSSProperties = {
    ...style,
    // The parent's height as a VARIABLE, read into the min() below,
    // so the parent's number and the band's own are both ceilings.
    ...(phone && small && cap ? ({ '--sheet-cap': `${cap}px` } as React.CSSProperties) : undefined),
  };

  // What every shape of this window draws inside its box: its own
  // content in one grid cell, and the cell the pages opened from it
  // draw into over it (`host`, display:contents so each page is a grid
  // item of the same cell). One cell, so the card is as tall as the
  // taller of the two and a page stands in the box it covers; the
  // page's own content then fills that height. Each layer reaches into
  // the card's side padding (-mx-4 px-4) and carries the card's own
  // fill, so what moves is the whole surface, padding and all, and what
  // dims is a surface rather than the strips on it. onAnimationEnd
  // reads only its own element's animations: a page's arrival bubbles
  // up through here too.
  //
  // `grow`: the card is a flex column whose children do not shrink, and
  // this grid is the one child that should take whatever height the box
  // has beyond its content. A `fill` sheet has that height by design (the
  // band, or the window it was opened over), and its footers are written
  // against it: `mt-auto` on the add-move field and the details panel's
  // action row. Without it the grid was content-sized, `mt-auto` had no
  // room to take, and a short list left the field mid-sheet with the
  // sheet's own fill empty beneath it. A window sized by its content is
  // unchanged: there is nothing to grow into.
  const stack = (
    <div className="grid min-w-0 grow">
      <div
        data-slot="dialog-under"
        // `inert`: the content under a page is neither read nor reached
        // by Tab.
        inert={covered > 0 || undefined}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return;
          setUnder((u) => (u === 'leaving' ? 'hidden' : u === 'returning' ? 'shown' : u));
        }}
        className={cn(
          'bg-popover col-start-1 row-start-1 -mx-4 flex min-w-0 flex-col gap-4 px-4 [&>*]:shrink-0',
          under === 'leaving' && 'page-under-leave',
          under === 'returning' && 'page-under-return',
          under === 'hidden' && 'invisible',
        )}
      >
        {inner}
      </div>
      <div ref={setHost} className="contents" />
    </div>
  );

  if (page) {
    // The parent's host mounts with its card; a page rendered in the
    // same commit waits one render for it.
    if (!coverParent?.host) return null;
    return createPortal(
      <>
        <DialogOpenEffects shut={false} request={request} />
        <div
          ref={setNode}
          data-slot="dialog-page"
          role="group"
          aria-labelledby={title !== undefined ? titleId : undefined}
          tabIndex={-1}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && leaving) leave?.finish();
          }}
          className={cn(
            // Over the content it covers, whose title row is sticky and
            // z-10: a stacking context of its own, above that.
            'bg-popover relative z-20 col-start-1 row-start-1 -mx-4 flex min-w-0 flex-col gap-4 px-4 outline-none [&>*]:shrink-0',
            // The router's push and pop on a phone (index.css, data-nav):
            // in from the right on the spring, out to the right on the
            // spring run backwards. A desktop card has no push; the page
            // fades, on the card's own 100ms.
            phone
              ? 'animate-in slide-in-from-right duration-(--pane-turn) ease-(--pane-turn-ease)'
              : 'animate-in fade-in-0 duration-100',
            leaving &&
              (phone
                ? 'animate-out slide-out-to-right fill-mode-forwards duration-(--pane-turn) ease-(--pane-turn-ease-out) pointer-events-none'
                : 'animate-out fade-out-0 fill-mode-forwards duration-100 pointer-events-none'),
            'motion-reduce:animate-none',
          )}
        >
          {stack}
        </div>
      </>,
      coverParent.host,
    );
  }

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
              // The scrim arrives and leaves on the sheet's own clock
              // (below): the dim and the blur used to snap on with it.
              'transition-opacity duration-(--pane-turn) ease-(--pane-turn-ease) animate-in fade-in-0',
              'data-ending-style:opacity-0 data-ending-style:duration-200 data-ending-style:ease-(--pane-turn-ease-out)',
              // Taking over from a stand-in (handOverWindow): no entrance.
              'data-handover:animate-none!',
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
                //
                // The corners are the xl rung at full height, the rung
                // the cards under it take and the rung this same window
                // takes on a desktop (below), and they round further as
                // the sheet drops (a drag, or a lower snap point): see
                // `sheet-corners` in index.css. It was lg for one sweep,
                // which put the sheet on the menus' rung: a corner 4px
                // shy of every card behind it at the default knob, and
                // 6.4px at Large, in a component that changed rung when
                // it changed shape.
                'sheet-corners pb-[calc(3.25rem+var(--safe-b))]',
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
                // The snap-point offset rides in the same translate: it
                // is 0px for a sheet with no snap points, and while a
                // drag is on the engine folds it into the movement, so
                // the sum is right at rest and mid-drag alike. The
                // entrance, a swipe's snap-back and a move between two
                // snap points all ride the spring (the snap-back was
                // 180ms ease-in-out; the spring is 90% home at 180ms, so
                // the arrival reads the same and only the tail is
                // softer), and the corners settle on the same clock. The
                // exit, a button or a swipe past the threshold, is
                // shorter and on the spring run backwards (see the note
                // at the top).
                'transform-[translate3d(0,calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)),0)] transition-[transform,border-radius,margin] duration-(--pane-turn) ease-(--pane-turn-ease) will-change-transform',
                // The entrance is an ANIMATION on mount, not the
                // primitive's starting style: nearly every window here
                // mounts its Root already open, so the primitive never
                // sees `open` flip and never marks a start. The exit is
                // the primitive's ending style, which the Dialog wrapper
                // above makes it see (see `leaving` there).
                'animate-in slide-in-from-bottom',
                'data-ending-style:transform-[translate3d(0,100%,0)] data-ending-style:duration-200 data-ending-style:ease-(--pane-turn-ease-out) data-ending-style:pointer-events-none',
                'data-swiping:duration-0 data-swiping:select-none',
                // Resting low: not a scroller, so a drag up lifts the
                // sheet (see SheetLoweredContext).
                lowered && 'overflow-y-hidden',
                // The keyboard sheet: the same rise, from a length the
                // keyboard cannot change.
                'data-no-enter:[--tw-enter-translate-y:100dvh]',
                'data-handover:animate-none!',
              )}
              {...props}
            >
              {stack}
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
        // Hidden by its caller: gone from layout entirely.
        style={shut ? { display: 'none' } : undefined}
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
            'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-handover:animate-none!',
          )}
          {...props}
        >
          {stack}
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
  const chain = React.use(CoverParent);
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t border-card-ring bg-muted/50 p-4 sm:flex-row sm:justify-end',
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
        <Button variant="secondary" onClick={chain?.dismissAll}>
          {t('Close')}
        </Button>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  const Title = React.use(SheetContext) ? DrawerPrimitive.Title : DialogPrimitive.Title;
  return (
    <Title
      data-slot="dialog-title"
      className={cn('font-heading text-base leading-none font-medium', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  const Description = React.use(SheetContext)
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
  DialogTitle,
  DialogTrigger,
};
