import { Undo2 } from 'lucide-react';
import { Button } from './Button';
import { t } from '@/lib/i18n';

/**
 * The undo that stands in for a confirmation.
 *
 * Pinned to the bottom-right of the WINDOW rather than centred over the
 * list: centred, it sat across the cards it was talking about and covered
 * the helper line under them. On a phone it stays centred and clears the
 * bottom bar, where there is no corner to spare.
 *
 * It rises as it appears — a thing that slid up from the bottom edge reads
 * as having arrived, where a thing that blinks into place reads as having
 * always been there and been missed.
 */
export function UndoBar({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div
      className={
        'pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 ' +
        'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] ' +
        'md:inset-x-auto md:bottom-6 md:right-6 md:px-0'
      }
    >
      <div className="animate-rise bg-surface border-line pointer-events-auto flex max-w-full items-center gap-3 rounded-full border py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-pop)]">
        <span className="text-fg min-w-0 truncate text-sm">
          {t('Removed “{name}”', { name: label })}
        </span>
        <Button variant="ghost" size="sm" onClick={onUndo}>
          <Undo2 className="size-3.5" />
          {t('Undo')}
        </Button>
      </div>
    </div>
  );
}
