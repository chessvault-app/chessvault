import { useState, useSyncExternalStore } from 'react';
import { FileText, FolderOpen, Swords } from 'lucide-react';
import type { LinkSection } from '@shared/wikiLinks';
import { validId } from '@shared/vaultNames';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { SECTION_URL, wikiUnresolved } from './wikiDocs';

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
 * Broken means nothing answers to it, which is most often a document not
 * made yet — writing the link before the thing it names is a normal way to
 * work. So the offer is to make it, in whichever of the three kinds was
 * meant, since all three can be named by a link and a comment on a move is
 * as likely to want a study as a note.
 */

const ICON: Record<LinkSection, typeof FileText> = {
  notes: FileText,
  studies: FolderOpen,
  games: Swords,
};

/**
 * The order the offers are made in: the app's own menu order, from the
 * sidebar in App.tsx.
 *
 * Deliberately NOT the resolution order, which runs notes, studies, games
 * and is about which document a name would find first. Nothing is being
 * resolved here — nothing answers to the name at all — so the only order
 * that means anything to the reader is the one they already navigate by.
 */
const CREATE_ORDER = ['games', 'studies', 'notes'] as const;

/** What each kind of document is called when it does not exist yet. */
const CREATE_LABEL: Record<LinkSection, string> = {
  games: 'Start a game called “{name}”',
  studies: 'Start a study called “{name}”',
  notes: 'Write a note called “{name}”',
};

export function WikiUnresolved() {
  const store = wikiUnresolved;
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [creating, setCreating] = useState(false);

  if (!snapshot) return null;
  const { target, why, candidates } = snapshot;

  const open = (section: LinkSection, id: string): void => {
    store.close();
    navigate(section, encodeURIComponent(id));
  };

  // A target that could not be a document name cannot be created as one
  // either — the same rule the server enforces, asked before offering.
  const creatable = why === 'broken' && validId(target.trim());

  const create = async (section: LinkSection): Promise<void> => {
    const name = target.trim();
    setCreating(true);
    try {
      // Name only: what a fresh document of each kind holds is the server's
      // answer — a heading for a note, one empty chapter for a study or a
      // game — and it was spelled out here as well, which is two places to
      // disagree about what "new" means. The copy here also got a nested
      // name wrong, heading a note `a/b` where the server heads it `b`.
      await api(SECTION_URL[section], { method: 'POST', json: { name } });
      store.close();
      navigate(section, encodeURIComponent(name));
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
        {/* All three, because all three can be linked. Offering only a note
            was right while a note was the only thing that could HOLD a
            link; now a comment on a move can name a study nobody has
            started, and answering that with "shall I make a note?" resolves
            the link to the wrong kind of document — quietly, and for good,
            since from then on it resolves. */}
        {creatable &&
          CREATE_ORDER.map((section) => {
            const Icon = ICON[section];
            return (
              <button
                key={section}
                type="button"
                disabled={creating}
                onClick={() => void create(section)}
                className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
              >
                {/* The section's own icon rather than three identical
                    plusses: which of the three this row makes is the whole
                    difference between them, and it is what the sentence
                    ends up saying twice otherwise. */}
                <Icon className="text-muted-foreground size-3.5 shrink-0" />
                {t(CREATE_LABEL[section], { name: target.trim() })}
              </button>
            );
          })}
        {/* Why there is nothing to press. This window exists to end a dead
            end, and a name the vault cannot hold — a colon, a reserved
            word, something far too long — reached it and got the sentence
            above with no offer at all: the same empty window, by a
            different route. */}
        {why === 'broken' && !creatable && (
          <p className="text-muted-foreground text-sm">
            {t('That name cannot be a document name, so there is nothing to create.')}
          </p>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
