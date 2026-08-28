import { Bookmark, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cachedCollection, forgetCollection, loadCollection } from './collection';

import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Disclosure } from '@/components/disclosure';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { autoFocusField, useMediaQuery } from '@/lib/media';
import { navigate } from '@/lib/router';

import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/segmented';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';

import { ClearableInput } from '@/components/text-fields';
import { Textarea } from '@/components/ui/textarea';

import { Panel } from '@/components/panel';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Fab } from '@/components/fab';
import { useUndoable } from '@/hooks/use-undoable';

import { t } from '@/lib/i18n';
import type { FilterConstraints } from '@shared/searchQuery';
import { GamePreview, docId, gameKey, type GameSummary, type Preview } from './shared';
import { CollectionList, customName } from './CollectionList';
import {
  catalogSuggest,
  QueryBox,
  SearchQueryIssues,
  type ValueSuggestion,
} from './GameFilters';
import { GameDetailsPanel, type DetailsSelection } from './GameDetails';
import { ArchiveBrowser } from './ArchiveBrowser';
import { DatabaseGames, positionHuntPending } from './DatabaseGames';

/** The page's tabs, at EVERY width: the reference databases lead —
    since the search work they are the strongest surface on this page —
    the collection beside them, and the two online archives each as
    their own tab (one tab per site keeps the archive's toolbar as
    short as the others'; the strip is the provider choice). Width
    changes the dressing, not the structure: lg adds the details
    column and turns the rows into the table. */
type MainTab = 'databases' | 'collection' | 'chesscom' | 'lichess';
const TABS: { id: MainTab; label: string }[] = [
  { id: 'databases', label: 'Databases' },
  { id: 'collection', label: 'Collection' },
  // Site names, not sentences — they stay untranslated on purpose.
  // Capitalised like its neighbours: a lowercase word in a row of
  // capitalised tabs read as a typo, not as branding.
  { id: 'chesscom', label: 'Chess.com' },
  { id: 'lichess', label: 'Lichess' },
];

/** Which tab is showing, held OUTSIDE the component for the archive's
    reason (see useArchiveBrowse): opening a game navigates to the
    Board and unmounts this view, and coming back must land on the tab
    that was left. */
let heldTab: MainTab | null = null;

/**
 * The collection: games deliberately kept for reference, each annotatable.
 * chess.com history is browsed month by month below and promoted per game.
 */
