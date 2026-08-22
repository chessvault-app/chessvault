import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
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
        'vv-band fixed inset-0 z-50',
        popover ? '' : 'bg-scrim flex items-end justify-center',
      )}
      onPointerDown={() => {
        onClose();
        suppressNextClick();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(title)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        // A sheet drags from anywhere on it; a popover is not a sheet.
        ref={(node) => {
          focusRef(node);
          dialogEl.current = node;
          if (popover) float.ref(node);
          else drag.ref(node);
        }}
        style={!popover ? drag.style : float.style}
        className={cn(
          'bg-surface border-line border p-2 shadow-pop',
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
            <div className="bg-line mx-auto mb-1.5 h-1 w-9 rounded-full" aria-hidden />
            <p className="text-subtle truncate px-3 pb-1 text-sm">{t(title)}</p>
          </div>
        )}
        {children}
        {actions.map(({ label, icon: Icon, danger, className, onSelect }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              onClose();
              onSelect();
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg text-left transition-colors duration-100',
              // A popover row is a menu item; a sheet row is a touch target.
              popover ? 'px-3 py-1.5 text-sm' : 'px-3 py-3 text-base',
              danger ? 'text-bad hover:bg-bad/10' : 'text-fg hover:bg-surface-2',
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
