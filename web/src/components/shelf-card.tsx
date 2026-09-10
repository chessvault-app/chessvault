import { Bookmark, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';
import { nameSharedBoard } from '@/lib/shared-board';
import { Button } from '@/components/ui/button';
import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { MiniBoard } from '@/components/mini-board';
import { SwipeTrack, useSwipeRow } from '@/components/swipe-row';
import { t } from '@/lib/i18n';

/** Grid: cards side by side. List: one dense row each, no thumbnail. */
export type ShelfLayout = 'grid' | 'list';

/**
 * One card on a shelf: a study, a note.
 *
 * The two shelves had the same card written twice — the same frame, the
 * same swipe, the same ⋯, the same three actions — and they had already
 * drifted. What differs between a study and a note is what its actions DO,
 * so that is what stays with the caller; everything about how a card looks
 * and how it is dismissed lives here.
 */
export function ShelfCard({
  icon: Icon,
  title,
  meta,
  preview,
  fen,
  marked = false,
  onToggleMark,
  layout = 'grid',
  error,
  menuTitle,
  actions,
  onOpen,
  onSwipeAway,
  children,
}: {
  /** The mark shown when there is no board to show instead. */
  icon: LucideIcon;
  title: string;
  /** The second line: chapters and when, or size and when. */
  meta: ReactNode;
  /** Two lines of the note's own words — or any caption the card wants
      there (the studies shelf puts icon-prefixed chapter names in it). */
  preview?: ReactNode;
  /** Where the document's first embedded board starts, if it has one. */
  fen?: string | null;
  marked?: boolean;
  /** Omitted where bookmarking does not apply. */
  onToggleMark?: () => void;
  layout?: ShelfLayout;
  error?: string | null;
  /** What the ⋯ sheet is called; the title by default. */
  menuTitle?: string;
  actions: MenuAction[];
  onOpen: () => void;
  /** Touch: swiping the card's contents left removes it (undoably). */
  onSwipeAway: () => void;
  /** The card's own dialogs — rename, move to. */
  children?: ReactNode;
}) {
  const swipe = useSwipeRow({ onRemove: onSwipeAway, onBookmark: onToggleMark });
  const [menuOpen, setMenuOpen] = useState(false);
  // In full colour at rest. The board was dimmed to 65% brightness and
  // 55% saturation under a fine pointer, restored on hover, on the
  // argument that a shelf of boards is a wall of competing pictures. What
  // it produced was twelve grey-brown squares on a white page: the board
  // is the one thing this design lets carry colour, and the shelf was
  // the one place it was muted. A phone never saw the dim (nothing
  // hovers there) and its shelf read fine, which was the tell. Reversed
  // by lanph3re, 2026-09-07; the card still lifts on hover.
  // Named as THE board the moment the card opens, so a phone's route
  // transition grows it into the page's board (lib/shared-board).
  const boardRef = useRef<HTMLDivElement>(null);
  const open = (): void => {
    nameSharedBoard(boardRef.current);
    onOpen();
  };
  const board = layout === 'grid' && fen ? <MiniBoard ref={boardRef} fen={fen} size={64} /> : null;

  return (
    // h-full through both: in a two-column grid a card with a preview line
    // sits beside one without, and cards of two heights in the same row
    // read as a broken grid rather than as two different notes.
    <li data-slot="shelf-card" className="h-full">
      <div
        // The surface answers a click, and only a click: it is not a
        // button. It was `role="button"` with the bookmark and the ⋯
        // inside it, a control holding controls, which WCAG 4.1.2 forbids
        // and a screen reader reads as one button with two more in it
        // (the axe pass, 2026-09-07). The name below is the real button,
        // the way a game row's names are, so the keyboard lands on name,
        // bookmark, ⋯ in that order and the mouse keeps the whole card.
        onClick={open}
        {...swipe.handlers}
        className={cn(
          'bg-card group relative flex h-full cursor-pointer gap-3',
          'overflow-hidden rounded-xl ring-1 ring-card-ring',
          // Lifts a little under the pointer. A card that only changed its
          // edge read as selected; one that rises reads as reachable.
          'transition-[box-shadow,transform,background-color] duration-150',
          'hover:shadow-md md:hover:-translate-y-px',
          // A finger gets the tint the rows get, not the lift: a card
          // rising under a thumb is a hover idiom, and the thumb hides it.
          'pointer-coarse:active:bg-accent',
          layout === 'grid' ? 'px-4 py-3' : 'items-center px-3 py-2',
          // A bookmarked card says so before it is read: an edge down the
          // left in the accent, plus the small glyph on the meta line
          // below. The edge alone was the whole indicator for a while,
          // and it broke two of the app's own rules: it was amber, which
          // means caution everywhere else (the engine-guess tier, the
          // offline notice), and it was colour with no shape, which a
          // screen reader and a deuteranopic reader both miss. The glyph
          // costs one caption-height on the line that was already there,
          // not the 28px corner the old filled star took from every card.
          marked && 'border-l-primary border-l-2',
        )}
      >
        {/* The card stays; its contents slide off it. */}
        <SwipeTrack dx={swipe.dx} bookmarked={marked} />

        <div
          // Centred, not top-aligned: the 64px board sets the card's height,
          // and a title-and-meta that only fill 40 of it sat against the
          // top with a dead band beneath, the title's cap visibly lower
          // than the board's edge. Cards in one row share a height (h-full
          // above), so centring also keeps the boards level across a row.
          className="flex min-w-0 flex-1 items-center gap-3"
          style={swipe.style}
        >
          {/* The board a note opens with, where it has one — the fastest
              way to tell two notes apart is to show what is in them. */}
          {board ?? <Icon className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} />}

          <div
            className={cn(
              'min-w-0 flex-1',
              // One height for every grid card, whatever its words do. A
              // card with a preview line stands beside one without, and
              // rows stepped on a shelf with short names beside long ones
              // (lanph3re's report). The column reserves the fullest
              // card's text, the title line (1.5rem) + the meta line
              // (1rem) + its mt-1 (0.25rem) + one preview line (1.35rem),
              // and centres what it has, so a title with no preview stays
              // packed against its meta line rather than pinned to the top
              // of an empty box. Measured at 1280 on the demo's shelf:
              // 135px a card when two title lines and two preview lines
              // were reserved, 114 with one preview line, 90 with one of
              // each; the spare lines were the band of nothing above and
              // below every short card, a third of the shelf's height.
              //
              // From sm up only: below it the grid is one column, where no
              // card has a neighbour to stay level with, so a phone card
              // is as tall as its own words.
              layout === 'grid' && 'flex flex-col justify-center sm:min-h-[4.1rem]',
            )}
          >
            {/* Only the TITLE keeps clear of the ⋯, which is pinned to the
                corner rather than sharing the row. In the flex row it used
                to sit in, it took its width from every line of the card
                whether it was showing or not. */}
            {/* The right padding reserves the corner strip, so it has to
                count what is actually IN it: one ⋯ is 28px, the bookmark
                beside it makes 58. On a touch screen the bookmark is not
                there at all (it is a swipe and a menu row instead), so the
                ⋯ alone is 36. */}
            {/* `title` because the line above truncates and had no way
                back: measured on the Studies shelf, four of five names
                were cut, and "Prophylaxis - Nimzowits…" is not something
                you can pick a study by. This app's tooltip IS the title
                attribute, so the name is one hover away instead of one
                open-and-close. */}
            <button
              type="button"
              title={title}
              onClick={(e) => {
                // The surface has the same click; one open, not two.
                e.stopPropagation();
                open();
              }}
              className={cn(
                'text-foreground block w-full text-left font-semibold',
                // One line, on a card as on a list row. A card gave the
                // name a second line for a while (at three columns the
                // title box is 219px and eight of the demo's twelve titles
                // need more), and that line was 24px on every card of the
                // shelf for the tail of a name the `title` above shows on
                // hover and the list layout shows whole.
                'truncate text-base',
                layout === 'grid' && 'leading-6',
                onToggleMark ? 'pr-14 pointer-coarse:pr-9' : 'pr-7 pointer-coarse:pr-9',
              )}
            >
              {title}
            </button>
            {/* Three steps, not two: the name is the brightest thing on the
                card, the stat line is the quietest, and the note's own
                words sit between them. One line of those words: the card
                is a reminder of what is inside, and the second line was
                21px on every card of the shelf for a clause that the open
                note shows whole. */}
            <p className="text-muted-foreground text-xs leading-4">
              {marked && (
                <Bookmark
                  className="text-primary mr-1 inline size-3 -translate-y-px fill-current"
                  aria-label={t('Bookmarked')}
                />
              )}
              {meta}
            </p>
            {preview && layout === 'grid' && (
              <p className="text-muted-foreground mt-1 line-clamp-1 text-sm leading-[1.35rem] opacity-90">
                {preview}
              </p>
            )}
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Both corner controls in one strip, so they cannot overlap and
            the bookmark does not move when the ⋯ appears. */}
        <div
          style={swipe.style}
          className={cn('absolute right-2 flex items-center gap-0.5', layout === 'grid' ? 'top-2' : 'top-1.5')}
        >
          {/* Hover only, and gone entirely under a thumb: a phone marks a
              card by swiping it right or from its ⋯, and a button that is
              permanently on screen to say something the left edge already
              says is 28px taken off every title in the list. */}
          {onToggleMark && (
            <Button
              variant="ghost"
              size="icon-sm"
              title={marked ? t('Remove bookmark') : t('Bookmark')}
              className={cn(
                'pointer-coarse:hidden opacity-0 transition-opacity',
                'group-hover:opacity-100 focus-visible:opacity-100',
                marked && 'text-primary',
              )}
              onClick={(e) => {
                e.stopPropagation();
                onToggleMark();
              }}
            >
              <Bookmark className={cn('size-3.5', marked && 'fill-current')} />
            </Button>
          )}
          <ActionMenu
            title={menuTitle ?? title}
            actions={actions}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('More')}
              active={menuOpen}
              className={cn(
                'opacity-0 transition-opacity',
                'group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
                menuOpen && 'opacity-100',
              )}
              // A press on the ⋯ is the menu's, not the card's.
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </ActionMenu>
        </div>

        {children}
      </div>
    </li>
  );
}
