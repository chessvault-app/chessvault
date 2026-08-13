import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/media';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { useSheetDrag } from './sheetDrag';
import { t } from '@/lib/i18n';

/**
 * The one-question window: a bottom sheet on a phone, a small centred card
 * on a desktop.
 *
 * Extracted from PromptSheet once "move to" wanted the same thing with a
 * list in it instead of a field: an anchored popover put its answer beside
 * the row it came from, which on a phone is wherever the row happened to
 * be — sometimes under the keyboard, sometimes off the edge.
 *
 * It was a centred card on the phone too, and that was a workaround: a
 * card floating in the middle of the screen was the one shape iOS's
 * keyboard could not push somewhere silly. It can be a sheet now, which is
 * what every other window on a phone already is — the keyboard is measured
 * (lib/keyboardInset), the layer is pinned to the band that can be seen,
 * and the sheet drags away from anywhere on itself.
 *
 * Nothing here is transitioned: animating against iOS's own animation is
 * what made the earlier attempts jump about.
 */
export function Sheet({
  label,
  children,
  onClose,
  className,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const phone = useMediaQuery('(max-width: 39.9375rem)');
  const drag = useSheetDrag(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portalled for the same reason ActionSheet is: a rename opened from a
  // shelf card is a child of that card, and a card that lifts under the
  // pointer is a containing block for `fixed` — so the sheet was laid out
  // inside the card and clipped by its overflow.
  return createPortal(
    <div
      className={cn(
        'vv-band fixed inset-0 z-50 flex justify-center bg-black/50',
        // Bottom edge on a phone, middle of the band on a desktop.
        'max-sm:items-end max-sm:p-0 sm:items-center sm:p-3',
      )}
      onPointerDown={() => {
        onClose();
        suppressNextClick();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(label)}
        ref={phone ? drag.ref : undefined}
        style={phone ? drag.style : undefined}
        className={cn(
          // overscroll-contain for the same reason Modal has it: a scroll
          // this card cannot use must not be handed to the page under it.
          // [&>*]:shrink-0 for the other one: a short window is one field
          // and two buttons, and a flex column would rather squash them
          // than let itself overflow.
          'bg-surface border-line flex max-h-full w-full flex-col gap-2 overflow-y-auto overscroll-contain',
          'border p-3 shadow-[var(--shadow-pop)] [&>*]:shrink-0',
          'max-sm:rounded-t-2xl max-sm:pb-[calc(0.75rem+var(--safe-b))]',
          'sm:max-w-sm sm:rounded-xl',
          className,
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* The same rule every other window and panel draws under its
            title; full-bleed against the card's own padding. On a phone
            the grabber sits above it, and the whole strip is the mouse's
            drag handle — see sheetDrag for why a finger needs neither. */}
        <div
          className="border-line -mx-3 -mt-1 border-b px-3 pb-2 pt-1 max-sm:touch-none max-sm:select-none"
          {...(phone ? drag.handlers : {})}
        >
          <div className="bg-line mx-auto mb-2 h-1 w-9 cursor-grab rounded-full sm:hidden" aria-hidden />
          <p className="text-subtle text-xs">{t(label)}</p>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
