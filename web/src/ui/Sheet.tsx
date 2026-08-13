import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { t } from '@/lib/i18n';

/**
 * The small centred card every one-question window is made of.
 *
 * Extracted from PromptSheet once "move to" wanted the same thing with a
 * list in it instead of a field: an anchored popover put its answer beside
 * the row it came from, which on a phone is wherever the row happened to
 * be — sometimes under the keyboard, sometimes off the edge.
 *
 * It centres inside the VISUAL viewport, not the window: the middle of the
 * window is behind the keyboard, and on iOS it is not even where it was —
 * the page gets shifted to reveal the field. The layer is pinned to
 * --vvt/--vvh for both reasons (see lib/keyboardInset), so centring in it
 * is centring in what can be seen. Nothing here is transitioned: animating
 * against iOS's own animation is what made earlier attempts jump about.
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
      className="fixed inset-x-0 top-[var(--vvt,0px)] h-[var(--vvh,100dvh)] z-50 flex items-center justify-center bg-black/50 p-3"
      onPointerDown={() => {
        onClose();
        suppressNextClick();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(label)}
        className={cn(
          // overscroll-contain for the same reason Modal has it: a scroll
          // this card cannot use must not be handed to the page under it.
          'bg-surface border-line flex max-h-full w-full max-w-sm flex-col gap-2 overflow-y-auto overscroll-contain',
          'rounded-xl border p-3 shadow-[var(--shadow-pop)]',
          className,
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* The same rule every other window and panel draws under its
            title; full-bleed against the card's own padding. */}
        <p className="border-line -mx-3 border-b px-3 pb-2 text-subtle text-xs">{t(label)}</p>
        {children}
      </div>
    </div>,
    document.body,
  );
}
