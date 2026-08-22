import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFloating } from '@/lib/floating';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { useCloseRequest, useDialogFocus } from './dialogFocus';
import { useSheetDrag } from './sheetDrag';
import { t } from '@/lib/i18n';

export interface SheetAction {
  label: string;
  icon: LucideIcon;
  /** Destructive items are tinted and sit last, away from the thumb. */
  danger?: boolean;
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

/**
 * A row's actions, in a sheet that rises from the bottom of the screen.
 *
 * A card used to wear its verbs: a pencil, a folder-in, a bin, three of
 * them per row, revealed on hover and permanently visible on touch. That
 * is a lot of chrome repeated down a list, and on a phone they were three
 * small targets in the corner of a card you were probably trying to open.
 * One ⋯ opens this instead, where each action has a name and a whole row
 * to be tapped in.
 *
 * On a phone it rises from the bottom, where the thumb already is. On a
 * desktop it is a popover under the ⋯ it came from: a bar sliding up from
 * the bottom of a 1400px window is a long way from a button in the middle
 * of it, and a mouse has no reach problem to solve.
 */
/**
 * The verbs actually on screen.
 *
 * An action may be phone-only — the callers hide a verb with a class
 * rather than dropping it from the array — and a `display: none` button
 * cannot take focus, so `querySelector` alone opened the menu with the
 * focus still on the ⋯ that opened it. This is the same filter
 * ui/dialogFocus applies to its Tab walk, and for the same reason.
 */
function menuItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
    (el) => el.offsetParent !== null,
  );
}

