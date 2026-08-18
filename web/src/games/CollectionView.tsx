import {
  Bookmark,
  ChevronRight,
  SlidersHorizontal,
  ExternalLink,
  Globe,
  Pencil,
  Plus,
  BookOpen,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cachedCollection, forgetCollection, loadCollection } from './collection';

import { sanitizeSegment } from '@shared/vaultNames';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { autoFocusField, useMediaQuery } from '@/lib/media';
import { navigate } from '@/lib/router';

import { Button } from '@/ui/Button';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';

import { EmptyState } from '@/ui/EmptyState';
import { BookmarkArt, CollectionArt, NoMatchArt } from '@/ui/EmptyArt';

import { ClearableInput, SearchInput, TextArea } from '@/ui/Input';
import {
  EMPTY_STRUCTURED_FILTERS,
  FilterRow,
  hasStructuredFilters,
  matchesOwnership,
  matchesStructured,
  NotesSelect,
  OwnershipSelect,
  ResultSelect,
  StructuredFiltersWindow,
  type NotesFilter,
  type OwnershipFilter,
  type ResultFilter,
  type StructuredFilters,
} from './GameFilters';
import { Field } from '@/ui/Field';

import { Panel, PanelHeader } from '@/ui/Panel';
import { Modal } from '@/ui/Modal';
import { CreateControl, FabSpacer } from '@/ui/Fab';
import { ActionSheet } from '@/ui/ActionSheet';
import { UndoBar } from '@/ui/UndoBar';
import { useUndoable } from '@/ui/useUndoable';
import { SkeletonFilterRow, SkeletonGameRows } from '@/ui/Skeleton';

import { t } from '@/lib/i18n';
import { GamePreview, GameRow, docId, gameKey, safeLink, type GameSummary, type Preview } from './shared';
import { ArchiveBrowser } from './ArchiveBrowser';
import { EliteGames } from './EliteGames';

/** The two places a game can be found, and the column's two tabs. */
type SourceId = 'archive' | 'elite';
const SOURCES: { id: SourceId; label: string }[] = [
  { id: 'archive', label: 'Online archives' },
  { id: 'elite', label: 'Elite games' },
];

/**
 * One collection row, memoised on primitives so a bookmark toggle or a
 * rename re-renders the rows whose state changed instead of the whole
 * list. The row's chrome (the tray star, the ⋯ menu) is built here from
 * those primitives; the callbacks are stable by contract (see rowHandlers
 * in CollectionView).
 */
