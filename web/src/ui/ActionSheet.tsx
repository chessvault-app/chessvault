import { useEffect, useState, type ReactNode } from 'react';
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
}: {
  title: string;
  actions: SheetAction[];
  onClose: () => void;
  /** Anything above the actions — a detail line, say. */
  children?: ReactNode;
  /** The control this came from; a desktop popover hangs under it. */
  anchor?: React.RefObject<HTMLElement | null>;
}) {
  // Read once, when it opens: a menu that re-anchored itself mid-gesture
  // because the window was being resized would be a menu that moves under
  // the pointer.
  const [rect] = useState<DOMRect | null>(() => anchor?.current?.getBoundingClientRect() ?? null);
  const [wide] = useState(() => window.matchMedia('(min-width: 40rem)').matches);
  const popover = wide && rect !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50',
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
        style={
          popover
            ? {
                position: 'fixed',
                top: rect.bottom + 4,
                right: Math.max(8, window.innerWidth - rect.right),
              }
            : undefined
        }
        className={cn(
          'bg-surface border-line border p-2 shadow-[var(--shadow-pop)]',
          popover
            ? 'w-56 rounded-lg'
            : // The phone's home indicator lives under the sheet's last row.
              'w-full max-w-lg rounded-t-2xl pb-[calc(0.5rem+env(safe-area-inset-bottom))]',
        )}
      >
        {/* The grab handle a bottom sheet needs to say which way it came
            from — a popover already says that by where it hangs. */}
        {!popover && (
          <div className="bg-line mx-auto mb-2 mt-1 h-1 w-9 shrink-0 rounded-full" aria-hidden />
        )}
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
              'flex w-full items-center gap-3 rounded-lg text-left transition-colors duration-100',
              // A popover row is a menu item; a sheet row is a touch target.
              popover ? 'px-3 py-1.5 text-xs' : 'px-3 py-3 text-sm',
              danger ? 'text-bad hover:bg-bad/10' : 'text-fg hover:bg-surface-2',
            )}
          >
            <Icon className={cn(popover ? 'size-3.5' : 'size-4', 'shrink-0', !danger && 'text-subtle')} />
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
