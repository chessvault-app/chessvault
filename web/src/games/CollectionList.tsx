import {
  Bookmark,
  ExternalLink,
  Folder,
  Info,
  Pencil,
  Plus,
  SearchX,
  Trash2,
  X,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';

import { sanitizeSegment } from '@shared/vaultNames';
import {
  matchesSearchTerms,
  parseSearchQuery,
  type FilterConstraints,
} from '@shared/searchQuery';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Field } from '@/components/ui/field';

import { t } from '@/lib/i18n';
import {
  EMPTY_STRUCTURED_FILTERS,
  hasStructuredFilters,
  matchesOwnership,
  matchesStructured,
  MoreFiltersButton,
  NotesSelect,
  OwnershipSelect,
  ResultSelect,
  StructuredFiltersWindow,
  type NotesFilter,
  type OwnershipFilter,
  type ResultFilter,
  type StructuredFilters,
} from './GameFilters';
import { GameRow, docId, gameKey, safeLink, type GameSummary, type Preview } from './shared';
import { GameListShell } from './GameListShell';
import { GameTableHeader, GameTableRow, useGameTableVars, useTableNav } from './GameTable';
import { GameDetailsSheet, type DetailsSelection } from './GameDetails';
import { PromptDialog } from '@/components/prompt-dialog';

/** The per-game PGN fetch every list row can offer the details view. */
export const loadGamePgn =
  (game: Pick<GameSummary, 'file' | 'index'>) => async (): Promise<string | null> => {
    try {
      return (
        await api<{ pgn: string }>(
          `/api/games/pgn?file=${encodeURIComponent(game.file)}&index=${game.index}`,
        )
      ).pgn;
    } catch {
      return null;
    }
  };

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
  onDetails,
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
  onDetails: (game: GameSummary) => void;
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
      contextMenu
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
        // The whole game in a sheet — the card row shows two lines of
        // what the wide layout's details panel shows, and this is the
        // rest of it.
        { label: 'Game details', icon: Info, onSelect: () => onDetails(game) },
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
 * A rename in the open-game view changes the document's file name; when
 * it no longer matches the auto "White vs Black date" pattern, that name
 * IS the title the user chose — lead with it.
 */
