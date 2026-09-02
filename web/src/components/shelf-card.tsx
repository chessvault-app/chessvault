import { Bookmark, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
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
  // Dimmed until the card is pointed at: a shelf of full-colour boards is
  // a wall of competing pictures, and the thumbnail is a reminder, not
  // the content. Hover brings the position back to full colour — on the
  // same transition the card lifts with, so the two read as one gesture.
  //
  // Except where nothing hovers. On a coarse pointer the restore never
  // fires, so the dimming was permanent and the one thing that tells two
  // studies apart at a glance stayed washed out for the whole of a phone's
  // life. There is no wall of competing pictures to calm down there
  // either: the shelf is one column.
  const board =
    layout === 'grid' && fen ? (
      <MiniBoard
        fen={fen}
        size={64}
        className={cn(
          'brightness-[0.65] saturate-[0.55] transition-[filter] duration-200 ease-in-out',
          'group-hover:brightness-100 group-hover:saturate-100',
          'pointer-coarse:brightness-100 pointer-coarse:saturate-100',
        )}
      />
    ) : null;

  return (
    // h-full through both: in a two-column grid a card with a preview line
    // sits beside one without, and cards of two heights in the same row
    // read as a broken grid rather than as two different notes.
    <li className="h-full">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          // Only when the CARD is what's focused: its dialogs (rename, move
          // to) and corner buttons are children in the React tree, so their
          // Enter bubbles here even out of the portal — and confirming a
          // rename must not also open what was renamed.
          if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
        }}
        {...swipe.handlers}
        className={cn(
          'bg-card border-border group relative flex h-full cursor-pointer gap-3',
          'overflow-hidden rounded-xl ring-1 ring-border',
          // Lifts a little under the pointer, and the border comes up with
          // it. A card that only changed its border read as selected; one
          // that rises reads as reachable.
          'transition-[border-color,box-shadow,transform] duration-150',
          'hover:border-border hover:shadow-md md:hover:-translate-y-px',
          layout === 'grid' ? 'px-4 py-3' : 'items-center px-3 py-2',
          // A bookmarked card says so before it is read: a warm edge down
          // the left. It is the WHOLE indicator now — the filled star that
          // used to sit in the corner cost a permanent 28px of every card
          // on a phone to say something an edge says for nothing.
          //
          // The hover colour has to be re-stated for that edge, or it is
          // lost exactly when you reach for the card: `hover:border-line-
          // strong` sets ALL FOUR sides, so pointing at a marked card
          // repainted its amber edge the same grey as the rest of it.
          marked && 'border-l-warn hover:border-l-warn border-l-2',
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

          <div className="min-w-0 flex-1">
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
            <p
              title={title}
              className={cn(
                'text-foreground truncate font-semibold',
                layout === 'grid' ? 'text-base leading-6' : 'text-base',
                onToggleMark ? 'pr-14 pointer-coarse:pr-9' : 'pr-7 pointer-coarse:pr-9',
              )}
            >
              {title}
            </p>
            {/* Three steps, not two: the name is the brightest thing on the
                card, the stat line is the quietest, and the note's own
                words sit between them. */}
            <p className="text-muted-foreground text-xs leading-4">{meta}</p>
            {preview && layout === 'grid' && (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-[1.35rem] opacity-90">
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
                marked && 'text-warn',
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
