import { Folder as FolderIcon, CornerDownRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Input } from './Input';
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
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {targets.map((target) => (
          <button
            key={target || '(root)'}
            type="button"
            onClick={() => onPick(target)}
            className={cn(
              'hover:bg-surface-2 flex w-full items-center gap-2 rounded-md px-2 py-2',
              'text-left text-sm transition-colors duration-100',
            )}
          >
            <FolderIcon className="text-subtle size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{target || t('(no collection)')}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Input
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
          variant="ghost"
          size="icon-sm"
          title={t('Move into this new collection')}
          disabled={!draft.trim()}
          onClick={pickNew}
        >
          <CornerDownRight className="size-3.5" />
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