export function ActionSheet({
  title,
  actions,
  onClose,
  children,
  anchor,
  point,
}: {
  title: string;
  actions: SheetAction[];
  onClose: () => void;
  /** Anything above the actions — a detail line, say. */
  children?: ReactNode;
  /** The control this came from; a desktop popover hangs under it. */
  anchor?: React.RefObject<HTMLElement | null>;
  /** Where a right-click happened; the popover opens there instead. */
  point?: { x: number; y: number } | null;
}) {
  // Read once, when it opens: a menu that re-anchored itself mid-gesture
  // because the window was being resized would be a menu that moves under
  // the pointer.
  const [rect] = useState<DOMRect | null>(() => anchor?.current?.getBoundingClientRect() ?? null);
  const [at] = useState(() => point ?? null);
  const [wide] = useState(() => window.matchMedia('(min-width: 40rem)').matches);
  const popover = wide && (at !== null || rect !== null);

  // Under the anchor, or at the pointer, and inside the window either
  // way — a ⋯ on the last card of a long shelf used to open a menu whose
  // rows were below the bottom of the screen. This file measured itself
  // before paint to fix that, and lib/floating is that same trick
  // generalised, so the local copy goes: the height comes from the same
  // measurement and the horizontal clamp comes free with it.
  //
  // A context menu opens AT the pointer, which is an anchor with no size.
  const dialogEl = useRef<HTMLDivElement | null>(null);
  const anchorBox = at
    ? { top: at.y, bottom: at.y, left: at.x, right: at.x, width: 0, height: 0 }
    : rect;
  /**
   * Up and down the list of verbs, and Home/End to its ends — what the
   * menu role promises. Focus moves; there is nothing to select until
   * something is pressed, so this is plain focus movement rather than
   * the roving-tabindex pattern a tablist needs.
   *
   * Stopped here, like every other strip in the app: the board's arrow
   * shortcuts listen on the window, and a menu open over a game must not
   * step it.
   */
  const onMenuKey = (e: React.KeyboardEvent<HTMLElement>): void => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const items = menuItems(e.currentTarget);
    if (items.length === 0) return;
    const from = items.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : (from + step + items.length) % items.length;
    items[to]?.focus();
  };

  const float = useFloating(popover ? anchorBox : null, {
    side: 'bottom',
    // At the pointer the menu opens to the RIGHT of it, the way a context
    // menu does; off a ⋯ it hangs from the trigger's right edge, which is
    // what kept it inside the card it belongs to.
    align: at ? 'start' : 'end',
    gap: at ? 0 : 4,
  });

  // Escape, and Android's Back gesture with it — see useCloseRequest.
  useCloseRequest(onClose);

  // The same gesture every bottom sheet in the app is pushed away with.
  const drag = useSheetDrag(onClose);
  const focusRef = useDialogFocus();

  // Destructured so the deps below are plain values the linter can see.
  const { ref: floatRef } = float;
  const { ref: dragRef } = drag;
  const setDialogNode = useCallback(
    (node: HTMLDivElement | null) => {
      focusRef(node);
      dialogEl.current = node;
      if (popover) floatRef(node);
      else dragRef(node);
    },
    [popover, focusRef, floatRef, dragRef],
  );

  /**
   * The first verb takes the focus, which is where a menu opens.
   *
   * Once the PLACEMENT exists, not on mount: useFloating paints the
   * popover `visibility: hidden` until it has measured it, and a hidden
   * element cannot be focused — calling focus() in the first commit was
   * a silent no-op, and the focus stayed on the ⋯ that opened it.
   *
   * A layout effect, so it lands before useDialogFocus's own pass, which
   * would otherwise focus the container; and guarded by a ref, because
   * the placement changes again if the window moves and the focus must
   * not jump back to the top of the menu while it is being read.
   */
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (!popover || !float.placement || focused.current) return;
    focused.current = true;
    if (dialogEl.current) menuItems(dialogEl.current)[0]?.focus();
  }, [popover, float.placement]);

  // Portalled to the body, because `position: fixed` is only relative to
  // the viewport while no ancestor has a transform, a filter or
  // containment — and a shelf card has a transform: it lifts a pixel under
  // the pointer, which is exactly when this menu opens. The card became
  // the containing block, its `overflow-hidden` clipped the menu to a
  // 60px strip, and the menu appeared to blink and do nothing. A floating
  // layer has no business living inside the thing it floats over.
  return createPortal(
    <div
      className={cn(
        'vv-band pointer-events-auto fixed inset-0 z-50',
        popover ? '' : 'bg-scrim flex items-end justify-center',
      )}
      onPointerDown={() => {
        onClose();
        suppressNextClick();
      }}
      role="presentation"
    >
      <div
        // A popover of verbs is a MENU, and said so nowhere: it wore
        // `dialog aria-modal` because it shares its machinery with the
        // sheet, and a screen reader announced a window with buttons in
        // it rather than a menu with N items and a place in it. The
        // sheet keeps the dialog role — on a phone this IS a window,
        // with a scrim and a drag.
        role={popover ? 'menu' : 'dialog'}
        aria-modal={popover ? undefined : true}
        aria-label={t(title)}
        onKeyDown={popover ? onMenuKey : undefined}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        // A sheet drags from anywhere on it; a popover is not a sheet.
        //
        // useCallback, and it matters: an inline arrow is a NEW ref every
        // render, so React detaches it (ref(null)) and reattaches it on
        // each one. useDialogFocus keys its effect on the node, so it
        // tore down and rebuilt every render too — and its teardown hands
        // focus back to whatever opened the window. That is what took the
        // focus off the first menu item a moment after it was given it.
        // All three refs below are stable (two useState setters and a
        // useCallback), so this one is.
        ref={setDialogNode}
        style={!popover ? drag.style : float.style}
        className={cn(
          'bg-card border-border border p-2 shadow-pop',
          popover
            ? 'w-56 rounded-lg'
            : // The phone's home indicator lives under the sheet's last
              // row — 1rem of air above it, matching the breathing room
              // Sheet and Modal keep (their content is denser, so they
              // carry a little more).
              'w-full max-w-lg rounded-t-2xl pb-[calc(1rem+var(--safe-b))]',
        )}
      >
        {/* The handle, and nothing else. It carried an X beside it for a
            while, from back when the drag was a promise the sheet did not
            keep: a handle that did nothing needed a button next to it to
            do the work. The whole sheet drags now — from anywhere on it,
            with the scrim and Escape besides — and a close button on top
            of three other ways out is one more thing to read past. */}
        {popover ? (
          <p className="text-subtle truncate px-3 pb-2 text-sm">{t(title)}</p>
        ) : (
          <div
            // The MOUSE grabs by the header only; a finger may start
            // anywhere (see sheetDrag). A press on a verb is still a
            // press — the drag needs 6px of travel before it is one.
            {...drag.handlers}
            className="-mt-1 cursor-grab touch-none select-none pt-1 active:cursor-grabbing"
          >
            <div className="bg-border mx-auto mb-1.5 h-1 w-9 rounded-full" aria-hidden />
            <p className="text-subtle truncate px-3 pb-1 text-sm">{t(title)}</p>
          </div>
        )}
        {children}
        {actions.map(({ label, icon: Icon, danger, className, onSelect }) => (
          <button
            key={label}
            type="button"
            role={popover ? 'menuitem' : undefined}
            onClick={() => {
              onClose();
              onSelect();
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg text-left transition-colors duration-100',
              // A popover row is a menu item; a sheet row is a touch target.
              popover ? 'px-3 py-1.5 text-sm' : 'px-3 py-3 text-base',
              danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent',
              className,
            )}
          >
            <Icon className={cn(popover ? 'size-3.5' : 'size-4', 'shrink-0', !danger && 'text-subtle')} />
            {t(label)}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
