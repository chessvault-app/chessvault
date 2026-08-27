import { Folder as FolderIcon, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ActionMenu } from '@/components/action-menu';
import { Button } from '@/components/ui/button';
import { PromptDialog } from '@/components/prompt-dialog';
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

  return (
    <div className="group/folder flex h-6 items-center gap-1.5">
      <FolderIcon className="text-muted-foreground size-3.5 shrink-0" />
      <button
        type="button"
        onDoubleClick={() => setRenaming(true)}
        title={t('Double-click to rename')}
        className="text-muted-foreground text-sm font-medium"
      >
        {folder}
      </button>
      {renaming && (
        <PromptDialog
          label={t('Rename this collection')}
          initial={folder}
          onSubmit={(value) => {
            setRenaming(false);
            if (value !== folder) void onRename(value).then(setFailure);
          }}
          onClose={() => setRenaming(false)}
        />
      )}
      <ActionMenu
        title={folder}
        open={menuOpen}
        onOpenChange={setMenuOpen}
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
        detail={
          // No horizontal padding of its own: each container indents a
          // detail to ITS text column — the dropdown to its label, the
          // sheet to its title — and a number written here for one of
          // them is an indent bug in the other (it was px-3, and the
          // sheet showed the note 12px right of its own heading).
          !empty && (
            <p className="text-muted-foreground pb-2 text-sm">
              {t('Only empty collections can be deleted')}
            </p>
          )
        }
      >
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('More')}
          active={menuOpen}
          className="opacity-0 transition-opacity group-hover/folder:opacity-100 pointer-coarse:opacity-100"
        >
          <MoreHorizontal className="size-3" />
        </Button>
      </ActionMenu>

      {failure && <span className="text-destructive text-sm">{failure}</span>}
    </div>
  );
}
