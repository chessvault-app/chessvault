import { Bookmark, Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { SearchInput, searchRowClass } from '@/components/text-fields';
import { Button } from '@/components/ui/button';
import { Inert, Skeleton } from '@/components/skeletons';
import { useElementWidth } from '@/hooks/use-element-width';
import { GamesTabStrip } from '@/games/GamesTabStrip';
import { GameListShell } from '@/games/GameListShell';
import { GameTableHeader, gameTableColumns, useGameTableVars } from '@/games/GameTable';
import {
  MoreFiltersButton,
  NotesSelect,
  OwnershipSelect,
  quickChip,
  ResultSelect,
  useFiltersFolded,
} from '@/games/GameFilters';
import { collectionLastCount, collectionWasNonEmpty } from '@/games/collection';
import { SelectButton } from '@/games/selection';
import {
  DETAILS_RESERVE_PX,
  DETAILS_RESERVE_WIDE_PX,
  MERGED_MIN_PX,
  PANEL_WIDE_MQ,
  PIN_FREE_MQ,
  TABLE_MQ,
  readDetailsPin,
} from '@/games/pane-shape';
import StudyOutline from '@/studies/StudyView.skeleton';
import { decodeSegment } from '@/lib/router';
import { useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The Games section while its chunk is on the wire.
 *
 * A collected game is a study with player bars, drawn from the same
 * module the studies shelf draws one from (studies/StudyView.skeleton),
 * so the two cannot disagree about where the board sits. `elite` is a
 * retired hash that lands on the collection, as GamesView reads it.
 */
export default function GamesOutline({ params = [] }: { params?: string[] }) {
  const id = params[0] && params[0] !== 'elite' ? decodeSegment(params[0]) : null;
  return id ? <StudyOutline id={id} kind="game" /> : <CollectionOutline />;
}

/**
 * The collection: its name and Import button, the strip of places a game
 * comes from, the search row, the filter band and the rows.
 *
 * It used to stop after the search row, and said why: whether this page
 * draws one-line table rows or three-line cards, and whether the filter
 * controls stand in a band or fold into the search row, comes from a
 * width the browser MEASURES, so reserving rows was guessing at their
 * height — measured at 1200px, six card placeholders came to 509px
 * against the 204px of table rows that replaced them. That was the right
 * conclusion from the wrong premise. None of it has to be guessed:
 *
 *  - which rows, from the same `lg` media query the page lays its grid
 *    out on (pane-shape, TABLE_MQ);
 *  - which columns, from whether a details column stands, which is this
 *    device's stored pin and a media query and nothing else at mount,
 *    since no game is selected yet (pane-shape, readDetailsPin);
 *  - where the filters stand, by MEASURING the same element the browser
 *    measures — this outline draws the same strip, so the same
 *    ResizeObserver over it answers the same question (`merged`).
 *
 * So the outline draws the page's whole first screen, out of the page's
 * own pieces: GameListShell owns every band's padding and rule, and the
 * placeholder rows and filter row are the ones the page itself draws
 * while its games are in flight. Held inert as a whole (skeletons,
 * `Inert`) — every control in it is the real one, and a placeholder's
 * controls take no focus and no clicks.
 *
 * Two things are deliberately left to the page. The DETAILS column's
 * card is not drawn: its track is reserved by the same grid class, so
 * the table lands at its settled width and the card arrives into an
 * empty column, moving nothing. And the toolbar's filter selects are not
 * drawn where they ride the search row — the page does not draw them
 * there either until it knows the collection has games (CollectionList,
 * `showFilters`), and this reads the same remembered flag.
 */
function CollectionOutline() {
  const wide = useMediaQuery(TABLE_MQ);
  const roomy = useMediaQuery(PIN_FREE_MQ);
  const roomier = useMediaQuery(PANEL_WIDE_MQ);
  // No selection exists yet, so the column stands exactly when it is
  // pinned; the stored choice wins over the width, as on the page.
  const pinned = readDetailsPin() ?? roomy;
  const besideDetails = wide && pinned;
  const detailsReservePx = wide && !pinned ? (roomier ? DETAILS_RESERVE_WIDE_PX : DETAILS_RESERVE_PX) : 0;
  // The header's half of the fold: a phone's title row carries the
  // list's switches, the filters one only where the pane would draw
  // its filters (CollectionPaneOutline reads the same flag).
  const folded = useFiltersFolded();
  const showFilters = folded && collectionWasNonEmpty();

  return (
    <PageShell
      // xwide and unscrolling, as CollectionView: at lg the page is a
      // data table beside a details column, and its lists scroll
      // themselves so the page never does.
      width="xwide"
      // A phone's page scrolls as one column (CollectionView); from md
      // the lists scroll themselves. The same two shapes, so the rows
      // land where the outline drew them.
      scroll={folded}
      className={folded ? 'min-h-full' : 'h-full overflow-hidden pb-6'}
    >
      <Inert>
        <PageHeader
          title={t('Games')}
          // A phone's page lends its title row to the list (games/
          // header-slots): the count is the subtitle, and the search,
          // bookmark and filters switches stand beside Import. The same
          // real controls, held still, in the same order.
          subtitle={folded ? <Tally /> : undefined}
          actions={
            <>
              {folded && (
                <>
                  <Button variant="secondary" size="icon-sm" className="shrink-0">
                    <Search className="glyph" />
                  </Button>
                  <Button variant="secondary" size="icon-sm" className="shrink-0">
                    <Bookmark className="glyph" />
                  </Button>
                  {showFilters && <MoreFiltersButton on={false} onClick={NOOP} />}
                </>
              )}
              <Button variant="default" size="sm" data-chrome-circle="" className="max-md:aspect-square max-md:px-0!">
                <Plus className="glyph" data-icon="inline-start" strokeWidth={2.5} />
                {/* Read out, not drawn, under md: the plus alone (see CreateControl). */}
              <span className="max-md:sr-only">{t('Import a game')}</span>
              </Button>
            </>
          }
        />
        <div
          className={cn(
            'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] items-stretch gap-4',
            besideDetails &&
              (roomier
                ? 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,27rem)]'
                : 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,23rem)]'),
          )}
        >
          {/* The browser's own box on a page: a column with the card
              variable pinned to the ground, which is what Box draws for
              `frame="page"` (GamesBrowser). */}
          <div className="flex min-h-0 flex-col [--card:var(--background)]">
            <CollectionPaneOutline frame="page" besideDetails={besideDetails} detailsReservePx={detailsReservePx} />
          </div>
        </div>
      </Inert>
    </PageShell>
  );
}

