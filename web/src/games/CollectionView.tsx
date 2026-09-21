import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useMediaQuery } from '@/lib/media';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';

import { GameDetailsPanel, type DetailsSelection } from './GameDetails';
import { useFiltersFolded } from './GameFilters';
import { GamesHeaderSlotsProvider } from './header-slots';
import { GamesBrowser } from './GamesBrowser';
import {
  DETAILS_PIN_KEY,
  DETAILS_RESERVE_PX,
  DETAILS_RESERVE_WIDE_PX,
  PANEL_WIDE_MQ,
  PIN_FREE_MQ,
  TABLE_MQ,
  readDetailsPin,
} from './pane-shape';

/* The measurements this page and the browser inside it lay out from —
   the pin's key, the two widths where the details column changes its
   mind, and what it reserves — live in ./pane-shape, because the
   outline that stands in for this page while its chunk is on the wire
   reads the same numbers (GamesView.skeleton).
*/

/**
 * The Games page: the tabbed games browser (see GamesBrowser, which owns
 * the tabs, the collection and all its verbs) with a details column
 * standing beside it at lg. A thin host on purpose — this file used to
 * BE the browser as well as the page, which is exactly what kept the
 * workspace's games band from showing the Collection tab without a
 * second implementation.
 */
export function CollectionView() {
  // Width changes the dressing of the ONE layout: at lg the rows are
  // the dense table and the details column stands beside the pane;
  // below, the same tabs hold card rows and details open as a sheet
  // from a row's own menu. A flag rather than classes because a
  // display-none details panel would still resolve selections.
  const wide = useMediaQuery(TABLE_MQ);
  /** What the browser last selected — the details column's subject. */
  const [selection, setSelection] = useState<DetailsSelection | null>(null);
  // null = nobody has chosen on this device, so the width decides.
  const [choice, setChoice] = useState<boolean | null>(readDetailsPin);
  const roomy = useMediaQuery(PIN_FREE_MQ);
  /** Whether the panel's track may take its wider maximum — see PANEL_WIDE_MQ. */
  const roomier = useMediaQuery(PANEL_WIDE_MQ);
  const pinned = choice ?? roomy;
  const togglePin = (): void => {
    const next = !pinned;
    setChoice(next);
    const stored = next ? '1' : '0';
    try {
      localStorage.setItem(DETAILS_PIN_KEY, stored);
    } catch {
      /* the session still remembers; it just will not survive a reload */
    }
  };
  // Unpinned, the column is the SELECTION's — it arrives with a game and
  // leaves with it. Which is why the switch lives in the panel's own
  // header and not in a toolbar: unpinned, there is no panel to hold it
  // until a row is clicked, and clicking a row is how it comes back.
  const showDetails = wide && (pinned || selection !== null);
  // Closing the panel is dropping the SELECTION, and the pane owns that
  // (its row highlight, and which tab's selection is live) — clearing
  // only the copy held here would leave the row lit and the panel unable
  // to come back on a click of the same row. So the close goes through
  // the pane's own clear, which is the one Escape uses.
  const clearSelection = useRef<(() => void) | null>(null);
  // The browser owns the import sheet; the title line only rings it.
  const openImport = useRef<(() => void) | null>(null);
  // The page owns the scroller a pull is read from; the browser owns the
  // tabs, and so knows what a pull should fetch again.
  const refreshTab = useRef<(() => Promise<void>) | null>(null);
  // On a phone the title row is lent to the list under it: the count is
  // the subtitle and the find, bookmark and filter switches stand beside
  // Import (./header-slots). State, not refs: the lists draw into these
  // through portals, and a portal needs a render once its target exists.
  const lend = useFiltersFolded();
  const [subtitleEl, setSubtitleEl] = useState<HTMLElement | null>(null);
  const [findersEl, setFindersEl] = useState<HTMLElement | null>(null);
  const [filtersEl, setFiltersEl] = useState<HTMLElement | null>(null);
  // And the same again inside the compact bar a scroll up reveals, with
  // the source chips under them (PageHeader, `pinned`).
  const [barFindersEl, setBarFindersEl] = useState<HTMLElement | null>(null);
  const [barFiltersEl, setBarFiltersEl] = useState<HTMLElement | null>(null);
  const [barChipsEl, setBarChipsEl] = useState<HTMLElement | null>(null);
  // While a list is being searched the title row IS the field
  // (./header-slots, `search`): no row is added anywhere.
  const [searchEl, setSearchEl] = useState<HTMLElement | null>(null);
  const [searching, setSearching] = useState(false);
  // The shelves' rule (PageHeader, `searchCollapse`): a field left empty
  // gives the title back, read off the DOM a task after the blur. A
  // NATIVE listener: the field is drawn into this row through a portal,
  // and React's onBlur bubbles up the component tree (to the list that
  // drew it), not up the DOM to this row, so a prop here never fired
  // (caught by the driven check: the row stayed open on Games alone).
  useEffect(() => {
    if (!searchEl) return;
    const onFocusOut = (): void => {
      setTimeout(() => {
        if (!searchEl.isConnected || searchEl.contains(document.activeElement)) return;
        if ((searchEl.querySelector('input')?.value ?? '') === '') setSearching(false);
      }, 0);
    };
    searchEl.addEventListener('focusout', onFocusOut);
    return () => searchEl.removeEventListener('focusout', onFocusOut);
  }, [searchEl]);
  const slots = useMemo(
    () =>
      lend
        ? {
            subtitle: subtitleEl,
            finders: findersEl,
            filters: filtersEl,
            barFinders: barFindersEl,
            barFilters: barFiltersEl,
            barChips: barChipsEl,
            search: searchEl,
            searching,
            setSearching,
          }
        : null,
    [lend, subtitleEl, findersEl, filtersEl, barFindersEl, barFiltersEl, barChipsEl, searchEl, searching],
  );
  const importButton = (
    <Button
      variant="default"
      size="sm"
      data-chrome-circle=""
      className="max-md:aspect-square max-md:px-0!"
      onClick={() => openImport.current?.()}
    >
      <Plus className="glyph" data-icon="inline-start" strokeWidth={2.5} />
      {/* Read out, not drawn, under md: the plus alone (see CreateControl). */}
              <span className="max-md:sr-only">{t('Import a game')}</span>
    </Button>
  );

  return (
    <GamesHeaderSlotsProvider value={slots}>
    <PageShell
      // xwide, not wide: at lg this page is a data table beside a
      // details column, and every extra pixel is another table column
      // shown instead of shed. Below lg no viewport reaches either cap.
      width="xwide"
      // From md the browser's lists scroll themselves and the page never
      // does: the tab strip and the toolbar stay put while the rows move,
      // which a table beside a details column wants. On a phone the page
      // is one scrolling column like every shelf (lanph3re, 2026-09-18):
      // the title, the chips and the rows scroll away together, and a
      // scroll up reveals the compact bar. The pinned rows were the one
      // page on a phone that did not move like the others.
      scroll={lend}
      // A pull at the top asks the open tab for its rows again
      // (hooks/use-pull-refresh). Only where the page scrolls, which is
      // the phone: from md the lists scroll themselves and this element
      // is not the scroller.
      onRefresh={() => refreshTab.current?.()}
      // Scrolling (a phone), the column is PageShell's own, floor and
      // all, and only needs to fill the screen when the list is short, so
      // an empty tab's message still centres in what is left.
      className={
        lend
          ? 'min-h-full'
          : 'h-full overflow-hidden pb-6 ios:h-[calc(100%+var(--bottom-bar-h))]'
      }
    >
      {/* Import on the title line, where Studies, Notes and Books put
          theirs: the page is a shelf of the reader's own games, and it
          gets a shelf's header, at every width. Below md it was a disc
          floating over the list's corner (see CreateControl for why
          that went); the one word is what fits beside a phone's large
          title, and the page it sits on already says what is imported.

          `sm`, the size every other page header's actions are drawn at
          (CreateControl on the four shelves, the puzzle book's own row).
          It was `default`, which on a phone is 16px against their 14 on
          the same line of the same header, and on a desktop a 32px
          button beside their 28. Both sizes stand 36px tall under a
          thumb, so nothing here was a hit area. */}
      <PageHeader
        title={t('Games')}
        // `contents` on all three: the lent places add no box of their
        // own, so what is drawn into them sits in the header's own flex
        // row and the subtitle's own line.
        // The zero-width space keeps the subtitle's line standing while a
        // tab has no count to say (a handle not looked up yet), so the
        // chips under it do not jump 20px between tabs.
        subtitle={
          lend ? (
            <>
              <span ref={setSubtitleEl} className="contents" />
              {'​'}
            </>
          ) : undefined
        }
        actions={
          <>
            {lend && <span ref={setFindersEl} className="contents" />}
            {lend && <span ref={setFiltersEl} className="contents" />}
            {importButton}
          </>
        }
        // The bar a scroll up reveals, on a phone: the same switches
        // (their own portal targets, since a target cannot be drawn
        // twice) and the source chips under them, so a source can be
        // changed from anywhere in a long list.
        titleRow={
          lend && searching ? (
            <div
              ref={setSearchEl}
              data-games-search=""
              className="flex min-w-0 flex-1 items-center gap-2"
            />
          ) : undefined
        }
        pinned={lend}
        pinnedActions={
          <>
            <span ref={setBarFindersEl} className="contents" />
            <span ref={setBarFiltersEl} className="contents" />
            {importButton}
          </>
        }
        pinnedBelow={<div ref={setBarChipsEl} className="min-w-0" />}
      />

      {/* minmax(0,1fr), not a bare fr: an fr track is min-content wide
          at its narrowest, so the table would silently refuse to shed
          columns. The details column keeps a floor a board is legible
          at and never grows past a reading width. The browser's own
          overlays (preview, FAB, import dialog) are fixed or portaled,
          so the pane is its only in-flow child here. */}
      {/* Complete class literals, all three of them: the Tailwind scanner
          reads names out of this file and would never emit one assembled
          from fragments. */}
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] items-stretch gap-4',
          showDetails &&
            (roomier
              ? 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,27rem)]'
              : 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,23rem)]'),
        )}
      >
        {/* On the page, not in a card: the strip, the search row and the
            rows are the page's own content, the way a shelf's cards are.
            The details column beside it is the one card here, because
            it is a second surface standing beside the first. */}
        <GamesBrowser
          table={wide}
          besideDetails={showDetails}
          detailsReservePx={
            wide && !pinned ? (roomier ? DETAILS_RESERVE_WIDE_PX : DETAILS_RESERVE_PX) : 0
          }
          frame="page"
          onSelect={setSelection}
          clearRef={clearSelection}
          importRef={openImport}
          refreshRef={refreshTab}
        />
        {/* The details column exists only where it has a column to
            stand in — mounted by the flag, not hidden by a class, so
            a phone never resolves selections for a panel nobody can
            see. */}
        {showDetails && (
          <GameDetailsPanel
            selection={selection}
            pinned={pinned}
            onTogglePin={togglePin}
            onClose={() => clearSelection.current?.()}
          />
        )}
      </div>
    </PageShell>
    </GamesHeaderSlotsProvider>
  );
}
