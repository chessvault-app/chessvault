import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { dialogOpen } from '@/hooks/dialog-focus';
import { HOME_DESTINATIONS } from '@/home/destinations';
import { SECTION_ICON } from '@/lib/sectionIcon';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * Open anything by name: a section, a study, a note, a game.
 *
 * Ctrl/⌘ K on a keyboard, the search button in Home's phone bar
 * otherwise (`openQuickSwitcher`). The pattern every tool of this kind
 * ships (Linear, Notion, GitHub, and Obsidian's quick switcher, which is
 * the nearest relative: a vault's documents by name) and the one this
 * app lacked. The `?` sheet listed eight board keys; nothing reached a
 * document without a shelf and a scroll.
 *
 * What it lists is what the links index already knows: every note, study
 * and game in the vault, by id, from the scan the wiki links are resolved
 * against (`/api/links/index`), fetched when the window opens so the list
 * is as fresh as the vault. Sections come from the same catalogue Home's
 * tiles use. cmdk does the matching.
 *
 * It is the app's own DialogContent, not the registry's CommandDialog: a
 * sheet on a phone, Escape and the scrim on a desktop, and no second
 * dialog with physics of its own (see components/ui/command).
 */

const OPEN_EVENT = 'chess-vault:quick-switcher';

/** Open it from a button; the keyboard reaches it on its own. */
export function openQuickSwitcher(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Section = 'notes' | 'studies' | 'games';
const DOCUMENT_SECTIONS: { section: Section; heading: string }[] = [
  { section: 'studies', heading: 'Studies' },
  { section: 'notes', heading: 'Notes' },
  { section: 'games', heading: 'Games' },
];

export function QuickSwitcher() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<Record<Section, readonly string[]> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'k' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      // An open window owns the keyboard, this one included.
      if (dialogOpen()) return;
      e.preventDefault();
      setOpen(true);
    };
    const onOpen = (): void => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Fetched on each open: the vault may have gained a note since.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api<{ index: Record<Section, readonly string[]> }>('/api/links/index')
      .then((r) => {
        if (!cancelled) setIndex(r.index);
      })
      .catch(() => {
        // The sections still list; documents wait for the next open.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const go = (fn: () => void): void => {
    setOpen(false);
    fn();
  };

  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <DialogContent className="p-0" aria-label={t('Open anything')}>
        <Command loop>
          <CommandInput placeholder={t('Open anything…')} />
          <CommandList>
            <CommandEmpty>{t('Nothing by that name.')}</CommandEmpty>
            <CommandGroup heading={t('Go to')}>
              {HOME_DESTINATIONS.map((d) => (
                <CommandItem key={d.id} value={`${t(d.label)} ${d.label}`} onSelect={() => go(() => navigate(...d.nav))}>
                  <d.icon />
                  {t(d.label)}
                </CommandItem>
              ))}
            </CommandGroup>
            {index &&
              DOCUMENT_SECTIONS.map(({ section, heading }) => {
                const ids = index[section];
                if (!ids || ids.length === 0) return null;
                const Icon = SECTION_ICON[section];
                return (
                  <CommandGroup key={section} heading={t(heading)}>
                    {ids.map((id) => (
                      <CommandItem
                        key={id}
                        value={`${section} ${id}`}
                        onSelect={() => go(() => navigate(section, encodeURIComponent(id)))}
                      >
                        <Icon />
                        <span className="truncate">{id}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
