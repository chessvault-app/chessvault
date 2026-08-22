import { Folder as FolderIcon, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { ActionSheet } from './ActionSheet';
import { Button } from './Button';
import { PromptSheet } from './PromptSheet';
import { t } from '@/lib/i18n';

/**
 * A collection's heading on a shelf, with the two things you can do to it.
 *
 * Shared because the two shelves had drifted: a studies collection could be
 * renamed and deleted from its heading, and an identical-looking notes
 * collection could only be looked at — which made renaming one a job for
 * the filesystem, and there is no filesystem in this app.
 *
 * Deleting is refused while the collection still holds anything. That is
 * the server's rule (never delete documents by side effect), said here
 * before it is pressed rather than after.
 */
export function ShelfFolderHeader({
  folder,
  empty,
  onRename,
  onDelete,
}: {
  folder: string;
  empty: boolean;
  /** Resolves to an error to show, or null. */
  onRename: (next: string) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div className="group/folder flex h-6 items-center gap-1.5">
      <FolderIcon className="text-subtle size-3.5 shrink-0" />
      <button
        type="button"
        onDoubleClick={() => setRenaming(true)}
        title={t('Double-click to rename')}
        className="text-subtle text-sm label-caps"
      >
        {folder}
      </button>
      {renaming && (
        <PromptSheet
          label={t('Rename this collection')}
          initial={folder}
          onSubmit={(value) => {
            setRenaming(false);
            if (value !== folder) void onRename(value).then(setFailure);
          }}
          onClose={() => setRenaming(false)}
        />
      )}
      <Button
        ref={trigger}
        variant="ghost"
        size="icon-sm"
        title={t('More')}
        active={menuOpen}
        className="opacity-0 transition-opacity group-hover/folder:opacity-100 pointer-coarse:opacity-100"
        onClick={() => setMenuOpen(true)}
      >
        <MoreHorizontal className="size-3" />
      </Button>

      {menuOpen && (
        <ActionSheet
          title={folder}
          anchor={trigger}
          onClose={() => setMenuOpen(false)}
          actions={[
            { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
            ...(empty
              ? [
                  {
                    label: 'Delete this collection',
                    icon: Trash2,
                    danger: true,
                    onSelect: () => {
                      void onDelete().then((err) => {
                        setFailure(err);
                        // A refusal is worth reading once, not forever.
                        if (err) setTimeout(() => setFailure(null), 5000);
                      });
                    },
                  },
                ]
              : []),
          ]}
        >
          {!empty && (
            <p className="text-subtle px-3 pb-2 text-sm">
              {t('Only empty collections can be deleted')}
            </p>
          )}
        </ActionSheet>
      )}

      {failure && <span className="text-destructive text-sm">{failure}</span>}
    </div>
  );
}
