import { Keyboard, Moon, PanelLeft, Rows3, Sun, SunMoon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { openShortcutsHelp } from '@/components/shortcuts-help';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
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
import { useMediaQuery } from '@/lib/media';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { usePrefs } from '@/store/prefs';
import { useRecentOpens } from '@/store/recent';
import { foldedFrom, useSidebar } from '@/store/sidebar';
import { useTheme } from '@/store/theme';

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
 *
 * Three things a palette of this kind carries that this one did not,
 * added together (the sources are Raycast's action panel, Linear's
 * Ctrl/⌘ K and the registry's own Command example):
 *
 * - **Recent**, first, while nothing is typed: the documents this device
 *   opened last (store/recent), named by the index's answer so a renamed
 *   or deleted one drops out on its own. Once a word is typed the list
 *   is the search's, and Recent gets out of the way.
 * - **Actions**, after the destinations: the verbs that are the app's
 *   rather than a page's, so they can run from anywhere without the
 *   page having to be told. The theme, the density, the sidebar's fold
 *   and the keyboard list. A page's own verbs (new study, import a
 *   game) stay on the page: reaching them from here would mean every
 *   shelf listening for an event, which is the plumbing this window
 *   exists to avoid needing.
 * - A **footer** of key hints on a desktop, where there are keys. None
 *   on a phone: the sheet is driven by touch and the band above the
 *   keyboard is the one strip it cannot spare.
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

  if (!open) return null;
  return (
    <QuickSwitcherWindow
      query={query}
      setQuery={setQuery}
      result={result}
      close={() => {
        setOpen(false);
        setQuery('');
        setResult(null);
      }}
    />
  );
}

