import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { FileText, FolderOpen, Plus, Swords } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { LinkSection } from '@shared/wikiLinks';
import { validId } from '@shared/vaultNames';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { wikiUnresolvedStore } from './wikiLink';

/**
 * What to do about a link that named nothing.
 *
 * Both ways a link can fail used to end in silence: pressing it did
 * nothing at all and the reason went to the console. That is a dead end,
 * and both failures have an answer the reader can act on.
 *
 * Ambiguous means the vault holds more than one candidate and only the
 * writer knows which. The app still refuses to pick — that part was
 * right — but it can show what it found and let them say. Choosing here
 * only opens the document; it does not rewrite the link, because that is
 * an edit to the note and this is a reader's dialog. The writer disam-
 * biguates by typing a longer name, which the suggester will complete.
 *
 * Broken means nothing answers to it, which in a vault of notes is most
 * often a note not written yet — writing the link before the note is a
 * normal way to work. So the offer is to make it.
 */

const ICON: Record<LinkSection, typeof FileText> = {
  notes: FileText,
  studies: FolderOpen,
  games: Swords,
};

export function WikiUnresolved({ editor }: { editor: Editor | null }) {
  const store = useMemo(() => (editor ? wikiUnresolvedStore(editor) : null), [editor]);
  const subscribe = useCallback((fn: () => void) => store?.subscribe(fn) ?? (() => {}), [store]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store?.snapshot() ?? null,
    () => null,
  );
  const [creating, setCreating] = useState(false);

  if (!store || !snapshot) return null;
  const { target, why, candidates } = snapshot;

  const open = (section: LinkSection, id: string): void => {
    store.close();
    navigate(section, encodeURIComponent(id));
  };

  // A target that could not be a document name cannot be created as one
  // either — the same rule the server enforces, asked before offering.
  const creatable = why === 'broken' && validId(target.trim());

  const create = async (): Promise<void> => {
    const name = target.trim();
    setCreating(true);
    try {
      await api('/api/notes', { method: 'POST', json: { name, pgn: `# ${name}\n` } });
      store.close();
      navigate('notes', encodeURIComponent(name));
    } catch {
      // Left open, so the press is not silently swallowed a second time.
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && store.close()}>
      <DialogContent
        size="sm"
        title={why === 'ambiguous' ? t('Which one?') : t('Nothing is named this')}
      >
        {/* The spacing goes on a wrapper, never on the card. The card's
            sticky header reaches 14px DOWN under the content below it and
            relies on the card's own gap-4 to put that back; overriding the
            gap with anything smaller makes the sum negative and slides the
            first line up underneath the title. */}
        <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">
          {why === 'ambiguous'
            ? t('More than one document answers to “{name}”.', { name: target })
            : t('Nothing in the vault answers to “{name}”.', { name: target })}
        </p>
        {candidates.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {candidates.map(({ section, id }) => {
              const Icon = ICON[section];
              return (
                <li key={`${section}:${id}`}>
                  <button
                    type="button"
                    onClick={() => open(section, id)}
                    className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Icon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate">{id}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {creatable && (
          <button
            type="button"
            disabled={creating}
            onClick={() => void create()}
            className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            <Plus className="text-muted-foreground size-3.5 shrink-0" />
            {t('Write a note called “{name}”', { name: target.trim() })}
          </button>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
