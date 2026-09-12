import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';

import { useMediaQuery } from '@/lib/media';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';

import { GameDetailsPanel, type DetailsSelection } from './GameDetails';
import { GamesBrowser } from './GamesBrowser';

/**
 * Whether the details column keeps its place when nothing is selected —
 * a reading preference, per device, the way the table's dragged column
 * widths (vault:game-table-cols) and the panels' heights (vault:panel-h:*)
 * are. Written on every toggle rather than removed when it agrees with
 * the default below, because that default MOVES with the window: a
 * choice erased for matching it would be undone by a resize, which is
 * the one thing an explicit switch must not do.
 */
const PIN_KEY = 'vault:games-details-pinned';

/**
 * The viewport where the details column is FREE — where the table still
 * shows every column beside it, so keeping the panel open costs nothing
 * and the default stays what it has always been.
 *
 * Arithmetic first: the dense table states its own minimum, and
 * `--gt-min` measures 1026px at the default column widths (GameTable's
 * COLUMNS sum to 930, plus nine 8px gaps and the row's px-3). Beside it
 * the panel's track takes its 23rem max — measured at exactly 368 — the
 * grid's gap is 16, and the page loses the sidebar's 13rem and the
 * shell's md gutters: 1026 + 368 + 16 + 208 + 48 = 1666.
 *
 * Then measured, because 1666 is 10px short: the list scrolls itself,
 * and index.css's thin scrollbar takes its 10px out of the scroller's
 * content box, so at 1666 the table still scrolled sideways by exactly
 * that (clientWidth 1016 against scrollWidth 1026). 1680 is the round
 * number above it, and measures clean — 1030 against 1030.
 *
 * The 208 is the sidebar unfolded. Folded to its rail it gives 140 of
 * that back, so the panel is free from about 1540 — but a media query
 * cannot see the fold, and erring towards "not free" only means a wide
 * window with a folded rail starts unpinned when it could have started
 * pinned, which the switch in the panel's header corrects once.
 *
 * Below that width the panel is paid for in table columns — the table
 * never sheds them, it scrolls sideways to reach them (GameTable) — so a
 * window that narrow starts with the column given back and spends it on
 * the panel only while a game is actually selected.
 */
const PIN_FREE_MQ = '(min-width: 1680px)';

/**
 * Where the details column stops being 23rem and takes 27rem.
 *
 * The track was `minmax(20rem,23rem)` at every width, so a 1920px window
 * gave the table 1104px and left the panel on the same 368px a 1024px
 * window gets — the one width where the panel costs the table nothing
 * was also the width where it refused the room. 368px is tight for what
 * the panel is for: the opening name, the thing a reader actually wants
 * off it, truncates there ("…: Exchange Variation, Reshevs…") and reads
 * in full on a 390px phone's sheet.
 *
 * The threshold is the same arithmetic PIN_FREE_MQ states, with the
 * panel's new maximum in it: the table's own minimum (`--gt-min`, 1026
 * at the default column widths), the grid's 16px gap, 432 for a 27rem
 * panel, the sidebar's 208 unfolded and the shell's 48 of md gutters,
 * which is 1730 — plus the 10px the thin scrollbar takes out of the
 * scroller's content box, the same 10 that put PIN_FREE_MQ at 1680
 * rather than its arithmetic's 1666. So 1740, and below it the panel
 * stays 23rem, because a wider panel there is paid for in the table's
 * columns and that is exactly what the 1680 line exists to stop.
 */
const PANEL_WIDE_MQ = '(min-width: 1740px)';

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
  const wide = useMediaQuery('(min-width: 64rem)');
  /** What the browser last selected — the details column's subject. */
  const [selection, setSelection] = useState<DetailsSelection | null>(null);
  // null = nobody has chosen on this device, so the width decides.
  const [choice, setChoice] = useState<boolean | null>(() => {
    const stored = localStorage.getItem(PIN_KEY);
    return stored === null ? null : stored === '1';
  });
  const roomy = useMediaQuery(PIN_FREE_MQ);
  /** Whether the panel's track may take its wider maximum — see PANEL_WIDE_MQ. */
  const roomier = useMediaQuery(PANEL_WIDE_MQ);
  const pinned = choice ?? roomy;
  const togglePin = (): void => {
    const next = !pinned;
    setChoice(next);
    try {
      localStorage.setItem(PIN_KEY, next ? '1' : '0');
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

  return (
    <PageShell
      // xwide, not wide: at lg this page is a data table beside a
      // details column, and every extra pixel is another table column
      // shown instead of shed. Below lg no viewport reaches either cap.
      width="xwide"
      scroll={false}
      // Pinned at every width: the browser's lists scroll themselves,
      // so the page never scrolls — the tab strip and the toolbar stay
      // put while the rows move, on a phone exactly as on the desktop.
      className="h-full overflow-hidden pb-3 sm:pb-4 md:pb-6"
    >
      {/* Import on the title line, where Studies, Notes and Books put
          theirs: the page is a shelf of the reader's own games, and it
          gets a shelf's header, at every width. Below md it was a disc
          floating over the list's corner (see CreateControl for why
          that went); the one word is what fits beside a phone's large
          title, and the page it sits on already says what is imported. */}
      <PageHeader
        title={t('Games')}
        actions={
          <Button variant="default" size="default" onClick={() => openImport.current?.()}>
            <Plus className="size-3.5" data-icon="inline-start" strokeWidth={2.5} />
            <span className="md:hidden">{t('Import')}</span>
            <span className="max-md:hidden">{t('Import a game')}</span>
          </Button>
        }
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
          frame="page"
          onSelect={setSelection}
          clearRef={clearSelection}
          importRef={openImport}
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
  );
}