export function CollectionView() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [markedOnly, setMarkedOnly] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** The query-language panel under the collection search, open while
      the box has focus. */
  const [searchHintsOpen, setSearchHintsOpen] = useState(false);
  // The collection list's active filters, reported upward so the
  // warning box beside the query can judge the two surfaces together.
  const [colConstraints, setColConstraints] = useState<FilterConstraints | undefined>(undefined);
  /** Live values for the panel: players and events aggregate from the
      rows already in the page; openings and ECO come from the vendored
      catalogue, same as everywhere. */
  const suggestCollection = useCallback(
    async (field: string, value: string): Promise<ValueSuggestion[]> => {
      if (field === 'opening' || field === 'eco') return catalogSuggest(field, value);
      // An empty value still counts — the panel opens on the
      // collection's most frequent names before a character is typed.
      const v = value.trim().toLowerCase();
      const counted = new Map<string, number>();
      if (field === 'event') {
        for (const g of games) {
          if (g.event && g.event.toLowerCase().includes(v))
            counted.set(g.event, (counted.get(g.event) ?? 0) + 1);
        }
      } else if (['player', 'opponent', 'white', 'black'].includes(field)) {
        for (const g of games) {
          for (const name of field === 'white'
            ? [g.white]
            : field === 'black'
              ? [g.black]
              : [g.white, g.black]) {
            if (name.toLowerCase().startsWith(v)) counted.set(name, (counted.get(name) ?? 0) + 1);
          }
        }
      }
      return [...counted]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([name, n]) => ({ v: name, desc: t('{n} games', { n: String(n) }) }));
    },
    [games],
  );
  const [importing, setImporting] = useState(false);
  /** Which tab the pane is showing. A handed-over position lands on
      Databases whatever was held — that is what it is for, and with
      the tabs at every width the phone consumes the handoff the same
      way the desktop does. */
  const [tab, setTabState] = useState<MainTab>(() =>
    positionHuntPending() ? 'databases' : (heldTab ?? 'databases'),
  );
  /** The details panel's subject, per tab: the collection remembers a
      KEY and re-resolves it against the live array (load() replaces
      the objects after a rename or a reload); the database pane hands
      a packaged selection of its own. Switching tabs clears both. */
  const [colSelKey, setColSelKey] = useState<string | null>(null);
  const [dbSel, setDbSel] = useState<DetailsSelection | null>(null);
  const [archSel, setArchSel] = useState<DetailsSelection | null>(null);
  const setTab = (next: MainTab): void => {
    heldTab = next;
    setTabState(next);
    setColSelKey(null);
    setDbSel(null);
    setArchSel(null);
  };
  // Width changes the dressing of the ONE layout: at lg the rows are
  // the dense table and the details column stands beside the pane;
  // below, the same tabs hold card rows and details open as a sheet
  // from a row's own menu. A flag rather than classes because a
  // display-none details panel would still resolve selections.
  const wide = useMediaQuery('(min-width: 64rem)');

  // A write invalidates, so `load` always goes to the server; the cached
  // copy is what fills the screen while it does.
  const load = useCallback(async (): Promise<void> => {
    forgetCollection();
    try {
      setGames(await loadCollection());
      setLoaded(true);
    } catch {
      setError(t('vault server unreachable'));
    }
  }, []);

  useEffect(() => {
    const cached = cachedCollection();
    if (cached) {
      setGames(cached);
      setLoaded(true);
    }
    void loadCollection()
      .then((games) => {
        setGames(games);
        setLoaded(true);
      })
      .catch(() => setError(t('vault server unreachable')));
    void api<{ keys: string[] }>('/api/games/bookmarks')
      .then((b) => setBookmarks(new Set(b.keys)))
      .catch(() => {});
  }, [load]);

  const toggleBookmark = async (game: GameSummary): Promise<void> => {
    let key: string;
    let bookmarked: boolean;
    try {
      ({ key, bookmarked } = await api<{ key: string; bookmarked: boolean }>(
        '/api/games/bookmarks/toggle',
        { method: 'POST', json: { file: game.file, index: game.index } },
      ));
    } catch {
      return; // as before: a toggle that fails leaves the star as it was
    }
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (bookmarked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  // Renaming, like notes and studies: a prompt sheet, and the doc id IS
  // the file name. An empty value is the sheet closing without an answer.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  // The row goes at once; the DELETE waits for the undo to expire.
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const dropGame = (game: GameSummary): void => {
    const key = gameKey(game);
    const unhide = (): void =>
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    setHidden((prev) => new Set(prev).add(key));
    undoable.remove(customName(game) ?? docId(game), () => void removeGame(game).then(unhide), unhide);
  };
  const renameGame = async (game: GameSummary, to: string): Promise<void> => {
    setRenamingKey(null);
    const from = docId(game);
    const next = to.trim();
    if (!next || next === from) return;
    try {
      await api('/api/games/docs/move', { method: 'POST', json: { from, to: next } });
    } catch (failure) {
      setError(t(apiErrorMessage(failure)));
    }
    void load();
  };

  const removeGame = async (game: GameSummary): Promise<void> => {
    const id = docId(game);
    try {
      await api(`/api/games/docs/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      // Caught so the undo path still unhides the row (see dropGame): a
      // delete that never landed must not leave the game invisible. The
      // reload below shows the truth either way.
    }
    void load();
  };

  const openGame = (game: GameSummary): void => {
    const id = docId(game);
    navigate('games', encodeURIComponent(id));
  };

  // The rows memoise on primitives — see CollectionRow. These forward
  // through a ref to the LATEST handlers, so their identity never changes
  // while their closures stay fresh (a bookmark toggle used to re-render
  // every row in the list; now it re-renders the one that changed).
  const rowHandlers = useRef({ dropGame, toggleBookmark, renameGame, openGame });
  rowHandlers.current = { dropGame, toggleBookmark, renameGame, openGame };
  const rowOpen = useCallback((g: GameSummary) => rowHandlers.current.openGame(g), []);
  const rowDrop = useCallback((g: GameSummary) => rowHandlers.current.dropGame(g), []);
  const rowBookmark = useCallback(
    (g: GameSummary) => void rowHandlers.current.toggleBookmark(g),
    [],
  );
  const rowRename = useCallback(
    (g: GameSummary, to: string) => void rowHandlers.current.renameGame(g, to),
    [],
  );

  // Built once and shared: the archive renders twice (beside the
  // collection, and in the phone's window) and each copy needs it.
  const collectionKeys = new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`));

  /**
   * Search, then the bookmark switch — the pair that narrows the
   * collection, living in the Collection tab's toolbar at every width.
   */
  const finders = (fieldClass: string): ReactNode => (
    <>
      {/* The same query language the databases box speaks — one
          parser in shared/, one chip box teaching it. */}
      <QueryBox
        query={query}
        onQuery={setQuery}
        suggest={suggestCollection}
        placeholder={t('Search collection…')}
        onOpenChange={setSearchHintsOpen}
        className={fieldClass}
      />
      {/* Icon only, like the shelves': the word Bookmarked beside it was
          the only label in any of them, and a pressed state says the same
          thing without asking for the width. */}
      <Button
        variant="secondary"
        size="icon-sm"
        active={markedOnly}
        aria-pressed={markedOnly}
        title={markedOnly ? t('Show all games') : t('Show bookmarked games only')}
        className="shrink-0"
        onClick={() => setMarkedOnly((v) => !v)}
      >
        <Bookmark className={cn('size-3.5', markedOnly && 'fill-warn text-warn')} />
      </Button>
    </>
  );

  // The collection's selection, re-resolved against the live array on
  // every render: load() replaces the objects after a rename or remove,
  // so the KEY is what survives — a key that no longer resolves (the
  // game was renamed or removed) empties the panel, which is the truth.
  const colSelGame =
    tab === 'collection' && colSelKey
      ? (games.find((g) => gameKey(g) === colSelKey) ?? null)
      : null;
  const selection: DetailsSelection | null =
    tab === 'collection'
      ? colSelGame
        ? {
            key: gameKey(colSelGame),
            summary: colSelGame,
            loadPgn: async () => {
              try {
                return (
                  await api<{ pgn: string }>(
                    `/api/games/pgn?file=${encodeURIComponent(colSelGame.file)}&index=${colSelGame.index}`,
                  )
                ).pgn;
              } catch {
                return null;
              }
            },
            actions: (
              // One row, primary rightmost — the app's button order
              // (dialog footers end on their primary). The secondary
              // verbs are icons with tooltips so all four fit the
              // panel's width on one line; the destructive one leads,
              // farthest from the primary.
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('Remove from the collection')}
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    dropGame(colSelGame);
                    setColSelKey(null);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('Rename')}
                  onClick={() => setRenamingKey(gameKey(colSelGame))}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={
                    bookmarks.has(gameKey(colSelGame)) ? t('Remove bookmark') : t('Bookmark')
                  }
                  onClick={() => void toggleBookmark(colSelGame)}
                >
                  <Bookmark
                    className={cn(
                      'size-3.5',
                      bookmarks.has(gameKey(colSelGame)) && 'fill-warn text-warn',
                    )}
                  />
                </Button>
                <Button variant="default" size="sm" onClick={() => openGame(colSelGame)}>
                  <Play className="size-3.5" data-icon="inline-start" />
                  {t('Open the game')}
                </Button>
              </>
            ),
          }
        : null
      : tab === 'databases'
        ? dbSel
        : archSel;

  return (
    <PageShell
      // xwide, not wide: at lg this page is a data table beside a
      // details column, and every extra pixel is another table column
      // shown instead of shed. Below lg no viewport reaches either cap.
      width="xwide"
      scroll={false}
      // Pinned at every width: the pane's lists scroll themselves (the
      // panel shape's own behaviour), so the page never scrolls — the
      // tab strip and the toolbar stay put while the rows move, on a
      // phone exactly as on the desktop.
      className="h-full overflow-hidden pb-3 sm:pb-4 md:pb-6"
    >
      <PageHeader title={t('Games')} />

      {importing && (
        <ImportGamePanel
          onDone={() => {
            setImporting(false);
            void load();
          }}
          onCancel={() => setImporting(false)}
        />
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* One tabbed pane at EVERY width — Databases first, the
          Collection beside it, the archives after. lg adds the details
          column and the table rows; below lg the same tabs hold card
          rows, and details open from a row's own menu. */}
      {/* minmax(0,1fr), not a bare fr: an fr track is min-content wide
          at its narrowest, so the table would silently refuse to shed
          columns. The details column keeps a floor a board is legible
          at and never grows past a reading width. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,23rem)]">
          <Panel className="min-h-0">
            {/* The pane's TITLE is the switch — the same line-Tabs strip
                the old source column used, for the same reason: naming
                the pane is what a header does, and the live tab is the
                header's own rule, thickened under the name showing. */}
            <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)} className="contents">
              {/* The SCROLLER is a wrapper, never the list itself. Four
                  labels just fit a 375px phone in Korean and brush the
                  edge in English, so the strip must scroll sideways —
                  but the registry's line tabs draw their 40px triggers
                  and the active underline OVERFLOWING the list's own
                  32px box, and a list turned scroll container clipped
                  them (first symptom: the underline vanished under the
                  new scrollbar; hidden bar, it was still losing its
                  lower pixels to the clip). box-content h-10: the
                  wrapper's CONTENT box matches the triggers exactly, so
                  nothing is clipped and the underline ends flush on the
                  border. */}
              <div className="border-border scrollbar-hidden box-content flex h-10 shrink-0 items-center overflow-x-auto overflow-y-hidden border-b">
                <TabsList
                  variant="line"
                  aria-label={t('What the pane is showing')}
                  className="flex w-max min-w-full items-center justify-start gap-1 rounded-none border-0 bg-transparent p-0 px-2"
                >
                  {TABS.map(({ id, label }) => (
                    <TabsTrigger
                      key={id}
                      value={id}
                      // after:bottom-0, not the -bottom-px the other
                      // line tabs use: inside the scrolling wrapper the
                      // underline cannot overlap the border without
                      // being clipped, so it sits ON the rule instead
                      // of thickening it — the same 2px to the eye.
                      className="h-10 min-w-0 flex-none rounded-none px-1.5 font-semibold group-data-horizontal/tabs:after:bottom-0"
                    >
                      <span className="truncate">{t(label)}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>
            {tab === 'databases' ? (
              <DatabaseGames
                shape="panel"
                table={wide}
                onSelect={setDbSel}
                selectedKey={dbSel?.key ?? null}
              />
            ) : tab === 'chesscom' || tab === 'lichess' ? (
              <ArchiveBrowser
                table={wide}
                site={tab}
                collectionKeys={collectionKeys}
                onCollected={() => void load()}
                onPreview={setPreview}
                onSelect={setArchSel}
                selectedKey={archSel?.key ?? null}
              />
            ) : (
              <CollectionList
                table={wide}
                games={games}
                loaded={loaded}
                bookmarks={bookmarks}
                hidden={hidden}
                query={query}
                markedOnly={markedOnly}
                renamingKey={renamingKey}
                onStartRename={setRenamingKey}
                onOpen={rowOpen}
                onPreview={setPreview}
                onDrop={rowDrop}
                onToggleBookmark={rowBookmark}
                onRename={rowRename}
                onImport={() => setImporting(true)}
                onClearSearch={() => setQuery('')}
                onShowAll={() => setMarkedOnly(false)}
                toolbar={
                  <div className="flex w-full flex-col gap-2">
                    <div className="flex w-full items-center gap-1.5">
                      {finders('min-w-0 flex-1')}
                      {/* Import lives WITH the collection it grows: the
                          page-header button beside this big pane did not
                          stand out (lanph3re's report), and the empty
                          state already points here. Below md the FAB is
                          the import button, so this one steps aside
                          rather than crowd the phone's toolbar. */}
                      <Button
                        variant="default"
                        size="sm"
                        className="hidden shrink-0 md:inline-flex"
                        onClick={() => setImporting(true)}
                      >
                        <Plus className="size-3.5" data-icon="inline-start" strokeWidth={2.5} />
                        {t('Import a game')}
                      </Button>
                    </div>
                    <SearchQueryIssues
                      query={query}
                      pending={searchHintsOpen}
                      filters={colConstraints}
                    />
                  </div>
                }
                onSelect={(g) => setColSelKey(g ? gameKey(g) : null)}
                selectedKey={colSelKey}
                onFilterConstraints={setColConstraints}
              />
            )}
          </Panel>
          {/* The details column exists only where it has a column to
              stand in — mounted by the flag, not hidden by a class, so
              a phone never resolves selections for a panel nobody can
              see. */}
          {wide && <GameDetailsPanel selection={selection} />}
        </div>

      <GamePreview preview={preview} onClose={() => setPreview(null)} />

      {/* Getting a game IN, on a phone: one press, straight to the
          import sheet — the archives and databases that used to hide
          behind this button's menu are tabs on the page now, at every
          width. From md up the Collection toolbar's own Import button
          takes over and the disc is not drawn. */}
      <Fab
        actions={[{ label: 'Import a game', icon: Plus, onSelect: () => setImporting(true) }]}
        className="md:hidden"
      />
    </PageShell>
  );
}

/**
 * Manual import: paste a PGN (or bare moves) and optionally stamp the
 * metadata headers — provided fields override what the paste carries.
 */
function ImportGamePanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [pgn, setPgn] = useState('');
  const [white, setWhite] = useState('');
  const [black, setBlack] = useState('');
  const [whiteElo, setWhiteElo] = useState('');
  const [blackElo, setBlackElo] = useState('');
  const [date, setDate] = useState('');
  const [event, setEvent] = useState('');
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pgnField = useRef<HTMLTextAreaElement>(null);

  /**
   * iOS scrolls a focused field into view by shoving the whole window,
   * which takes this window's header with it. Asking the field to centre
   * itself inside the window's own scroller means there is nothing left
   * for the browser to do.
   */
  const scrollFocusIntoView = (e: React.FocusEvent<HTMLElement>): void => {
    const field = e.currentTarget;
    setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /**
   * A pasted PGN already says who played, when, and how it ended — so the
   * fields fill themselves from its headers rather than asking for what is
   * sitting in the box above them. Only EMPTY fields are filled: anything
   * typed is the person's own answer and outranks the paste, which is the
   * rule submit() already applies when it writes the headers back.
   */
  const readHeaders = (text: string): void => {
    const header = (key: string): string => {
      const found = new RegExp('^\\[' + key + '\\s+"([^"]*)"\\]', 'm').exec(text);
      return found?.[1]?.trim() ?? '';
    };
    const fill = (value: string, current: string, set: (v: string) => void): void => {
      // "?" and "*" are PGN's own way of writing "unknown" — not answers.
      if (current.trim() || !value || value === '?' || value === '*') return;
      set(value);
    };
    fill(header('White'), white, setWhite);
    fill(header('Black'), black, setBlack);
    fill(header('WhiteElo'), whiteElo, setWhiteElo);
    fill(header('BlackElo'), blackElo, setBlackElo);
    fill(header('UTCDate') || header('Date'), date, setDate);
    fill(header('Event'), event, setEvent);
    const outcome = header('Result');
    if (!result && ['1-0', '0-1', '1/2-1/2'].includes(outcome)) setResult(outcome);
    if (text.includes('[White ') || text.includes('[Event ')) setDetailsOpen(true);
  };

  const submit = async (): Promise<void> => {
    const withHeader = (text: string, key: string, value: string): string => {
      if (!value.trim()) return text;
      const line = `[${key} "${value.trim().replace(/"/g, '')}"]`;
      const re = new RegExp(`^\\[${key}\\s+"[^"]*"\\]\\s*$`, 'm');
      return re.test(text) ? text.replace(re, line) : `${line}\n${text}`;
    };
    let text = pgn.trim();
    if (!text) return;
    // Bare moves get a header block; a full PGN gets its headers overridden.
    if (!text.startsWith('[')) text = `\n${text}`;
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
    text = withHeader(text, 'Result', result);
    text = withHeader(text, 'Event', event);
    text = withHeader(text, 'BlackElo', blackElo);
    text = withHeader(text, 'WhiteElo', whiteElo);
    text = withHeader(text, 'Date', date.trim() ? date.replaceAll('-', '.') : today);
    text = withHeader(text, 'Black', black.trim() || 'Black');
    text = withHeader(text, 'White', white.trim() || 'White');

    setBusy(true);
    setFailure(null);
    try {
      await api('/api/games/collect-pgn', { method: 'POST', json: { pgn: text } });
      onDone();
    } catch (error) {
      // Including the thrown case: a network blip here used to leave the
      // import button disabled for good, with the typed game unsendable.
      setFailure(t(apiErrorMessage(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        title="Import a game"
        // Full screen on a phone; on a desktop a plain centred window of the
        // width a form of this shape wants — a 4xl sheet was mostly margin.
        className="sm:max-w-[37.5rem]"
        size="full"
      >
        <Textarea
          autoFocus={autoFocusField()}
          ref={pgnField}
          value={pgn}
          onChange={(e) => {
            setPgn(e.target.value);
            readHeaders(e.target.value);
          }}
          // The paste is read directly as well as through onChange: a paste
          // is the moment the headers arrive, and reading them here means
          // the fields are filled before the change has even settled.
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (text.includes('[')) readHeaders(text);
          }}
          onFocus={scrollFocusIntoView}
          rows={6}
          spellCheck={false}
          placeholder={t('Paste a PGN \u2014 or just moves: 1. e4 e5 2. Nf3 \u2026')}
          className="w-full resize-none font-mono placeholder:font-sans"
        />

        {/* Everything a pasted PGN already knows lives behind one line. It
            opens itself when a paste fills something in, so what was read
            off the text is seen rather than taken on trust. */}
        <Disclosure
          label="Advanced details"
          open={detailsOpen}
          onToggle={() => setDetailsOpen((v) => !v)}
        >
          <div className="flex flex-col gap-2">
            {/* Paired left to right on every screen, not just a desktop: a
                name and a rating are short, and a column of six full-width
                boxes was three screenfuls of a form that fits in one and a
                half. Measured at 390px, every placeholder fits the 158px a
                half-column leaves — once the event stopped calling itself a
                tournament as well, which it was at 157 of them. */}
            <div className="grid grid-cols-2 gap-2">
              <ClearableInput
                value={white}
                onChange={(e) => setWhite(e.target.value)}
                onFocus={scrollFocusIntoView}
                placeholder={t('White (optional)')}
              />
              <ClearableInput
                value={black}
                onChange={(e) => setBlack(e.target.value)}
                onFocus={scrollFocusIntoView}
                placeholder={t('Black (optional)')}
              />
              <ClearableInput
                value={whiteElo}
                onChange={(e) => setWhiteElo(e.target.value)}
                onFocus={scrollFocusIntoView}
                placeholder={t('White rating')}
                inputMode="numeric"
              />
              <ClearableInput
                value={blackElo}
                onChange={(e) => setBlackElo(e.target.value)}
                onFocus={scrollFocusIntoView}
                placeholder={t('Black rating')}
                inputMode="numeric"
              />
              <ClearableInput
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onFocus={scrollFocusIntoView}
                placeholder={t('Date, e.g. 2026-08-08')}
              />
              <ClearableInput
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                onFocus={scrollFocusIntoView}
                placeholder={t('Event (optional)')}
              />
            </div>

            {/* Segmented, not a dropdown: four states, all visible at once,
                and the chosen one filled. '' (Auto) travels as 'auto' — an
                empty value has been a segment id trap once (Radix refused
                it), and a named one costs nothing. */}
            <Segmented
              value={result === '' ? 'auto' : result}
              onChange={(v) => setResult(v === 'auto' ? '' : v)}
              ariaLabel={t('Result')}
              size="sm"
              even
              className="w-full font-mono"
              segments={[
                { value: 'auto', label: t('Auto'), title: 'Result from the pasted moves' },
                { value: '1-0', label: '1-0', title: 'White won' },
                { value: '0-1', label: '0-1', title: 'Black won' },
                { value: '1/2-1/2', label: '\u00bd-\u00bd', title: 'Draw' },
              ]}
            />
          </div>
        </Disclosure>

        {failure && <p className="text-destructive text-sm">{failure}</p>}

        {/* Sticky, so the only way to submit is never scrolled away — this
            form is long enough with Advanced open that it now scrolls, and
            a submit at the end of a scroll is a submit you have to go and
            find.

            Full-bleed and bordered, because a sticky bar that is merely
            bg-card reads as a mistake the moment content passes UNDER
            it: half a field showing to the left of the buttons, the rest
            hidden, no line to say which is which. -mx-4 px-4 takes it to
            both edges of the window's own padding (DialogContent pads by
            4; the old -mx-3 stopped 4px short of each edge), the rule
            says where it starts, and z-10 keeps it over anything that
            scrolls beneath. */}
        <div
          className={cn(
            'bg-card border-border sticky z-10 -mx-4 flex justify-end gap-2 border-t px-4 pt-2',
            // The bar reaches the window's own bottom edge and carries the
            // home-indicator clearance itself. Left to the window, that
            // clearance was a strip of empty surface UNDER the bar — about
            // 100px of nothing between the buttons and the bottom of the
            // screen. Sticking it that much lower and padding itself by the
            // same amount puts the background where the padding was and the
            // buttons where they always were.
            'bottom-[calc(-1rem-var(--safe-b))]',
            'pb-[calc(1rem+var(--safe-b))]',
            // And it eats the window's bottom padding in flow as well as
            // when stuck. Sticky only sticks while there is something to
            // scroll; with a form short enough to fit, the bar sat in the
            // ordinary flow and its clearance was ADDED to the window's own
            // — two indicators' worth of nothing under the buttons.
            '-mb-[calc(1rem+var(--safe-b))]',
          )}
        >
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('Cancel')}
          </Button>
          <Button variant="default" size="sm" disabled={busy || !pgn.trim()} onClick={() => void submit()}>
            <Plus className="size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} data-icon="inline-start" />
            {t('Add to collection')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