export const customName = (g: GameSummary): string | null => {
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

/**
 * The collection's list behind the Games pane's tabs: its filter row,
 * its rows and its empty states. The games themselves, the bookmarks
 * and every verb that writes stay in CollectionView — this component
 * owns only what narrows and shows the list it was given.
 */
export function CollectionList({
  table = false,
  games,
  loaded,
  bookmarks,
  hidden,
  query,
  markedOnly,
  renamingKey,
  onStartRename,
  onOpen,
  onPreview,
  onDrop,
  onToggleBookmark,
  onRename,
  onImport,
  onClearSearch,
  onShowAll,
  toolbar,
  onSelect,
  selectedKey,
  onFilterConstraints,
}: {
  /** Dense table rows instead of cards — the wide pane's presentation.
      Explicit, never inferred: the same list renders as cards below lg
      whatever the pane says. */
  table?: boolean;
  games: GameSummary[];
  loaded: boolean;
  bookmarks: Set<string>;
  hidden: Set<string>;
  query: string;
  markedOnly: boolean;
  renamingKey: string | null;
  onStartRename: (key: string | null) => void;
  onOpen: (game: GameSummary) => void;
  onPreview: (p: Preview | null) => void;
  onDrop: (game: GameSummary) => void;
  onToggleBookmark: (game: GameSummary) => void;
  onRename: (game: GameSummary, to: string) => void;
  onImport: () => void;
  onClearSearch: () => void;
  onShowAll: () => void;
  /** The finders pair, in the shell's toolbar band. */
  toolbar?: ReactNode;
  /** Table mode: a click makes this row the details panel's subject;
      null (Escape) clears it. */
  onSelect?: (game: GameSummary | null) => void;
  selectedKey?: string | null;
  /** The active filters, reported upward whenever they change, so the
      HOST's warning box (which owns the query) can say when a query
      term and a filter leave no game possible. */
  onFilterConstraints?: (f: FilterConstraints) => void;
}) {
  // The quick filters, session-only like the archive's: what you want to
  // see is a question of the moment, not a preference.
  const [ownFilter, setOwnFilter] = useState<OwnershipFilter>('any');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('any');
  const [notesFilter, setNotesFilter] = useState<NotesFilter>('any');
  // The same sentence the elite browser answers, filtered client-side —
  // a few dozen games are already in the page (see matchesStructured).
  const [structured, setStructured] = useState<StructuredFilters>(EMPTY_STRUCTURED_FILTERS);
  const [editingFilters, setEditingFilters] = useState(false);
  // The host's warning box judges the query AGAINST these — reported
  // whenever they change (ownership and notes are vault facts no game
  // header can contradict, so they stay out).
  useEffect(() => {
    onFilterConstraints?.({
      result: resultFilter !== 'any' ? resultFilter : undefined,
      player: structured.player || undefined,
      side: structured.side,
      outcome: structured.outcome,
      player2: structured.player2 || undefined,
      from: structured.from || undefined,
      to: structured.to || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultFilter, structured]);
  // The row's selects, drafted for the window: one state, two views —
  // Apply commits both (see StructuredFiltersWindow's extraFields).
  const [quickDraft, setQuickDraft] = useState({
    own: 'any' as OwnershipFilter,
    result: 'any' as ResultFilter,
    notes: 'any' as NotesFilter,
  });

  // The shared query language: recognised qualifiers become terms the
  // rows answer in the page (matchesSearchTerms is the parser's own
  // twin of the server's SQL); the remainder is the plain needle.
  const parsedQuery = useMemo(() => parseSearchQuery(query), [query]);
  const needle = parsedQuery.text.trim().toLowerCase();
  const visible = games.filter((g) => {
    if (hidden.has(gameKey(g))) return false;
    if (markedOnly && !bookmarks.has(gameKey(g))) return false;
    if (!matchesSearchTerms(parsedQuery.terms, g)) return false;
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
      reason an empty list can be blamed on something they can undo.
      The whole query counts, not just its plain-text remainder: a box
      holding only `eco:B90` is still narrowing. */
  const filtering = filtersOn || markedOnly || query.trim() !== '';
  const clearFilters = (): void => {
    setOwnFilter('any');
    setResultFilter('any');
    setNotesFilter('any');
    setStructured(EMPTY_STRUCTURED_FILTERS);
  };

  /** The card menu's verbs, re-spoken for the table's right-click — the
      table row has no tray and no ⋯, so the pointer menu is the row's
      whole verb surface (the details panel repeats the big ones). */
  const rowMenu = (game: GameSummary) => {
    const link = safeLink(game.link);
    return [
      {
        label: bookmarks.has(gameKey(game)) ? 'Remove bookmark' : 'Bookmark',
        icon: Bookmark,
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
    ];
  };
  // In table mode GameRow is not there to host the rename sheet, so the
  // list renders the one being renamed itself.
  const renamingGame =
    table && renamingKey ? (games.find((g) => gameKey(g) === renamingKey) ?? null) : null;

  // ↑/↓/Enter/Escape drive the table selection over the filtered rows.
  const tableNav = useTableNav(table && onSelect !== undefined);
  const tableVars = useGameTableVars();
  tableNav.current = {
    move: (delta) => {
      const at = visible.findIndex((g) => gameKey(g) === selectedKey);
      const next =
        visible[
          at < 0
            ? delta > 0
              ? 0
              : visible.length - 1
            : Math.min(visible.length - 1, Math.max(0, at + delta))
        ];
      if (next) onSelect?.(next);
    },
    open: () => {
      const g = visible.find((g) => gameKey(g) === selectedKey);
      if (g) onOpen(g);
    },
    clear: () => onSelect?.(null),
  };

  // The ⋯ → Game details sheet: the details panel's content where
  // there is no panel.
  const [details, setDetails] = useState<GameSummary | null>(null);
  const detailsSelection: DetailsSelection | null = details
    ? { key: gameKey(details), summary: details, loadPgn: loadGamePgn(details) }
    : null;

  // The shared filter row's contents (GameFilters): side is YOUR side,
  // so it matches only the games you played; reference games (no side of
  // yours) answer to the other two. Where they STAND depends on density
  // — see the shell props below.
  const filterControls =
    games.length > 0 ? (
      <>
        <OwnershipSelect value={ownFilter} onChange={setOwnFilter} />
        <ResultSelect value={resultFilter} onChange={setResultFilter} />
        <NotesSelect value={notesFilter} onChange={setNotesFilter} />
        <MoreFiltersButton
          on={hasStructuredFilters(structured)}
          onClick={() => {
            setQuickDraft({ own: ownFilter, result: resultFilter, notes: notesFilter });
            setEditingFilters(true);
          }}
        />
        {editingFilters && (
          <StructuredFiltersWindow
            initial={structured}
            draftResult={quickDraft.result}
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
      </>
    ) : undefined;

  return (
    <>
    <GameListShell
      shape="panel"
      toolbar={toolbar}
      // The panel shape has no framed title to carry the tally, so the
      // count band says it. At table density the filters fold into this
      // band too — one 37px row instead of two, and in a short pane
      // (the workspace's games band) every reclaimed band is a game row
      // shown. Card mode keeps the stacked bands.
      countBand={
        table ? (
          <>
            {filterControls}
            <span className="text-muted-foreground ml-auto min-w-0 shrink-0 truncate text-sm font-medium tabular-nums">
              {t('{n} games', { n: visible.length.toLocaleString() })}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
            {t('{n} games', { n: visible.length.toLocaleString() })}
          </span>
        )
      }
      listHeader={table ? <GameTableHeader /> : undefined}
      listVars={table ? tableVars : undefined}
      dense={table}
      // The wait, in the shape of the strip and rows that are coming —
      // drawn at once rather than behind useSlowLoad: these rows are the
      // panel's height, so held back they left a header over nothing
      // that grew a fifth of a second later. No reserved filter row at
      // table density, where no filter band will come.
      filtersLoading={!loaded && !table}
      listLoading={!loaded}
      filters={table ? undefined : filterControls}
      list={
        loaded && visible.length > 0
          ? visible.map((game) =>
              table ? (
                <GameTableRow
                  key={gameKey(game)}
                  game={game}
                  selected={selectedKey === gameKey(game)}
                  onSelect={() => onSelect?.(game)}
                  onOpen={() => onOpen(game)}
                  menu={rowMenu(game)}
                  bookmarked={bookmarks.has(gameKey(game))}
                />
              ) : (
                <CollectionRow
                  key={gameKey(game)}
                  game={game}
                  bookmarked={bookmarks.has(gameKey(game))}
                  customName={customName(game)}
                  renaming={renamingKey === gameKey(game)}
                  onOpen={onOpen}
                  onPreview={onPreview}
                  onDrop={onDrop}
                  onToggleBookmark={onToggleBookmark}
                  onRename={onRename}
                  onStartRename={onStartRename}
                  onDetails={setDetails}
                />
              ),
            )
          : undefined
      }
      listClassName="flex-1 overflow-y-auto"
      tail={
        !loaded ? undefined : /* Nothing to show and nothing narrowing the list. Two ways to get
            here: the collection really is empty, or its last rows were just
            removed and the undo is still running — `hidden` is inside
            `visible` but not inside `games`, so the raw count alone said
            the collection was full while the list was bare, and the filter
            states below took it and blamed a search nobody had typed. What
            the reader sees is an empty collection either way, and Undo puts
            the rows back. */
        games.length === 0 || (!filtering && visible.length === 0) ? (
          <EmptyState
            // Centred in the PANEL, not parked under its header: an empty
            // state pinned to the top of a full-height box is the thing
            // that leaves a reader looking at dead space below it. The
            // border-t stands in for the filter row's old bottom rule
            // when that row is above; with no filters there is no line,
            // as before.
            className={cn('min-h-0 flex-1', games.length > 0 && 'border-border border-t')}
            icon={Folder}
            title="Your collection is empty"
            body="The collection holds the games worth keeping — each one annotatable like a study. Import one, or browse your online archive and add the games you want to study."
            action={
              <Button variant="default" size="sm" onClick={onImport}>
                <Plus className="size-3.5" data-icon="inline-start" />
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
              className="border-border min-h-0 flex-1 border-t"
              icon={Bookmark}
              title="No bookmarked games yet"
              body="Bookmark a game from the list and it is kept here, one press from wherever you are."
              action={
                <Button variant="default" size="sm" onClick={onShowAll}>
                  <Folder className="size-3.5" data-icon="inline-start" />
                  {t('Browse all games')}
                </Button>
              }
            />
          ) : filtersOn && !needle ? (
            <EmptyState
              className="border-border min-h-0 flex-1 border-t"
              icon={SearchX}
              title="Nothing matches those filters"
              body="No game in your collection gets through the filters above. Clearing them shows the whole collection again."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  <X className="size-3.5" data-icon="inline-start" />
                  {t('Clear filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              className="border-border min-h-0 flex-1 border-t"
              icon={SearchX}
              title="Nothing matches that search"
              body={
                markedOnly
                  ? 'No bookmarked game in your collection matches it. Clearing the search shows every bookmark again.'
                  : 'No game in your collection matches it. Clearing the search shows the whole collection again.'
              }
              action={
                <Button variant="secondary" size="sm" onClick={onClearSearch}>
                  <X className="size-3.5" data-icon="inline-start" />
                  {t('Clear search')}
                </Button>
              }
            />
          )
        ) : undefined
      }
    />
    {detailsSelection && (
      <GameDetailsSheet selection={detailsSelection} onClose={() => setDetails(null)} />
    )}
    {renamingGame && (
      <PromptDialog
        label={t('Rename this game')}
        initial={customName(renamingGame) ?? docId(renamingGame)}
        onSubmit={(value) => onRename(renamingGame, value)}
        onClose={() => onRename(renamingGame, '')}
      />
    )}
    </>
  );
}
