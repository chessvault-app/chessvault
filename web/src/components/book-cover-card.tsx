import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { SwipeTrack, useSwipeRow } from '@/components/swipe-row';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * A book on a shelf: a cover down the left, the title and a line under
 * it, and a footer that says where the book stands.
 *
 * Two shelves draw one — the library and the puzzle books — and each
 * had the whole card written out: the same frame, the same swipe, the
 * same ⋯ in the same corner, the same cover box. What differs is what
 * the lines SAY and what the verbs do, so that is what the caller
 * supplies. The frame is ShelfCard's (components/shelf-card) in
 * everything but shape: a cover is a tall picture, so the card is a
 * row of two columns rather than a board beside a title.
 */
export function BookCoverCard({
  title,
  cover,
  icon: Icon,
  meta,
  footer,
  marked,
  actions,
  onOpen,
  onSwipeAway,
  onToggleMark,
  children,
}: {
  title: string;
  /** The cover's image, or null for the icon in its place. */
  cover: string | null;
  /** Stands in for a missing cover. */
  icon: LucideIcon;
  /** The line under the title: size and place, or count and due. */
  meta: ReactNode;
  /** The bottom line: reading state, or a progress bar. */
  footer: ReactNode;
  marked: boolean;
  actions: MenuAction[];
  onOpen: () => void;
  /** Touch: swiping the card's contents left removes it (undoably). */
  onSwipeAway: () => void;
  /** Touch: swiping right marks. */
  onToggleMark: () => void;
  /** The card's own dialogs — rename, move to, replace. */
  children?: ReactNode;
}) {
  const swipe = useSwipeRow({ onRemove: onSwipeAway, onBookmark: onToggleMark });
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li className="h-full">
      <div
        // A surface, not a button: the title below is the control, so the
        // ⋯ and the dialogs inside are not nested in one (WCAG 4.1.2; see
        // components/shelf-card).
        onClick={onOpen}
        {...swipe.handlers}
        className={cn(
          'touch-pan-y touch-pinch-zoom',
          // ring-1 ring-card-ring, as the registry's own Card: the card's
          // fill is its edge on the toned page, and the hairline returns
          // under High contrast. A ring, not a border, because a border is
          // 2px of box and a ring is none - the placeholders that stand in
          // for these cards had to be hand-corrected for exactly that.
          'bg-card ring-card-ring group relative flex h-full cursor-pointer items-stretch gap-3',
          'overflow-hidden rounded-xl ring-1 p-3 text-left transition-colors duration-100',
          'hover:bg-accent',
          // The whole indicator that a book is kept. A strip over the
          // card, not a border on it: the bookmarks arrive in a request
          // of their own, and a border moved the marked cards' contents
          // 2px right when it landed (components/shelf-card).
          marked &&
            "before:bg-warn before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-0.5 before:content-['']",
        )}
      >
        <SwipeTrack dx={swipe.dx} bookmarked={marked} />

        <div className="flex min-w-0 flex-1 items-stretch gap-3" style={swipe.style}>
          {cover ? (
            <img
              src={cover}
              alt=""
              loading="lazy"
              decoding="async"
              className="border-border h-24 w-[4.5rem] shrink-0 rounded-md border object-cover object-top"
            />
          ) : (
            <span className="bg-muted border-card-ring grid h-24 w-[4.5rem] shrink-0 place-items-center rounded-md border">
              <Icon className="text-muted-foreground group-hover:text-primary size-5 transition-colors" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
            {/* pr keeps a long title clear of the corner control */}
            <span className="min-w-0 pr-7">
              {/* The book's own name selects on a long press; the size
                  and the counts under it are the app's (index.css). */}
              <button
                type="button"
                data-user-text
                className="text-foreground block w-full truncate text-left text-base font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen();
                }}
              >
                {title}
              </button>
              <span className="text-muted-foreground block text-sm">{meta}</span>
            </span>
            {footer}
          </span>
        </div>

        <ActionMenu title={title} open={menuOpen} onOpenChange={setMenuOpen} actions={actions}>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('More')}
            active={menuOpen}
            style={swipe.style}
            className={cn(
              'absolute right-2 top-2 opacity-0 transition-opacity',
              'group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
              menuOpen && 'opacity-100',
            )}
            // A press on the ⋯ is the menu's, not the card's.
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </ActionMenu>

        {children}
      </div>
    </li>
  );
}
