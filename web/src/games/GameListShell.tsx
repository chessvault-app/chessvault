import type { ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';
import { Panel, PanelHeader } from '@/components/panel';
import { Spinner } from '@/components/ui/spinner';
import { SkeletonFilterRow, SkeletonGameRows } from '@/components/skeletons';
import { FilterRow } from './GameFilters';

/**
 * Where a list of games is standing, which decides what it brings.
 *
 * - `framed` — its own Panel and PanelHeader: a card on a page.
 * - `panel`  — hosted in the Games column's existing Panel, behind the
 *              source tabs: no frame or title of its own, and the toolbar
 *              clears the tab bar's lit rule with an extra step of top
 *              padding.
 * - `sheet`  — inside a DialogContent: no frame or title (the window's
 *              title bar is the only title), and every band below the
 *              toolbar bleeds to the card's edges so its rules meet the
 *              sides.
 *
 * One vocabulary for the three lists. The archive named its places
 * `framed | panel | window` and the elite browser named its
 * `page | window | column` — and `window` meant "bring no frame" in one
 * and "bring a Panel" in the other, which is how the elite phone sheet
 * became a card inside a card.
 */
export type GameListShape = 'framed' | 'panel' | 'sheet';

/**
 * The stack of bands every list of games is made of, in fixed order:
 * toolbar → filter row → notice → count band → list (+ sentinel) →
 * footnote → tail. Each band separates itself from the one above with a
 * single border-t rule; the filter row draws it only when a toolbar
 * stands above it (in the collection the search lives in the panel
 * header, and a rule under a header that draws none would be a new line,
 * not a moved one).
 *
 * The shell owns the chrome — paddings, borders, the count band's box,
 * the list container, the sentinel row, the loading skeletons — and the
 * callers own the content. The border-t/border-b mix, the min-h-8 vs
 * min-h-6 count bands and the skeletons that stacked above their list
 * instead of replacing it all came from three views hand-assembling
 * these same bands.
 */
export function GameListShell({
  shape,
  title,
  headerActions,
  headerActionsClassName,
  panelClassName,
  toolbar,
  filtersLoading = false,
  filters,
  filtersRef,
  notice,
  countBand,
  list,
  listClassName,
  listLoading = false,
  more,
  footnote,
  tail,
}: {
  shape: GameListShape;
  /** framed only: the PanelHeader's title. */
  title?: ReactNode;
  /** framed only: controls in the PanelHeader, beside the title. */
  headerActions?: ReactNode;
  headerActionsClassName?: string;
  /** framed only: sizing for the Panel itself. */
  panelClassName?: string;
  /** The band above the filters: search fields, provider tabs, recents. */
  toolbar?: ReactNode;
  /** The filter strip is still loading — reserve its row so nothing
      below jumps when it lands. */
  filtersLoading?: boolean;
  /** Contents of the FilterRow. The shell draws the row and its border. */
  filters?: ReactNode;
  /** Scroll anchor around the filter band (the archive scrolls to it
      when a looked-up account lands). */
  filtersRef?: Ref<HTMLDivElement>;
  /** One line of state — offline, an error — between filters and count. */
  notice?: ReactNode;
  /** Contents of the count band: the tally, selection controls. */
  countBand?: ReactNode;
  /** The rows. null/undefined with listLoading false means no list band
      at all (nothing looked up yet — see `tail`). */
  list?: ReactNode;
  /** Scrolling behaviour and any per-list container extras (zebra,
      height caps) — the shell owns only what every list shares. */
  listClassName?: string;
  /** Rows are on their way: skeleton rows REPLACE the list's contents
      (never stack above them). */
  listLoading?: boolean;
  /** The infinite-scroll sentinel row at the list's foot. */
  more?: { ref: Ref<HTMLLIElement>; label: string } | null;
  /** The one-line note under the list (the archive's row cap). */
  footnote?: ReactNode;
  /** Whole-pane states below everything: empty prompts, pre-list
      skeleton fills. Fully formed — these are the next seam to unify. */
  tail?: ReactNode;
}) {
  // The filter band's rule, and the skeleton that stands in for it,
  // share one derivation — which is what makes a double border
  // impossible by construction.
  const filterBorder = toolbar ? 'border-t' : undefined;

  const bands = (
    <>
      {filtersLoading && <SkeletonFilterRow className={filterBorder} />}
      {filters != null && (
        <div ref={filtersRef}>
          <FilterRow className={filterBorder}>{filters}</FilterRow>
        </div>
      )}
      {notice != null && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">{notice}</div>
      )}
      {countBand != null && (
        <div className="border-border flex min-h-8 flex-wrap items-center gap-2 border-t px-3 py-1 pr-1.5 text-sm">
          {countBand}
        </div>
      )}
      {(list != null || listLoading) && (
        <ul
          className={cn(
            // Named container: GameRow's narrow-row rules answer to the
            // list's own width, not the window's.
            '@container/arc divide-border border-border min-h-0 divide-y border-t',
            // Dividers AND a faint stripe on every other row: at two
            // lines a row is tall enough that a hairline alone leaves the
            // list reading as one block of text. 2% of the foreground —
            // enough to group the lines that belong together, not enough
            // to read as a highlight. The archive list was the one of the
            // three without it, for no reason anyone could name.
            '[&>li:nth-child(even)]:bg-foreground/[0.022]',
            listClassName,
          )}
        >
          {listLoading ? (
            <li>
              <SkeletonGameRows rows={6} />
            </li>
          ) : (
            list
          )}
          {!listLoading && more && (
            <li ref={more.ref} className="flex items-center justify-center gap-2 p-3">
              <Spinner className="text-muted-foreground size-4" />
              <span className="text-muted-foreground text-sm">{more.label}</span>
            </li>
          )}
        </ul>
      )}
      {footnote}
      {tail}
    </>
  );

  const body = (
    <>
      {toolbar != null && (
        <div
          className={cn(
            'flex flex-col gap-2',
            // A sheet's card already pads by 3 on every side; the framed
            // card pads nothing; the panel adds a step of top clearance
            // under the tab bar's lit rule.
            shape === 'sheet' && 'pb-2 pt-1',
            shape === 'framed' && 'px-3 pb-3 pt-3',
            shape === 'panel' && 'px-3 pb-3 pt-4',
          )}
        >
          {toolbar}
        </div>
      )}
      {/* A sheet's bands bleed back out to the card's edges so their
          rules meet the sides. -mx-4, matching DialogContent's px-4: the
          old -mx-3 assumed a 12px card padding the dialog no longer has,
          so every rule stopped 4px short of the sheet's edges. */}
      {shape === 'sheet' ? <div className="-mx-4 flex flex-col">{bands}</div> : bands}
    </>
  );

  if (shape !== 'framed') return body;
  return (
    <Panel className={panelClassName}>
      <PanelHeader
        title={title}
        actions={headerActions}
        actionsClassName={headerActionsClassName}
      />
      {body}
    </Panel>
  );
}
