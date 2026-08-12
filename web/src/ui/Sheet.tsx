import { useEffect, useState, type ReactNode } from 'react';
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
 * window is behind the keyboard. Only the padding changes as the keyboard
 * arrives, and it is not transitioned — nothing here animates against
 * iOS's own animation, which is what made earlier attempts jump about.
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
  const [covered, setCovered] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = (): void =>
      setCovered(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    measure();
    vv.addEventListener('resize', measure);
    return () => vv.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      style={{ paddingBottom: covered ? covered + 12 : undefined }}
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
          'bg-surface border-line flex max-h-full w-full max-w-sm flex-col gap-2 overflow-y-auto',
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
    </div>
  );
}
