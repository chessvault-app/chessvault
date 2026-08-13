import { Bookmark, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { MiniBoard } from './MiniBoard';
import { SwipeTrack, useSwipeRow } from './SwipeRow';
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
  /** Two lines of the note's own words. */
  preview?: string | null;
  /** Where the document's first embedded board starts, if it has one. */
  fen?: string | null;
  marked?: boolean;
  /** Omitted where bookmarking does not apply. */
  onToggleMark?: () => void;
  layout?: ShelfLayout;
  error?: string | null;
  /** What the ⋯ sheet is called; the title by default. */
  menuTitle?: string;
  actions: SheetAction[];
  onOpen: () => void;
  /** Touch: swiping the card's contents left removes it (undoably). */
  onSwipeAway: () => void;
  /** The card's own dialogs — rename, move to. */
  children?: ReactNode;
}) {
  const swipe = useSwipeRow({ onRemove: onSwipeAway, onBookmark: onToggleMark });
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const board = layout === 'grid' && fen ? <MiniBoard fen={fen} size={64} /> : null;

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
          if (e.key === 'Enter') onOpen();
        }}
        {...swipe.handlers}
        className={cn(
          'bg-surface border-line group relative flex h-full cursor-pointer gap-3',
          'overflow-hidden rounded-xl border shadow-[var(--shadow-panel)]',
          // Lifts a little under the pointer, and the border comes up with
          // it. A card that only changed its border read as selected; one
          // that rises reads as reachable.
          'transition-[border-color,box-shadow,transform] duration-150',
          'hover:border-line-strong hover:shadow-[var(--shadow-pop)] md:hover:-translate-y-px',
          layout === 'grid' ? 'items-start px-4 py-3' : 'items-center px-3 py-2',
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
          className={cn('flex min-w-0 flex-1 gap-3', board ? 'items-start' : 'items-center')}
          style={swipe.style}
        >
          {/* The board a note opens with, where it has one — the fastest
              way to tell two notes apart is to show what is in them. */}
          {board ?? <Icon className="text-subtle size-4 shrink-0" strokeWidth={1.75} />}

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
            <p
              className={cn(
                'text-fg truncate font-semibold',
                layout === 'grid' ? 'text-[0.9375rem] leading-5' : 'text-sm',
                onToggleMark ? 'pr-14 pointer-coarse:pr-9' : 'pr-7 pointer-coarse:pr-9',
              )}
            >
              {title}
            </p>
            {/* Three steps, not two: the name is the brightest thing on the
                card, the stat line is the quietest, and the note's own
                words sit between them. */}
            <p className="text-subtle text-[0.6875rem] leading-4">{meta}</p>
            {preview && layout === 'grid' && (
              <p className="text-muted mt-1 line-clamp-2 text-xs leading-[1.35rem] opacity-90">
                {preview}
              </p>
            )}
            {error && <p className="text-bad text-xs">{error}</p>}
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
          <Button
            ref={menuTrigger}
            variant="ghost"
            size="icon-sm"
            title={t('More')}
            active={menuOpen}
            className={cn(
              'opacity-0 transition-opacity',
              'group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
              menuOpen && 'opacity-100',
            )}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(true);
            }}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </div>

        {menuOpen && (
          <ActionSheet
            title={menuTitle ?? title}
            anchor={menuTrigger}
            onClose={() => setMenuOpen(false)}
            actions={actions}
          />
        )}

        {children}
      </div>
    </li>
  );
}
