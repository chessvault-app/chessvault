import { useEffect, useRef, useState } from 'react';
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
import { SECTION_ICON, type IconSection } from '@/lib/sectionIcon';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * Open anything by name, or by what it says.
 *
 * Ctrl/⌘ K on a keyboard, the search button in Home's phone bar
 * otherwise (`openQuickSwitcher`). The pattern every tool of this kind
 * ships (Linear, Notion, GitHub, and Obsidian's quick switcher, which is
 * the nearest relative: a vault's documents by name) and the one this
 * app lacked. The `?` sheet listed eight board keys; nothing reached a
 * document without a shelf and a scroll.
 *
 * It asks the server (`/api/search`, server/search.ts) rather than
 * matching in the page: the names alone came from the link scan and
 * cmdk filtered them here, but a note's body or a study's comments are
 * the vault's prose, and reading every document into the page on each
 * open is what a server-side index exists to avoid. So cmdk does no
 * filtering of its own (`shouldFilter={false}`): what the server ranks
 * is what is listed, names first and then the documents whose text
 * holds the words, each with the sentence they sit in. Sections come
 * from the same catalogue Home's tiles use and are the one thing
 * matched in the page, since they are eleven words.
 *
 * Typing is debounced so a phone does not send a request per
 * keystroke, and an answer that arrives after a later one is dropped.
 * The previous answer stays on screen until the next lands, so the
 * list does not blink empty between letters.
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

/** How long typing rests before the vault is asked. */
const DEBOUNCE_MS = 150;

interface NameHit {
  section: IconSection;
  id: string;
  title: string;
}
interface ContentHit extends NameHit {
  snippet: { before: string; match: string; after: string };
  chapter?: number;
}
interface SearchResult {
  names: NameHit[];
  content: ContentHit[];
}

const DOCUMENT_SECTIONS: { section: IconSection; heading: string }[] = [
  { section: 'studies', heading: 'Studies' },
  { section: 'notes', heading: 'Notes' },
  { section: 'games', heading: 'Games' },
  { section: 'books', heading: 'Books' },
  { section: 'puzzlebooks', heading: 'Puzzle books' },
];

/** Land on the document a hit names, and on its chapter when it says one. */
function openHit(hit: NameHit & { chapter?: number }): void {
  switch (hit.section) {
    case 'books':
      navigate('books', hit.id);
      return;
    case 'puzzlebooks':
      navigate('puzzles', 'books', hit.id);
      return;
    default: {
      const id = encodeURIComponent(hit.id);
      if (hit.chapter !== undefined) navigate(hit.section, id, String(hit.chapter));
      else navigate(hit.section, id);
    }
  }
}

/** The words typed, folded the way the server folds them. */
const tokensOf = (query: string): string[] =>
  query
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);

export function QuickSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  // Which request is the latest; an older answer is dropped.
  const request = useRef(0);

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

  // Asked on each open and after each pause in typing: the vault may have
  // gained a note since, and the index follows the files by mtime.
  useEffect(() => {
    if (!open) return;
    const id = (request.current += 1);
    const ask = (): void => {
      void api<SearchResult>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (request.current === id) setResult(r);
        })
        .catch(() => {
          // The sections still list; documents wait for the next request.
        });
    };
    // The first request of an open goes at once; typing waits.
    const timer = window.setTimeout(ask, query ? DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const go = (fn: () => void): void => {
    setOpen(false);
    setQuery('');
    setResult(null);
    fn();
  };

  if (!open) return null;

  const tokens = tokensOf(query);
  const destinations = HOME_DESTINATIONS.filter((d) => {
    if (tokens.length === 0) return true;
    const name = `${t(d.label)} ${d.label}`.normalize('NFC').toLowerCase();
    return tokens.every((w) => name.includes(w));
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          setOpen(false);
          setQuery('');
          setResult(null);
        }
      }}
    >
      {/* p-0 from sm: the registry's palette, a Command wearing the card's
          own padding. On a phone the card keeps its px-4, because the
          grabber strip reaches through exactly that much (-mx-4): with
          p-0 the strip stood 16px proud of each edge, the card became a
          horizontal scroller, and on an iPhone the input and the rows ran
          off the right of the screen. `fill`: the sheet opens as tall as
          the band allows (the visible room above the keyboard, which the
          sole field raises as the sheet opens), and the Command and its
          list grow into it instead of the registry's 288px cap, which
          had the sheet stopping at about half the screen with sixty rows
          scrolling in a box. */}
      <DialogContent className="sm:p-0" fill aria-label={t('Open anything')}>
        <Command loop shouldFilter={false} className="max-sm:min-h-0 max-sm:flex-1 max-sm:p-0">
          <CommandInput placeholder={t('Open anything…')} value={query} onValueChange={setQuery} />
          <CommandList className="max-sm:min-h-0 max-sm:max-h-none max-sm:flex-1">
            <CommandEmpty>{t('Nothing matches.')}</CommandEmpty>
            {destinations.length > 0 && (
              <CommandGroup heading={t('Go to')}>
                {destinations.map((d) => (
                  <CommandItem key={d.id} value={`go ${d.id}`} onSelect={() => go(() => navigate(...d.nav))}>
                    <d.icon />
                    {t(d.label)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {result &&
              DOCUMENT_SECTIONS.map(({ section, heading }) => {
                const hits = result.names.filter((n) => n.section === section);
                if (hits.length === 0) return null;
                const Icon = SECTION_ICON[section];
                return (
                  <CommandGroup key={section} heading={t(heading)}>
                    {hits.map((hit) => (
                      <CommandItem
                        key={hit.id}
                        value={`${section} ${hit.id}`}
                        onSelect={() => go(() => openHit(hit))}
                      >
                        <Icon />
                        {/* The document's own name, so a long press
                            selects it (index.css). */}
                        <span data-user-text className="truncate">
                          {hit.title}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            {result && result.content.length > 0 && (
              <CommandGroup heading={t('In the text')}>
                {result.content.map((hit) => {
                  const Icon = SECTION_ICON[hit.section];
                  return (
                    <CommandItem
                      key={`${hit.section} ${hit.id}`}
                      value={`text ${hit.section} ${hit.id}`}
                      onSelect={() => go(() => openHit(hit))}
                    >
                      <Icon />
                      <span data-user-text className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{hit.title}</span>
                        {/* The sentence the words sit in, the match set
                            apart in weight rather than colour so it
                            reads the same in every theme. */}
                        <span className="truncate text-xs text-muted-foreground">
                          {hit.snippet.before}
                          <mark className="bg-transparent font-medium text-foreground">{hit.snippet.match}</mark>
                          {hit.snippet.after}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