/**
 * The collection pane itself: the tab strip over the list shell, with the
 * toolbar, the header and the placeholder rows the browser draws while
 * its games are out. One component for both hosts, the Games page
 * (`frame="page"`) and the workspace's band (`frame="panel"`), because
 * they are one browser (GamesBrowser) in two boxes. The workspace drew a
 * looser copy of this, which never set the table's column template: its
 * header stood as a stacked column and its filters on a row of their
 * own, 88px of drift that check:skeletons found on its first run.
 */
export function CollectionPaneOutline({
  frame,
  besideDetails = false,
  detailsReservePx = 0,
}: {
  frame: 'page' | 'panel';
  /** A details column stands beside the table, which drops Notation. */
  besideDetails?: boolean;
  /** Room the pane keeps free for a details column that may open. */
  detailsReservePx?: number;
}) {
  const wide = useMediaQuery(TABLE_MQ);
  // The same measurement GamesBrowser makes, over the same element: the
  // strip's own wrapper, which is the pane's full width.
  const [paneRef, paneW] = useElementWidth();
  const merged = wide && paneW > 0 && paneW - detailsReservePx >= MERGED_MIN_PX;
  const folded = useFiltersFolded();
  const filtersInRow = merged || folded;
  const table = wide;
  // The column template the header and the placeholder rows both lay
  // out on, from the widths this device dragged them to.
  const tableVars = useGameTableVars(false, !besideDetails);
  // Where the controls ride the search row, the page draws them before
  // its games land — but only for a device that has seen this vault's
  // collection hold something, which is the same flag CollectionList
  // reads (`showFilters`). Without them the phone's search box stood
  // 42px wide of where it settles.
  const showFilters = filtersInRow && collectionWasNonEmpty();
  return (
    <>
    <GamesTabStrip value="collection" onValueChange={NOOP} frame={frame} stripRef={paneRef} />
    <GameListShell
      shape={frame}
      dense={table}
      denseColumns={gameTableColumns(false, !besideDetails)}
      rowBookmark
      rowLink
      listLoading
      filtersLoading={!filtersInRow}
      listHeader={
        table ? <GameTableHeader withNotation={!besideDetails} /> : undefined
      }
      listVars={table ? tableVars : undefined}
      toolbar={
        // No standing search row on a phone: the magnifier opens it.
        folded ? undefined : (
        <div className="flex w-full flex-col gap-2">
          <div className={cn('flex w-full items-center gap-1.5', searchRowClass, merged && 'flex-wrap')}>
            <SearchInput
              type="text"
              inputSize="sm"
              value=""
              readOnly
              placeholder={t('Search collection…')}
              aria-label={t('Search collection…')}
              className="min-w-0 flex-1"
            />
            <Button variant="secondary" size="icon-sm" className="shrink-0">
              <Bookmark className="glyph" />
            </Button>
            {showFilters && (
              <>
                <OwnershipSelect
                  value="any"
                  onChange={NOOP}
                  className={quickChip(false)}
                />
                <ResultSelect
                  value="any"
                  onChange={NOOP}
                  className={quickChip(false)}
                />
                <NotesSelect
                  value="any"
                  onChange={NOOP}
                  className={quickChip(false)}
                />
                <MoreFiltersButton on={false} onClick={NOOP} />
              </>
            )}
            {merged && <MergedTally tally={<Tally />} select={<SelectReserve />} />}
          </div>
        </div>
        )
      }
      countBand={
        merged || folded ? undefined : (
          <>
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
              <Tally />
            </span>
            <SelectReserve />
          </>
        )
      }
    />
    </>
  );
}

