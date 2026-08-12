import { useEffect, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { t } from '@/lib/i18n';

export interface SheetAction {
  label: string;
  icon: LucideIcon;
  /** Destructive items are tinted and sit last, away from the thumb. */
  danger?: boolean;
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
 * Bottom-anchored on purpose: the sheet arrives where the thumb already
 * is, and lists read downwards from the title, so nothing has to move to
 * be read.
 */
export function ActionSheet({
  title,
  actions,
  onClose,
  children,
}: {
  title: string;
  actions: SheetAction[];
  onClose: () => void;
  /** Anything above the actions — a detail line, say. */
  children?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="bg-scrim fixed inset-0 z-50 flex items-end justify-center"
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
        className={cn(
          'bg-surface border-line w-full max-w-lg rounded-t-2xl border p-2',
          'pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-pop)]',
          // Desktop has no bottom edge worth hugging; it floats clear of it.
          'sm:mb-6 sm:rounded-2xl',
        )}
      >
        {/* The grab handle every bottom sheet has: it says which way this
            came from, and which way it goes. */}
        <div className="bg-line mx-auto mb-2 mt-1 h-1 w-9 shrink-0 rounded-full" aria-hidden />
        <p className="text-subtle truncate px-3 pb-2 text-xs">{t(title)}</p>
        {children}
        {actions.map(({ label, icon: Icon, danger, onSelect }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              onClose();
              onSelect();
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm',
              'transition-colors duration-100',
              danger ? 'text-bad hover:bg-bad/10' : 'text-fg hover:bg-surface-2',
            )}
          >
            <Icon className={cn('size-4 shrink-0', !danger && 'text-subtle')} />
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
