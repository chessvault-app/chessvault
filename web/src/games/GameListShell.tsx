import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Panel, PanelHeader } from '@/components/panel';
import { Spinner } from '@/components/ui/spinner';
import { SkeletonFilterRow, SkeletonGameRows } from '@/components/skeletons';
import { usePinnedBand } from '@/hooks/use-pinned-band';
import { FilterRow } from './GameFilters';
import type { GameColumn } from './GameTable';

/**
 * Where a list of games is standing, which decides what it brings.
 *
 * - `framed` — its own Panel and PanelHeader: a card on a page.
 * - `panel`  — hosted in the games browser's Panel, behind the source
 *              tabs: no frame or title of its own, and the toolbar
 *              clears the tab bar's lit rule with an extra step of top
 *              padding.
 * - `page`   — the same browser standing on a page's own column with no
 *              Panel around it (the Games page): every band keeps its
 *              rule but drops its side padding, so the search field and
 *              the count start on the page's edge, level with the title
 *              above, the way a shelf's search row does. The rows keep
 *              their own inset; a hairline that runs to the edge with
 *              text 12px in is what a table looks like on a page.
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
export type GameListShape = 'framed' | 'panel' | 'page' | 'sheet';

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
  listHeader,
  listVars,
  list,
  listClassName,
  listLoading = false,
  listBusy = false,
  dense = false,
  rowBookmark = false,
  rowLink = false,
  denseColumns,
  more,
  end,
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
  /** A band pinned directly above the list — the table mode's column
      header. Outside the ul on purpose: the ul's nth-child stripe and
      sentinel arithmetic count rows, and a header standing among them
      would shift both by one. With a header, the shell wraps header
      and list in ONE two-axis scroller (header sticky), so a table
      wider than the pane scrolls sideways as a unit instead of the
      header and rows shearing apart. */
  listHeader?: ReactNode;
  /** CSS variables for the table wrapper — the pane's column template
      (see useGameTableVars), read by header and rows alike. */
  listVars?: CSSProperties;
  /** The rows. null/undefined with listLoading false means no list band
      at all (nothing looked up yet — see `tail`). */
  list?: ReactNode;
  /** Scrolling behaviour and any per-list container extras (zebra,
      height caps) — the shell owns only what every list shares. */
  listClassName?: string;
  /** Rows are on their way: skeleton rows REPLACE the list's contents
      (never stack above them). */
  listLoading?: boolean;
  /** A fresh answer is out for rows that are still on screen: they
      stay, dimmed, and the list says it is busy. The placeholder is for
      an empty list; this is for a stale one. */
  listBusy?: boolean;
  /** One-line table rows: the virtualization's intrinsic size drops to
      match, so offscreen rows reserve a row's height, not a card's. */
  dense?: boolean;
  /** What this list's CARD rows carry at their trailing end, so the
      placeholder rows carry the same: the collection's bookmark star
      and its link column, neither of which the archive or the database
      draws. The shell asks rather than guessing, because a tray that
      stands in for the wrong list is width the player names give up the
      moment the games land. */
  rowBookmark?: boolean;
  rowLink?: boolean;
  /** Dense only: the columns the table is drawing, so the placeholder
      rows land in the same tracks the column header above them does. */
  denseColumns?: GameColumn[];
  /** The infinite-scroll sentinel row at the list's foot. */
  more?: { ref: Ref<HTMLLIElement>; label: string } | null;
  /** What the list's foot says once every row is in: the tally. Opt-in,
      for a list the PAGE scrolls; a boxed list ends at its box. */
  end?: ReactNode;
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
  // The page shape's bands stand on the column's edge (see the type).
  // One token, applied to every band the shell draws, so the rail of
  // controls moves as one; FilterRow carries px-3 of its own, and cn's
  // tailwind-merge lets this override it.
  const bandX = shape === 'page' ? 'px-0' : 'px-3';
  // The table's own column header pins over the rows, so the wrapper it
  // pins inside scrolls a focused row's controls clear of it.
  const pinHeader = usePinnedBand('top');

  const bands = (
    <>
      {filtersLoading && <SkeletonFilterRow className={cn(filterBorder, bandX)} />}
      {filters != null && (
        <div ref={filtersRef}>
          <FilterRow className={cn(filterBorder, bandX)}>{filters}</FilterRow>
        </div>
      )}
      {notice != null && (
        <div className={cn('flex flex-wrap items-center gap-2 py-2', bandX)}>{notice}</div>
      )}
      {countBand != null && (
        // px-3 on BOTH sides and gap-1.5, both matching the toolbar and
        // filter rows above: pr-1.5 used to put this band's icon button
        // 6px right of theirs, and gap-2 put its SELECT 2px left of
        // theirs — a rail of controls that almost lined up reads worse
        // than one that plainly does not.
        // 37px measured: a band holding sm controls stands h-7 + py-1 +
        // border-t, and a text-only band must claim the same or the count
        // row jumps a few pixels when the tab beside it holds controls.
        // (min-height is border-box, so the border is inside the number.)
        // On a coarse pointer the same controls are h-9, so the band is
        // 45px there: the collection's text-only band stood 37 beside the
        // databases' and the archives' 45 (lanph3re's report).
        <div
          className={cn(
            'border-border flex min-h-[2.3125rem] flex-wrap items-center gap-1.5 border-t py-1 text-sm pointer-coarse:min-h-[2.8125rem]',
            bandX,
          )}
        >
          {countBand}
        </div>
      )}
      {(list != null || listLoading) &&
        (() => {
          const rows = (
            <>
            {/* The wait, said once, beside the list rather than on it.
                The placeholder rows ARE the list's rows now (see
                listLoading below): they used to be one <li> wrapping six
                divs under a role=status of their own, which put every
                rule this ul draws — the hairlines, the zebra stripe, the
                intrinsic size — outside them, so a striped list settled
                under an unstriped placeholder. The announcement could
                not simply move onto the ul with them: a live region that
                then fills with fifty game rows is a live region that
                reads fifty game rows out. */}
            {listLoading && (
              <span className="sr-only" role="status" aria-live="polite">
                {t('Loading')}
              </span>
            )}
            <ul
              aria-busy={listBusy || listLoading || undefined}
              className={cn(
                // Named container: GameRow's narrow-row rules answer to the
                // list's own width, not the window's.
                '@container/arc divide-border border-border min-h-0 divide-y',
                // Under a column header the top rule is the header's own
                // (see the sticky wrapper below), so it stays when rows scroll.
                listHeader == null && 'border-t',
                // Stale rows under a fresh search: half-dimmed, on a short
                // fade so a fast answer (under useSlowLoad's hold) never
                // shows it at all.
                'transition-opacity duration-150',
                listBusy && 'opacity-50',
                // Dividers AND a faint stripe on every other row: at two
                // lines a row is tall enough that a hairline alone leaves the
                // list reading as one block of text. 2% of the foreground —
                // enough to group the lines that belong together, not enough
                // to read as a highlight. The archive list was the one of the
                // three without it, for no reason anyone could name.
                //
                // The stripe stands DOWN for a hovered or selected row: this
                // selector (.class > li:nth-child(even)) is more specific
                // than the row's own hover:bg-accent and bg-accent, so
                // without the :not guards every even row swallowed both —
                // half the list answered a pointer with nothing.
                '[&>li:nth-child(even):not(:hover):not([data-selected])]:bg-foreground/[0.022]',
                // The virtualization the shell bought, in its cheapest form:
                // offscreen rows skip render and layout entirely, onscreen
                // ones pay as before. A deep scroll through a big database
                // accumulates thousands of rows (50 per page, uncapped), and
                // this keeps them from all laying out on every frame — while
                // the DOM stays intact, so the nth-child stripe, the scroll
                // sentinel and find-in-page all keep working, which is what
                // a windowed renderer would have had to rebuild. The
                // intrinsic size matches a two-line row; `auto` remembers
                // the real height once a row has rendered.
                '[&>li]:[content-visibility:auto]',
                dense
                  ? '[&>li]:[contain-intrinsic-size:auto_var(--row-h-table)]'
                  : '[&>li]:[contain-intrinsic-size:auto_3.25rem]',
                // In the table wrapper the ul keeps the columns' own
                // minimum (that is what makes the wrapper scroll
                // sideways) and the wrapper does the scrolling; the ul's
                // own scrolling classes move up to it. The minimum is
                // the STATED sum from useGameTableVars, never
                // min-w-fit: fit-content resolves fr tracks at
                // max-content, which blew the notation column out to
                // the widest untruncated line.
                listHeader != null ? 'min-w-[var(--gt-min)]' : listClassName,
              )}
            >
              {listLoading ? (
                // The SAME `dense` the intrinsic size above reads. A list
                // in table mode draws one-line rows, and the placeholder
                // drew the card's three whatever was coming: measured at
                // 1200px, six placeholders came to 509px against the 204px
                // of table rows that replaced them.
                <SkeletonGameRows
                  rows={6}
                  dense={dense}
                  columns={denseColumns}
                  bookmark={rowBookmark}
                  link={rowLink}
                />
              ) : (
                list
              )}
              {!listLoading && more && (
                // The sentinel the observer watches, not a row: it is the
                // list's floor, one of it however many games are above,
                // and its padding is the room the spinner sits in rather
                // than a rhythm anything repeats. Density leaves it.
                <li ref={more.ref} className="flex items-center justify-center gap-2 p-3">
                  <Spinner className="text-muted-foreground size-4" />
                  <span className="text-muted-foreground text-sm">{more.label}</span>
                </li>
              )}
              {!listLoading && !more && list != null && end != null && (
                // The list's floor once there is nothing left to load. A
                // phone's page ran from its last row straight into bare
                // ground, with no rule under the row and nothing saying the
                // rows had ended rather than stopped arriving (lanph3re's
                // report). An li, so divide-y closes the last row with the
                // same hairline every other row has; never striped, since it
                // is not a row.
                <li className="text-muted-foreground bg-transparent! p-4 text-center text-xs tabular-nums">
                  {end}
                </li>
              )}
            </ul>
            </>
          );
          if (listHeader == null) return rows;
          return (
            <div
              className={cn('flex min-h-0 flex-col overflow-auto', listClassName)}
              style={listVars}
            >
              {/* Sticky, opaque, and as wide as the rows: the header
                  scrolls sideways WITH the table and stays put over a
                  vertical scroll. */}
              {/* The rule under the header is the HEADER's, not the list's:
                  as the ul's border-t it scrolled away with the first row
                  (measured: 200px of scroll took it 200px up) and left rows
                  sliding under an edge nothing drew, header and rows
                  sharing one fill. The shadow joins it once rows are
                  beneath (scrolled-shadow, styles/utilities.css). */}
              <div
                ref={pinHeader}
                className="bg-card border-border scrolled-shadow sticky top-0 z-10 min-w-[var(--gt-min)] shrink-0 border-b"
              >
                {listHeader}
              </div>
              {rows}
            </div>
          );
        })()}
      {footnote}
      {tail}
    </>
  );

  const body = (
    <>
      {toolbar != null && (
        <div
          className={cn(
            // empty:hidden, for a toolbar that is an element drawing
            // nothing (a phone's lifted lists pass only their query
            // issues, which are usually none): the padding below would
            // otherwise stand an empty band over the rows.
            'flex flex-col gap-2 empty:hidden',
            // A sheet's card already pads by 3 on every side; the framed
            // card pads nothing; the panel adds a step of top clearance
            // under the tab bar's lit rule — less of one at table
            // density, where the toolbar's rows are the chrome standing
            // between a short pane (the workspace's games band) and its
            // game rows, and every reclaimed step is a row shown.
            shape === 'sheet' && 'pb-2 pt-1',
            shape === 'framed' && 'px-3 pb-3 pt-3',
            // py-2 at table density, matching FilterRow's own rhythm: the
            // merged control rows and the filter rows read as one system
            // when every band pads its controls by the same 8px.
            shape === 'panel' && (dense ? 'px-3 py-2' : 'px-3 pb-3 pt-4'),
            // The panel's rhythm without its inset: on a page the toolbar
            // is the row under the tab strip's rule, and its field starts
            // where the title does.
            shape === 'page' && (dense ? 'py-2' : 'pb-3 pt-4'),
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
