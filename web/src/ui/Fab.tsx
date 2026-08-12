import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

export interface FabAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

/**
 * The one way to make something new: a round button in the bottom-right
 * corner, on every shelf that holds a list.
 *
 * It replaced a [Create ▾] in the page header. A header is where you look
 * to know WHERE you are, not to act, and on a phone that button was in the
 * hardest corner to reach — the top of the screen, opposite the thumb.
 *
 * One action fires on tap. Several fan upwards as labelled buttons, so the
 * choice reads as a list of things you can make rather than a menu to open
 * and then read.
 */
export function Fab({ actions, label = 'Create' }: { actions: FabAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const single = actions.length === 1 ? actions[0] : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={host}
      // Above the phone's bottom bar and its home indicator, clear of the
      // desktop layout's own edge. Fixed, so a scrolling list never takes
      // it away — making something new is available from anywhere in the
      // list, not only from the top of it.
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex flex-col items-end gap-2 md:bottom-6 md:right-6"
    >
      {open &&
        actions.map(({ label: itemLabel, icon: Icon, onSelect }) => (
          <button
            key={itemLabel}
            type="button"
            onClick={() => {
              setOpen(false);
              onSelect();
            }}
            className={cn(
              'bg-surface border-line text-fg flex items-center gap-2 rounded-full border py-2 pl-3 pr-4',
              'text-sm shadow-[var(--shadow-pop)] transition-colors duration-100 hover:bg-surface-2',
            )}
          >
            <Icon className="text-subtle size-4 shrink-0" />
            {t(itemLabel)}
          </button>
        ))}

      <button
        type="button"
        title={single ? t(single.label) : t(label)}
        aria-label={single ? t(single.label) : t(label)}
        aria-expanded={single ? undefined : open}
        onClick={() => (single ? single.onSelect() : setOpen((v) => !v))}
        className={cn(
          'bg-primary text-primary-fg hover:bg-primary-hover grid size-14 place-items-center rounded-full',
          'shadow-[var(--shadow-pop)] transition-transform duration-100 active:scale-95',
        )}
      >
        {open ? <X className="size-6" /> : <Plus className="size-6" strokeWidth={2.5} />}
      </button>
    </div>
  );
}