/**
 * The tally's bar, at the width of the words that are coming.
 *
 * CollectionList's own reservation, read the same way: the count this
 * device last saw is laid out invisibly and a bar painted over it, so a
 * returning collection's "n games" lands on the placeholder to the
 * pixel. A device that has never read the collection gets the 4rem
 * fallback, which is the same compromise that file settled on (no single
 * width suits one digit and four).
 */
export function Tally() {
  const last = collectionLastCount();
  if (last === null) return <Skeleton className="h-2.5 w-16" />;
  return (
    <span className="relative inline-block">
      <span className="invisible">{t('{n} games', { n: last.toLocaleString() })}</span>
      <Skeleton className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2" />
    </span>
  );
}

/**
 * The count and the way into selecting, where they ride the search row's
 * end (the merged toolbar). The list and its outline both draw this, for
 * the frame as much as the contents: the outline had the count's
 * placeholder outside the text-sm font-medium span the count is set in,
 * so the invisible words it is sized by were measured in another face
 * and the filters before it stood 2px right (check:skeletons).
 */
export function MergedTally({ tally, select }: { tally: React.ReactNode; select?: React.ReactNode }) {
  return (
    <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
      <span className="text-muted-foreground min-w-0 truncate text-sm font-medium tabular-nums">{tally}</span>
      {select}
    </span>
  );
}

/**
 * Room for "Select…", which the list draws beside its count once it has
 * games to select. On the merged row nothing held its place, and the
 * filters stepped 75px left as it landed (check:skeletons, the workspace
 * at 1280). Reserved only where the collection last held games, which is
 * when the button comes; the real button, unseen and inert, because its
 * width is the language's.
 */
export function SelectReserve() {
  const last = collectionLastCount();
  if (last === null || last === 0) return null;
  return (
    <span inert aria-hidden className="invisible">
      <SelectButton onClick={NOOP} />
    </span>
  );
}

const NOOP = (): void => {};
