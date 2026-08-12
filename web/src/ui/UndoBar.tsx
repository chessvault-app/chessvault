import { Undo2 } from 'lucide-react';
import { Button } from './Button';
import { t } from '@/lib/i18n';

/**
 * The undo that stands in for a confirmation, at the foot of the list it
 * belongs to. Above the phone's bottom bar, beside the FAB rather than
 * under it.
 */
export function UndoBar({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 md:bottom-6">
      <div className="bg-surface border-line pointer-events-auto flex max-w-full items-center gap-3 rounded-full border py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-pop)]">
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