const CollectionRow = memo(function CollectionRow({
  game,
  bookmarked,
  customName,
  renaming,
  onOpen,
  onPreview,
  onDrop,
  onToggleBookmark,
  onRename,
  onStartRename,
  onContext,
}: {
  game: GameSummary;
  bookmarked: boolean;
  customName: string | null;
  renaming: boolean;
  onOpen: (game: GameSummary) => void;
  onPreview: (p: Preview | null) => void;
  onDrop: (game: GameSummary) => void;
  onToggleBookmark: (game: GameSummary) => void;
  onRename: (game: GameSummary, to: string) => void;
  onStartRename: (key: string) => void;
  onContext: (game: GameSummary, x: number, y: number) => void;
}) {
  // Through the scheme guard (see shared.tsx): a stored link that is not
  // http(s) offers no View online at all rather than a live window.open.
  const link = safeLink(game.link);
  return (
    <GameRow
      onSwipeAway={() => onDrop(game)}
      onBookmark={() => onToggleBookmark(game)}
      bookmarked={bookmarked}
      game={game}
      customName={customName}
      renaming={renaming}
      onRename={(to) => onRename(game, to)}
      onOpen={() => onOpen(game)}
      onPreview={onPreview}
      onContext={(x, y) => onContext(game, x, y)}
      actions={
        // The star is a CONTROL, so it lives where controls live:
        // in the hover tray on a desktop, and not on a phone at
        // all, where the row is swiped right or its ⋯ is used.
        // What a bookmarked game says for itself is the amber
        // edge down its left — which costs no width at all, and
        // a lit star standing permanently at the end of a 390px
        // row cost the player names about 36px of theirs.
        <Button
          variant="ghost"
          size="icon-sm"
          title={bookmarked ? t('Remove bookmark') : t('Bookmark')}
          className="pointer-coarse:hidden shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark(game);
          }}
        >
          <Bookmark className={cn('size-3.5', bookmarked && 'fill-warn text-warn')} />
        </Button>
      }
      menu={[
        {
          // Same rule as the preview: on a desktop the mark is
          // already in the row's tray, and repeating it here
          // just makes the menu longer to read.
          label: bookmarked ? 'Remove bookmark' : 'Bookmark',
          icon: Bookmark,
          className: 'pointer-fine:hidden',
          onSelect: () => onToggleBookmark(game),
        },
        { label: 'Rename', icon: Pencil, onSelect: () => onStartRename(gameKey(game)) },
        ...(link
          ? [
              {
                label: 'View online',
                icon: ExternalLink,
                onSelect: () => window.open(link, '_blank', 'noreferrer'),
              },
            ]
          : []),
        { label: 'Remove', icon: Trash2, danger: true, onSelect: () => onDrop(game) },
      ]}
      showLink={false}
    />
  );
});

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
  // The quick filters, session-only like the archive's: what you want to
  // see is a question of the moment, not a preference.
  const [ownFilter, setOwnFilter] = useState<OwnershipFilter>('any');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('any');
  const [notesFilter, setNotesFilter] = useState<NotesFilter>('any');
  // The same sentence the elite browser answers, filtered client-side —
  // a few dozen games are already in the page (see matchesStructured).
  const [structured, setStructured] = useState<StructuredFilters>(EMPTY_STRUCTURED_FILTERS);
  const [editingFilters, setEditingFilters] = useState(false);
  // The row's selects, drafted for the window: one state, two views —
  // Apply commits both (see StructuredFiltersWindow's extraFields).
  const [quickDraft, setQuickDraft] = useState({
    own: 'any' as OwnershipFilter,
    result: 'any' as ResultFilter,
    notes: 'any' as NotesFilter,
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importing, setImporting] = useState(false);
  /** The archive browser as a window — below lg, where it has no column. */
  const [browsing, setBrowsing] = useState(false);
  /** The reference browser as a window, for the same reason. */
  const [elite, setElite] = useState(false);
  /** Which of the two the column is showing. */
  const [source, setSource] = useState<SourceId>('archive');
  // Not a class: `lg:hidden` on a menu ITEM still leaves a menu of that
  // many items, so at lg the Add games button drew a chevron and a popover
  // to offer a single row. The list has to know the width, not just the
  // rows in it.
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
  // Right-click opens the same actions the ⋯ offers, where the pointer is.
  const [context, setContext] = useState<{ game: GameSummary; x: number; y: number } | null>(null);
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

  // A rename in the open-game view changes the document's file name; when
  // it no longer matches the auto "White vs Black date" pattern, that name
  // IS the title the user chose — lead with it.
  const customName = (g: GameSummary): string | null => {
    const name = docId(g);
    // The same rule the server named the file with — see shared/vaultNames.
    const autoPrefix = sanitizeSegment(`${g.white} vs ${g.black}`, '');
    // Compared loosely on punctuation and case. A file written as
    // "Firouzja A vs Vaishali R 2026-12-24" from a header that reads
    // "Firouzja, A" did not match its own auto name, so every reference
    // game in the collection claimed to have been renamed — and led with
    // its filename instead of showing the two players on their own lines.
    const loose = (s: string): string => s.replace(/[,.]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return loose(name).startsWith(loose(autoPrefix)) ? null : name;
  };

  // The rows memoise on primitives — see CollectionRow. These forward
  // through a ref to the LATEST handlers, so their identity never changes
  // while their closures stay fresh (a bookmark toggle used to re-render
  // every row in the list; now it re-renders the one that changed).
  const rowHandlers = useRef({ dropGame, toggleBookmark, renameGame, openGame, setContext });
  rowHandlers.current = { dropGame, toggleBookmark, renameGame, openGame, setContext };
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
  const rowContext = useCallback(
    (g: GameSummary, x: number, y: number) => rowHandlers.current.setContext({ game: g, x, y }),
    [],
  );

  // Built once and shared: the archive renders twice (beside the
  // collection, and in the phone's window) and each copy needs it.
  const collectionKeys = new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`));

  const needle = query.trim().toLowerCase();
  const visible = games.filter((g) => {
    if (hidden.has(gameKey(g))) return false;
    if (markedOnly && !bookmarks.has(gameKey(g))) return false;
    // Ownership, not "side": the collection holds reference games beside
    // your own, so mine-ness is asked openly (userSide comes from the
    // VaultSide header stamped when collecting from the profile's own
    // archive; a reference game has none).
    if (!matchesOwnership(ownFilter, g.userSide)) return false;
    if (resultFilter !== 'any' && g.result !== resultFilter) return false;
    if (notesFilter === 'annotated' && !g.annotated) return false;
    if (!matchesStructured(structured, g)) return false;
    if (!needle) return true;
    return `${customName(g) ?? ''} ${g.white} ${g.black} ${g.eco ?? ''} ${g.opening?.name ?? ''} ${g.date}`
      .toLowerCase()
      .includes(needle);
  });
  const filtersOn =
    ownFilter !== 'any' ||
    resultFilter !== 'any' ||
    notesFilter !== 'any' ||
    hasStructuredFilters(structured);
  /** Whether anything the reader chose is narrowing the list — the only
      reason an empty list can be blamed on something they can undo. */
  const filtering = filtersOn || markedOnly || needle !== '';
  const clearFilters = (): void => {
    setOwnFilter('any');
    setResultFilter('any');
    setNotesFilter('any');
    setStructured(EMPTY_STRUCTURED_FILTERS);
  };

  /**
   * Search, then the bookmark switch — the pair that narrows the list.
   *
   * A function rather than a constant because the two homes want the
   * field sized differently: a line of its own gives it everything left
   * over, a panel header gives it the header's spare width beside the
   * panel's name.
   * Everything else about them is identical, which is the point of
   * writing them once.
   */
  const finders = (fieldClass: string): ReactNode => (
    <>
      <SearchInput
        type="text"
        inputSize="sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('Search collection…')}
        className={cn('min-w-0', fieldClass)}
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

  return (
    <PageShell
      width="wide"
      scroll={false}
      // Below sm the whole page scrolls; from sm up the two panels scroll
      // themselves, so the column pins to the viewport instead.
      //
      // The tighter bottom inset belongs to that pinned layout, where the
      // panels end at the viewport and every spare pixel is one they do
      // not get. A scrolling phone wants the shell's own inset, which is
      // what studies and notes end on — and it carries --safe-b, so the
      // last row clears the home indicator rather than sitting on it.
      className="h-full overflow-y-auto sm:overflow-hidden pb-[calc(2rem+var(--safe-b))] sm:pb-4 md:pb-6"
    >
      {/* The heading carries what is ABOUT the page; the two controls that
          NARROW it — search, then the bookmark switch — belong with the
          thing they narrow. At lg that is the Collection panel, which has
          a header of its own to put them in, so they go there and this
          row is not rendered at all. Below lg there is no room in a panel
          header, so they take a line under the title. Declared once in
          `finders` and placed twice; only one is ever on screen. */}
      <div className="flex flex-col gap-2.5">
        <PageHeader
          title={t('Games')}
          actions={
            /* Every way to get a game, in one place — but only while there
               is nowhere better for them. At lg the two browsers live in
               the column to the right, where they are on screen rather
               than behind a press, and offering a window over a panel you
               can already see is worse than not offering it. So at lg this
               is what it says on it: import a game. */
            <CreateControl
              label="Add games"
              actions={[
                { label: 'Import a game', icon: Plus, onSelect: () => setImporting(true) },
                ...(wide
                  ? []
                  : [
                      { label: 'Browse an online archive', icon: Globe, onSelect: () => setBrowsing(true) },
                      { label: 'Elite games', icon: Trophy, onSelect: () => setElite(true) },
                    ]),
              ]}
            />
          }
        />

        <div className="flex items-center gap-2 lg:hidden">{finders('flex-1')}</div>
      </div>

      {importing && (
        <ImportGamePanel
          onDone={() => {
            setImporting(false);
            void load();
          }}
          onCancel={() => setImporting(false)}
        />
      )}

      {error && <p className="text-bad text-xs">{error}</p>}

      {/* Two columns on a desktop: the collection is the page and takes the
          full height (it showed four rows when the archive browser sat
          under it), and the browser is a tool beside it. One under the
          other below lg, where there is no width to split. */}
      {/* minmax(0,…), not a bare fr split: an fr track is min-content wide
          at its narrowest, so the column silently widened to fit the
          longest opening name in whichever list it was showing — the two
          panels changed width when the tab was switched.

          And a FLOOR under the right one. minmax(0,3fr) let it shrink to
          226px at a 1024 window, which is less than this row's own
          furniture: the text box reached ZERO width, and the ratings and
          the result badge — both shrink-0 — spilled out of it and painted
          over each other. 20rem is the narrowest the list is legible at;
          the collection gives up the difference, having the easier job. */}
      {/* max-sm:shrink-0, and the flex share only from sm.
          Below sm this box was `flex-1` inside a column pinned to the
          viewport, so it took the ~480px left over and the collection
          panel — `shrink-0`, as tall as its list — hung out of it. The
          spill still scrolled (the column scrolls), which is why it
          looked fine, but the FLEX layout ended at 480px: the Fab spacer
          and the column's bottom padding were laid out THERE, a thousand
          pixels above the list's real end, doing nothing. Scrolled to the
          bottom, the list finished flush against the phone's tab bar with
          no room for the Fab — the one place you are certain to be when
          you reach for it. Sized to its content, the box ends where the
          list ends and the spacer is under it again, as on studies and
          notes. From sm up the panels scroll themselves and the share is
          what makes that work, so it stays. */}
      <div className="flex min-h-0 max-sm:shrink-0 sm:flex-1 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)] lg:items-stretch">
      {
        // shrink-0 below lg: loading an archive month must not squeeze this
        // panel — the page column scrolls instead.
        <Panel flush className="shrink-0 sm:min-h-0 lg:min-h-0 lg:shrink lg:self-stretch">
          {/* No Elite games button here any more: it is one of the ways to
              ADD a game, and every one of those is behind the header's
              Add games now. A panel header should say what the panel
              holds, not offer a way somewhere else. */}
          {/* At lg the pair lives here, with the list it filters, and the
              row under the page title is not rendered. The field grows
              into whatever the header has spare — on a wide panel a
              48-wide box sat beside dead space — while the title's own
              flex share keeps the panel's name in place. */}
          <PanelHeader
            title={`${t('Collection')} · ${visible.length}`}
            actionsClassName="min-w-0 grow"
            actions={
              <span className="hidden min-w-0 grow items-center justify-end gap-2 lg:flex">
                {finders('w-48 grow')}
              </span>
            }
          />
          {/* The shared filter row (GameFilters): side is YOUR side, so
              it matches only the games you played; reference games (no
              side of yours) answer to the other two. */}
          {games.length > 0 && (
            <FilterRow className="border-b">
              <OwnershipSelect value={ownFilter} onChange={setOwnFilter} />
              <ResultSelect value={resultFilter} onChange={setResultFilter} />
              <NotesSelect value={notesFilter} onChange={setNotesFilter} />
              <Button
                variant="secondary"
                size="icon-sm"
                active={hasStructuredFilters(structured)}
                title={t('More filters')}
                className="shrink-0"
                onClick={() => {
                  setQuickDraft({ own: ownFilter, result: resultFilter, notes: notesFilter });
                  setEditingFilters(true);
                }}
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
              {editingFilters && (
                <StructuredFiltersWindow
                  initial={structured}
                  // No Tournament field: collection games carry no Event.
                  showEvent={false}
                  extraFields={
                    // The row's selects, mirrored. Ownership is about YOUR
                    // games — a different question from the named player's
                    // seat above, which is why both exist.
                    <Field label="Whose games, result and notes">
                      <div className="flex gap-2">
                        <OwnershipSelect
                          value={quickDraft.own}
                          onChange={(own) => setQuickDraft((d) => ({ ...d, own }))}
                        />
                        <ResultSelect
                          value={quickDraft.result}
                          onChange={(result) => setQuickDraft((d) => ({ ...d, result }))}
                        />
                        <NotesSelect
                          value={quickDraft.notes}
                          onChange={(notes) => setQuickDraft((d) => ({ ...d, notes }))}
                        />
                      </div>
                    </Field>
                  }
                  onClear={() => setQuickDraft({ own: 'any', result: 'any', notes: 'any' })}
                  onApply={(next) => {
                    setEditingFilters(false);
                    setStructured(next);
                    setOwnFilter(quickDraft.own);
                    setResultFilter(quickDraft.result);
                    setNotesFilter(quickDraft.notes);
                  }}
                  onClose={() => setEditingFilters(false)}
                />
              )}
            </FilterRow>
          )}
          {/* The wait, in the shape of the rows that are coming — the same
              SkeletonGameRows the archive and the elite list on this very
              page already use. This panel was the one that showed a header
              with nothing under it, which is what an emptied collection
              looks like. */}
          {!loaded ? (
            // The filter row above is drawn only once there are games to
            // filter, so the wait had rows but no strip and everything
            // dropped 45px when the collection landed.
            // Drawn at once rather than behind useSlowLoad: these rows
            // are the panel's height, so held back they left a header
            // over nothing that grew a fifth of a second later.
            <>
              <SkeletonFilterRow />
              <SkeletonGameRows rows={6} />
            </>
          ) : /* Nothing to show and nothing narrowing the list. Two ways to get
              here: the collection really is empty, or its last rows were just
              removed and the undo is still running — `hidden` is inside
              `visible` but not inside `games`, so the raw count alone said
              the collection was full while the list was bare, and the filter
              states below took it and blamed a search nobody had typed. What
              the reader sees is an empty collection either way, and Undo puts
              the rows back. Both halves drop their `loaded &&` — the branch
              above has already taken every render before the list is in. */
          games.length === 0 || (!filtering && visible.length === 0) ? (
            <EmptyState
              // Centred in the PANEL, not parked under its header: an empty
              // state pinned to the top of a full-height box is the thing
              // that leaves a reader looking at dead space below it.
              className="min-h-0 flex-1"
              art={<CollectionArt />}
              title="Your collection is empty"
              body="The collection holds the games worth keeping — each one annotatable like a study. Import one, or browse your online archive and add the games you want to study."
              action={
                <Button variant="primary" size="sm" onClick={() => setImporting(true)}>
                  <Plus className="mr-1 size-3.5" />
                  {t('Import a game')}
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            /* The collection has games and a filter of the reader's own is
               keeping every one of them out — the branch above has already
               taken the unfiltered case. Saying which filter beats a box
               with nothing under its header, which reads as the collection
               having been emptied. Each of these ends on the press that
               undoes it: an empty state whose only advice is "go and do
               something else" leaves the reader looking at dead space. */
            markedOnly && !needle && !filtersOn ? (
              <EmptyState
                className="min-h-0 flex-1"
                art={<BookmarkArt />}
                title="No bookmarked games yet"
                body="Bookmark a game from the list and it is kept here, one press from wherever you are."
                action={
                  <Button variant="primary" size="sm" onClick={() => setMarkedOnly(false)}>
                    <BookOpen className="mr-1 size-3.5" />
                    {t('Browse all games')}
                  </Button>
                }
              />
            ) : filtersOn && !needle ? (
              <EmptyState
                className="min-h-0 flex-1"
                art={<NoMatchArt />}
                title="Nothing matches those filters"
                body="No game in your collection gets through the filters above. Clearing them shows the whole collection again."
                action={
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    <X className="mr-1 size-3.5" />
                    {t('Clear filters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                className="min-h-0 flex-1"
                art={<NoMatchArt />}
                title="Nothing matches that search"
                body={
                  markedOnly
                    ? 'No bookmarked game in your collection matches it. Clearing the search shows every bookmark again.'
                    : 'No game in your collection matches it. Clearing the search shows the whole collection again.'
                }
                action={
                  <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                    <X className="mr-1 size-3.5" />
                    {t('Clear search')}
                  </Button>
                }
              />
            )
          ) : (
          // Dividers AND a faint stripe on every other row: at two lines a
          // row is tall enough that a hairline alone left the list reading
          // as one block of text. The stripe is 2% of the foreground —
          // enough to group the two lines that belong together, not enough
          // to read as a highlight.
          <ul className="divide-line min-h-0 flex-1 divide-y overflow-y-auto [&>li:nth-child(even)]:bg-fg/[0.022] sm:max-h-[38dvh] lg:max-h-none">
            {visible.map((game) => (
              <CollectionRow
                key={gameKey(game)}
                game={game}
                bookmarked={bookmarks.has(gameKey(game))}
                customName={customName(game)}
                renaming={renamingKey === gameKey(game)}
                onOpen={rowOpen}
                onPreview={setPreview}
                onDrop={rowDrop}
                onToggleBookmark={rowBookmark}
                onRename={rowRename}
                onStartRename={setRenamingKey}
                onContext={rowContext}
              />
            ))}
          </ul>
          )}
        </Panel>
      }

      {/* Where a game comes from, as ONE panel with two answers: the games
          you have played, and the games masters have. They are the same
          question — find a game worth keeping — so they take turns in one
          box rather than each taking a box and halving the other's height.
          Beside the collection where there is width for it, and nowhere at
          all below lg, where both open from Add games as windows. */}
      <div className="hidden min-h-0 lg:flex lg:flex-col">
        <Panel flush className="min-h-0 flex-1">
          {/* The panel's TITLE is the switch. A pill track here would be
              the second one in this panel — the provider tabs are eight
              pixels below it — and two stacked tracks read as one
              two-storey control. Naming the panel is what a header does,
              so the live tab is the header's own rule, thickened and lit
              under the name that is showing. */}
          <header
            role="tablist"
            aria-label={t('Where to find a game')}
            className="border-line flex h-10 shrink-0 items-center gap-1 border-b px-2"
          >
            {SOURCES.map(({ id, label }) => {
              const on = source === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSource(id)}
                  // No icon, and not the header's uppercase micro-caps:
                  // measured, the pair came to 256px that way and this
                  // column is 210px wide at the narrowest lg. Plain text
                  // at text-xs is 178. min-w-0 so a longer translation
                  // truncates rather than pushing the second tab out.
                  className={cn(
                    'relative flex h-10 min-w-0 items-center px-1.5 text-xs font-semibold',
                    'transition-colors duration-100',
                    on
                      ? 'text-fg after:bg-primary after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full'
                      : 'text-subtle hover:text-fg',
                  )}
                >
                  <span className="truncate">{t(label)}</span>
                </button>
              );
            })}
          </header>

          {source === 'archive' ? (
            <ArchiveBrowser
              place="panel"
              collectionKeys={collectionKeys}
              onCollected={() => void load()}
              onPreview={setPreview}
            />
          ) : (
            <EliteGames variant="column" />
          )}
        </Panel>
      </div>
      </div>

      {/* No lg:hidden on the window itself: that would hide the CARD and
          leave its scrim behind, dimming the page with nothing on it and
          nothing to press. The menu item is what disappears at lg — see
          below — so this can only be opened where it belongs, and a
          window left open across a resize stays usable.

          And a HEIGHT on a phone, for the reason the elite window below
          has one: this opens empty, the months and then the first page of
          games land a moment later, and a content-sized sheet grew under
          the reader's thumb as they did. Given the height it ends up at,
          it opens at it. */}
      {browsing && (
        <Modal
          title="Online archives"
          onClose={() => setBrowsing(false)}
          full
          className="max-sm:h-[88%]"
        >
          {/* Unframed here too: the window's own title bar already says
              Online archives, and the panel said it again directly under
              it. A window that names itself twice is a window with a
              wasted line and a reader wondering what the difference is. */}
          <ArchiveBrowser
            place="window"
            collectionKeys={collectionKeys}
            onCollected={() => void load()}
            onPreview={setPreview}
          />
        </Modal>
      )}

      {/* A HEIGHT, not a cap. This window is a list of 280,000 games: it
          opens empty, the first page lands a moment later, and a
          content-sized sheet grew under the reader's thumb as it did.
          Given the height it is going to end up at, it opens at it. */}
      {elite && (
        <Modal title="Elite games" onClose={() => setElite(false)} full className="max-sm:h-[88%]">
          <EliteGames />
        </Modal>
      )}

      {context && (
        <ActionSheet
          title={customName(context.game) ?? docId(context.game)}
          point={{ x: context.x, y: context.y }}
          onClose={() => setContext(null)}
          actions={[
            {
              label: 'Rename',
              icon: Pencil,
              onSelect: () => setRenamingKey(gameKey(context.game)),
            },
            {
              label: bookmarks.has(gameKey(context.game)) ? 'Remove bookmark' : 'Bookmark',
              icon: Bookmark,
              onSelect: () => void toggleBookmark(context.game),
            },
            { label: 'Remove', icon: Trash2, danger: true, onSelect: () => dropGame(context.game) },
          ]}
        />
      )}

      <GamePreview preview={preview} onClose={() => setPreview(null)} />

      {undoable.pending && (
        <UndoBar
          label={undoable.pending.label}
          leaving={undoable.pending.leaving}
          onUndo={undoable.undo}
          onHold={undoable.hold}
          onRelease={undoable.release}
        />
      )}

      <FabSpacer />
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
    <Modal
      title="Import a game"
      onClose={onCancel}
      full
      // Full screen on a phone; on a desktop a plain centred window of the
      // width a form of this shape wants — a 4xl sheet was mostly margin.
      className="sm:max-w-[37.5rem]"
    >
      <TextArea
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
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        className="text-subtle hover:text-fg flex items-center gap-1.5 self-start text-xs transition-colors duration-100"
      >
        <ChevronRight
          className={cn('size-3.5 transition-transform duration-150', detailsOpen && 'rotate-90')}
        />
        {t('Advanced details')}
      </button>

      {detailsOpen && (
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

          {/* Segmented, not a dropdown: four states, all visible at once.
              Auto is the default and stays quiet — a blue chip beside a
              blue Add button made the form look like it had two answers
              waiting. */}
          <div className="flex gap-1" role="radiogroup" aria-label={t('Result')}>
            {(
              [
                ['', 'Auto', 'Result from the pasted moves'],
                ['1-0', '1-0', 'White won'],
                ['0-1', '0-1', 'Black won'],
                ['1/2-1/2', '\u00bd-\u00bd', 'Draw'],
              ] as const
            ).map(([value, label, hint]) => (
              <Button
                key={value}
                size="sm"
                variant="secondary"
                active={result === value}
                title={t(hint)}
                className="min-w-0 flex-1 whitespace-nowrap px-0 font-mono"
                onClick={() => setResult(value)}
              >
                {t(label)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {failure && <p className="text-bad text-xs">{failure}</p>}

      {/* Sticky, so the only way to submit is never scrolled away — this
          form is long enough with Advanced open that it now scrolls, and
          a submit at the end of a scroll is a submit you have to go and
          find.

          Full-bleed and bordered, because a sticky bar that is merely
          bg-surface reads as a mistake the moment content passes UNDER
          it: half a field showing to the left of the buttons, the rest
          hidden, no line to say which is which. -mx-3 px-3 takes it to
          both edges of the window's own padding, the rule says where it
          starts, and z-10 keeps it over anything that scrolls beneath. */}
      <div
        className={cn(
          'bg-surface border-line sticky z-10 -mx-3 flex justify-end gap-2 border-t px-3 pt-2',
          // The bar reaches the window's own bottom edge and carries the
          // home-indicator clearance itself. Left to the window, that
          // clearance was a strip of empty surface UNDER the bar — about
          // 100px of nothing between the buttons and the bottom of the
          // screen. Sticking it that much lower and padding itself by the
          // same amount puts the background where the padding was and the
          // buttons where they always were.
          'bottom-[calc(-0.75rem-var(--safe-b))]',
          'pb-[calc(1rem+var(--safe-b))]',
          // And it eats the window's bottom padding in flow as well as
          // when stuck. Sticky only sticks while there is something to
          // scroll; with a form short enough to fit, the bar sat in the
          // ordinary flow and its clearance was ADDED to the window's own
          // — two indicators' worth of nothing under the buttons.
          '-mb-[calc(0.75rem+var(--safe-b))]',
        )}
      >
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={busy || !pgn.trim()} onClick={() => void submit()}>
          <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
          {t('Add to collection')}
        </Button>
      </div>
    </Modal>
  );
}
