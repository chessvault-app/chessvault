import { Bookmark, Eye, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { GAME_TABLE_GRID, gameTableColumns, type GameColumn } from '@/games/GameTable';
import { t } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import { INERT, Inert, Loading } from './primitives';

/**
 * The filter strip a list of games wears above its rows: three narrow
 * selects and a button, on the same 28px trigger height (36 under a
 * coarse pointer) inside the same px-3 py-2 as GameFilters' FilterRow.
 *
 * It exists because that row is drawn only once there are games to
 * filter, so a list that is still loading has nothing there and every row
 * below moves down by its 45px the moment the games arrive.
 *
 * The border side comes from the caller, like FilterRow's own: a baked-in
 * border-b under an archive strip that passes border-t drew both.
 */
export function SkeletonFilterRow({ className }: { className?: string }) {
  return (
    <Loading
      className={cn(
        'border-border flex flex-wrap items-center gap-1.5 px-3 py-2',
        className,
      )}
    >
      {/* The collection's three quick selects (GameFilters: whose games,
          result, notes), each at its resting value, and the More filters
          button, all inert. The COLLECTION's, and only its: this used to
          be drawn for the archive too, whose row is a month, a side and
          a result, so that list waited behind three words it does not
          use. The archive draws its own controls held still now
          (ArchiveBrowser, `waitingFilters`), which is also why nothing
          here needs a shape prop. Inert rather than only disabled: see
          `Inert`. */}
      <Inert>
        <Select
          value="any"
          ariaLabel={t('Whose games')}
          size="sm"
          className="min-w-0 flex-1"
          disabled
          groups={[
            {
              options: [
                { value: 'any', label: t("Anyone's games") },
                { value: 'mine', label: t('My games') },
                { value: 'white', label: t('Mine as White') },
                { value: 'black', label: t('Mine as Black') },
              ],
            },
          ]}
        />
        <Select
          value="any"
          ariaLabel={t('Result')}
          size="sm"
          className="min-w-0 flex-1"
          disabled
          groups={[
            {
              options: [
                { value: 'any', label: t('Any result') },
                { value: '1-0', label: t('White won') },
                { value: '0-1', label: t('Black won') },
                { value: '1/2-1/2', label: t('Drawn') },
              ],
            },
          ]}
        />
        <Select
          value="any"
          ariaLabel={t('Notes')}
          size="sm"
          className="min-w-0 flex-1"
          disabled
          groups={[
            {
              options: [
                { value: 'any', label: t('All games') },
                { value: 'annotated', label: t('With notes') },
              ],
            },
          ]}
        />
        <Button variant="secondary" size="icon-sm" className="relative shrink-0" {...INERT}>
          <SlidersHorizontal className="glyph" />
        </Button>
      </Inert>
    </Loading>
  );
}

/**
 * A game row: two players over a line of date and opening, a result, the
 * peek eye and the collect button.
 *
 * Its own shape rather than the generic list row, which starts with an
 * icon a game row does not have and is a line shorter — so the list
 * resized under you when the games landed.
 */
export function SkeletonGameRows({
  rows = 6,
  dense = false,
  bookmark = false,
  link = false,
  columns,
}: {
  rows?: number;
  /** Dense only: the columns the table above these rows is drawing
      (`gameTableColumns(selecting, withNotation)`), so the bars land in
      the same tracks its header does. */
  columns?: GameColumn[];
  /** The list's card rows carry a bookmark star in the tray — the
      collection's do, the archive's and the database's do not. */
  bookmark?: boolean;
  /** The list's card rows keep the trailing link column (GameRow's
      `showLink`), which only the collection does. */
  link?: boolean;
  /**
   * The table's one-line row, not the card's three.
   *
   * The same list draws either shape — GameListShell already carries this
   * as a prop, and already uses it to set the virtualisation's intrinsic
   * size — but its loading branch drew the card row whatever was coming.
   * Measured on the games page in table mode: six placeholders at 85px
   * against six rows at 34, so everything below the list dropped 305px
   * the moment the games arrived. The row is GameTable's own geometry
   * (`min-h-(--row-h-table) py-(--row-py-tight)`, its GRID's px-3), which
   * is where the 34 comes from — and both are density tokens, so the
   * placeholder tightens with the rows it stands in for rather than
   * measuring against them at one rung only.
   */
  dense?: boolean;
}) {
  const names = ['w-2/5', 'w-1/2', 'w-1/3', 'w-5/12', 'w-2/5', 'w-1/2'];
  if (dense) {
    // The table's own grid, not a flex row: the real column header is
    // drawn above these while they wait, and the three bars this used to
    // be — one left, two pushed right by `ml-auto` — sat under whichever
    // headings happened to be at those x positions. One bar per track
    // now, from the same column list the header and the rows read, so
    // every bar is under its own heading and a dragged column takes the
    // placeholder with it. The text columns' bars vary in width; a fixed
    // column's is two thirds of its track, which is about what a rating
    // or a date fills.
    const cells = columns ?? gameTableColumns(false);
    return (
      <>
        {Array.from({ length: rows }, (_, i) => (
          <li
            key={i}
            className={cn(GAME_TABLE_GRID, 'min-h-(--row-h-table) py-(--row-py-tight)')}
          >
            {cells.map((c, j) => (
              <span
                key={c.id}
                className={cn(
                  'flex min-w-0 items-center',
                  c.align === 'right' && 'justify-end',
                  c.align === 'center' && 'justify-center',
                )}
              >
                <Skeleton className={cn('h-2.5', c.fr ? names[(i + j) % names.length] : 'w-2/3')} />
              </span>
            ))}
          </li>
        ))}
      </>
    );
  }
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-(--row-py)">
          {/* The real row stacks three <p>s with no gap between them: two
              players at text-base, whose line box is 24px, and the opening
              and date at text-sm, whose box is 20px. This was a gap-1
              stack of bare bars — 40px of text against the row's 68, so a
              list of eight stood about 200px short and everything below it
              jumped when the games landed. The bars stay thin; each is
              centred in a box of its line's real height.

              The padding is the density token, not the py-2 it resolves to
              at the comfortable rung: this row is every game list in the
              app, which is the list a density knob is for, and a literal
              stood 6px per row taller than the rows on a compact vault.

              Two players, each behind their side's dot. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {[0, 1].map((line) => (
              <div key={line} className="flex h-6 items-center gap-1.5">
                {/* It WAS an 8px circle, so the mark was the wrong shape
                    and every name bar beside it started 2px left of
                    where the name does. SideDot's own geometry now
                    (components/side-dot): fitted to the same 10px mark,
                    and off the radius knob for the same reason it is
                    there, that the ladder's smallest rung is 6px and
                    would make this a circle. */}
                <Skeleton className="size-2.5 shrink-0 rounded-[3px]" />
                <Skeleton className={cn('h-3.5', names[(i + line) % names.length])} />
              </div>
            ))}
            <div className="flex h-5 items-center">
              <Skeleton className="h-2 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-8 shrink-0" />
          {/* The row's tray (GameRow, games/shared): icon-sm controls in
              a p-0.5 gap-0.5 box, inert, WITH the guards the real tray
              carries. It was the eye and the ⋯, opaque, at every width.
              Both parts of that were wrong. The eye is a hover
              affordance, so the real one is `pointer-coarse:hidden
              @max-[21.5rem]/arc:hidden` and a phone row's tray is the ⋯
              alone: icon-sm is 36px under a coarse pointer, so the
              placeholder stood a 78px tray against the real 40 and every
              player name beside it moved 38px when the rows landed. And
              the real tray is `opacity-0` until the pointer is on the
              row, so a desktop showed two grey buttons on every
              placeholder row that vanished on arrival. The space is
              reserved either way; hiding them costs no layout and is
              what the settled row looks like. */}
          <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg p-0.5 opacity-0 pointer-coarse:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 pointer-coarse:hidden @max-[21.5rem]/arc:hidden"
              {...INERT}
            >
              <Eye className="glyph" />
            </Button>
            {bookmark && (
              <Button variant="ghost" size="icon-sm" className="shrink-0 pointer-coarse:hidden" {...INERT}>
                <Bookmark className="glyph" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" className="shrink-0" {...INERT}>
              <MoreHorizontal className="glyph" />
            </Button>
          </div>
          {/* The link column, which the real row keeps whether or not the
              game has one: an anchor, or a spacer of its width. */}
          {link && <span className="w-[1.375rem] shrink-0 @max-[21.5rem]/arc:hidden" aria-hidden />}
        </li>
      ))}
    </>
  );
}
