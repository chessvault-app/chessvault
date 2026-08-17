import { Folder as FolderIcon, ChevronRight, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { ClearableInput } from './Input';
import { Sheet } from './Sheet';
import { t } from '@/lib/i18n';

/**
 * The "Move to" window shared by the notes and studies shelves: existing
 * collections as rows, plus an always-there field naming a NEW collection —
 * without it, a vault with no collections yet offered nothing but the
 * header (lanph3re's report). The move API mkdirs the target, so a new name
 * needs no separate create step.
 *
 * A centred Sheet rather than the popover it used to be, for the same
 * reason renaming is: an answer anchored to its row lands wherever that row
 * happens to be, which on a phone is often under the keyboard.
 */
export function MoveToPopover({
  currentFolder,
  folders,
  onPick,
  onClose,
}: {
  currentFolder: string;
  folders: string[];
  /** `''` targets the shelf root. */
  onPick: (target: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const targets = ['', ...folders].filter((f) => f !== currentFolder);
  const pickNew = (): void => {
    if (draft.trim()) onPick(draft.trim().replace(/\//g, '-'));
  };

  return (
    <Sheet label="Move to" onClose={onClose}>
      <div className="flex max-h-64 flex-col overflow-y-auto overscroll-contain">
        {targets.map((target) => (
          <button
            key={target || '(root)'}
            type="button"
            onClick={() => onPick(target)}
            className={cn(
              'hover:bg-surface-2 group flex w-full items-center gap-2 rounded-md px-2 py-1.5 pointer-coarse:py-2.5',
              'text-left text-sm transition-colors duration-100',
            )}
          >
            <FolderIcon className="text-subtle size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{target || t('(no collection)')}</span>
            {/* These rows read as a list of places, not as a list of things
                to press. The chevron says the row goes somewhere, and it
                sharpens under the pointer rather than appearing from
                nowhere — an icon that materialises on hover moves the text
                it sits beside. */}
            <ChevronRight className="text-subtle size-3.5 shrink-0 opacity-40 transition-opacity duration-100 group-hover:opacity-100" />
          </button>
        ))}
      </div>

      {/* Naming a collection that does not exist yet is a different act from
          picking one that does, so it is separated and says what it does.
          The ↵ glyph that used to sit here was the only instruction, and it
          only means "press enter" to somebody who already knew. */}
      <div className="border-line flex items-center gap-1 border-t pt-2">
        <ClearableInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('New collection…')}
          className="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') pickNew();
            if (e.key === 'Escape') onClose();
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          title={t('Move into this new collection')}
          disabled={!draft.trim()}
          onClick={pickNew}
        >
          <FolderPlus className="mr-1 size-3.5" />
          {t('Create')}
        </Button>
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('Cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