/** The window itself, mounted only while open, so its hooks read fresh. */
function QuickSwitcherWindow({
  query,
  setQuery,
  result,
  close,
}: {
  query: string;
  setQuery: (q: string) => void;
  result: SearchResult | null;
  close: () => void;
}) {
  const go = (fn: () => void): void => {
    close();
    fn();
  };
  const sm = useMediaQuery('(min-width: 40rem)');
  const md = useMediaQuery('(min-width: 48rem)');
  const lg = useMediaQuery('(min-width: 64rem)');
  const recents = useRecentOpens((s) => s.opens);
  const theme = useTheme((s) => s.preference);
  const setTheme = useTheme((s) => s.setPreference);
  const density = usePrefs((s) => s.density);
  const setDensity = usePrefs((s) => s.setDensity);
  const choice = useSidebar((s) => s.choice);
  const setFolded = useSidebar((s) => s.setFolded);
  const folded = foldedFrom(choice, lg);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '\u2318' : 'Ctrl';

  const tokens = tokensOf(query);
  // The documents this device opened last, in that order, as the index
  // names them today. At most five, and only while nothing is typed.
  const recent =
    tokens.length > 0 || !result
      ? []
      : recents
          .map((r) => result.names.find((n) => n.section === r.section && n.id === r.id))
          .filter((n): n is NameHit => n !== undefined)
          .slice(0, 5);
  // The app's own verbs. Each says what it does to the state it changes,
  // and the one already in force is left out rather than shown checked:
  // a palette lists what can happen, not what is.
  const actions: { id: string; label: string; icon: typeof Sun; keys?: string[]; run: () => void }[] = [
    ...(md
      ? [
          folded
            ? { id: 'unfold', label: 'Unfold the sidebar', icon: PanelLeft, keys: [mod, 'B'], run: () => setFolded(false) }
            : { id: 'fold', label: 'Fold the sidebar', icon: PanelLeft, keys: [mod, 'B'], run: () => setFolded(true) },
        ]
      : []),
    ...(theme !== 'light' ? [{ id: 'light', label: 'Light theme', icon: Sun, run: () => setTheme('light') }] : []),
    ...(theme !== 'dark' ? [{ id: 'dark', label: 'Dark theme', icon: Moon, run: () => setTheme('dark') }] : []),
    ...(theme !== 'system'
      ? [{ id: 'system', label: 'Follow the system theme', icon: SunMoon, run: () => setTheme('system') }]
      : []),
    density === 'compact'
      ? { id: 'comfortable', label: 'Comfortable density', icon: Rows3, run: () => setDensity('comfortable') }
      : { id: 'compact', label: 'Compact density', icon: Rows3, run: () => setDensity('compact') },
    { id: 'keys', label: 'Keyboard shortcuts', icon: Keyboard, keys: ['?'], run: openShortcutsHelp },
  ].filter((a) => {
    if (tokens.length === 0) return true;
    const name = `${t(a.label)} ${a.label}`.normalize('NFC').toLowerCase();
    return tokens.every((w) => name.includes(w));
  });
  const destinations = HOME_DESTINATIONS.filter((d) => {
    if (tokens.length === 0) return true;
    const name = `${t(d.label)} ${d.label}`.normalize('NFC').toLowerCase();
    return tokens.every((w) => name.includes(w));
  });
  const names = result
    ? DOCUMENT_SECTIONS.flatMap(({ section }) => result.names.filter((n) => n.section === section))
    : [];
  const content = result?.content ?? [];

  // Which row Enter opens, held here rather than left to cmdk.
  //
  // cmdk keeps its own selection and moves it to the first row when the
  // QUERY changes; it does not move it when the ROWS change under a query
  // that has not. Here the rows arrive later than the query (the debounce
  // and the round trip), so the row it picked at the last keystroke was
  // one of the previous answer's, and when the new answer replaced that
  // list the selection pointed at a row that was gone: two rows on
  // screen, none of them highlighted, and Enter opening nothing. Measured
  // at every typing pace with a 120ms server, and with no latency at all
  // for a word whose answer differs from the last letter's. cmdk's
  // unmount hook does re-select, but only when the LAST row to unmount
  // was the selected one, which is one row out of the whole list.
  //
  // So the value is controlled: cmdk reports the row the keys or the
  // pointer chose, and whenever the rows rendered no longer include it
  // the first of them is chosen, which is what a fresh query gets too.
  const [value, setValue] = useState('');
  const values = [
    ...recent.map((hit) => `recent ${hit.section} ${hit.id}`),
    ...destinations.map((d) => `go ${d.id}`),
    ...actions.map((a) => `action ${a.id}`),
    ...names.map((hit) => `${hit.section} ${hit.id}`),
    ...content.map((hit) => `text ${hit.section} ${hit.id}`),
  ];
  // The list as one string, so a same list is a same dependency.
  const rendered = values.join('\n');
  useLayoutEffect(() => {
    if (values.includes(value)) return;
    setValue(values[0] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, value]);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
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
        <Command
          loop
          shouldFilter={false}
          value={value}
          onValueChange={setValue}
          className="max-sm:min-h-0 max-sm:flex-1 max-sm:p-0"
        >
          <CommandInput placeholder={t('Open anything…')} value={query} onValueChange={setQuery} />
          <CommandList className="max-sm:min-h-0 max-sm:max-h-none max-sm:flex-1">
            <CommandEmpty>{t('Nothing matches.')}</CommandEmpty>
            {recent.length > 0 && (
              <CommandGroup heading={t('Recent')}>
                {recent.map((hit) => {
                  const Icon = SECTION_ICON[hit.section];
                  return (
                    <CommandItem
                      key={`recent ${hit.section} ${hit.id}`}
                      value={`recent ${hit.section} ${hit.id}`}
                      onSelect={() => go(() => openHit(hit))}
                    >
                      <Icon />
                      <span data-user-text className="truncate">
                        {hit.title}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
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
            {actions.length > 0 && (
              <CommandGroup heading={t('Actions')}>
                {actions.map((a) => (
                  <CommandItem key={a.id} value={`action ${a.id}`} onSelect={() => go(a.run)}>
                    <a.icon />
                    {t(a.label)}
                    {a.keys && sm && (
                      <span className="ml-auto flex items-center gap-1">
                        {a.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {result &&
              DOCUMENT_SECTIONS.map(({ section, heading }) => {
                const hits = names.filter((n) => n.section === section);
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
            {content.length > 0 && (
              <CommandGroup heading={t('In the text')}>
                {content.map((hit) => {
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
          {/* The keys, where there are keys. The registry's own example
              ends its palette this way; the strip takes the card ring the
              dialog's footer band takes. */}
          {sm && (
            <div className="border-card-ring text-muted-foreground flex items-center gap-4 border-t px-3 pt-2 pb-1 text-xs">
              <span className="flex items-center gap-1.5">
                <Kbd>{'\u2191'}</Kbd>
                <Kbd>{'\u2193'}</Kbd>
                {t('Move')}
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>{'\u21b5'}</Kbd>
                {t('Open')}
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>Esc</Kbd>
                {t('Close')}
              </span>
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
