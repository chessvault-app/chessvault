import { Bookmark, BookmarkX, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/** Past this much of a drag, letting go does the thing. */
const THRESHOLD = 96;

/**
 * How far from the screen's left edge a rightward swipe has to start.
 *
 * Both platforms use an edge swipe from the left as Back. A gesture that
 * begins in the middle of a row is nobody else's; one that begins on the
 * edge belongs to the browser and must be left alone.
 */
const EDGE_PX = 32;

/**
 * Swipe a row: left to remove it, right to bookmark it.
 *
 * The ROW does not move: its surface — the card's border, its background,
 * its place in the list — stays exactly where it is, and what slides is
 * what is written on it. A card that slid bodily left tore a hole in the
 * list and dragged its own shadow over its neighbours; sliding the
 * contents inside a fixed frame reads as the row opening rather than as
 * the list coming apart.
 *
 * So this is a hook, not a wrapper: only the row itself knows which of its
 * parts are the frame and which are the contents.
 *
 *   const swipe = useSwipeRow({ onRemove, onBookmark, bookmarked });
 *   <div className="card relative overflow-hidden" {...swipe.handlers}>
 *     <SwipeTrack dx={swipe.dx} bookmarked={bookmarked} />
 *     <div style={swipe.style}>…</div>
 *   </div>
 *
 * Touch only. A mouse has the row's own menu, and a horizontal drag with a
 * mouse is a text selection.
 */
export function useSwipeRow({
  onRemove,
  onBookmark,
}: {
  onRemove: () => void;
  /** Omitted where a row cannot be bookmarked; then right does nothing. */
  onBookmark?: () => void;
}): {
  dx: number;
  style: { transform?: string; transition?: string };
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
} {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Once a gesture is judged vertical it stays that way: a list that stole
  // every diagonal scroll would be a list you cannot scroll.
  const axis = useRef<'x' | 'y' | null>(null);
  // Whether this particular gesture is allowed to go right at all.
  const rightward = useRef(false);

  const end = (): void => {
    if (dx <= -THRESHOLD) onRemove();
    else if (dx >= THRESHOLD) onBookmark?.();
    setDx(0);
    start.current = null;
    axis.current = null;
    rightward.current = false;
  };

  return {
    dx,
    style: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      transition: dx ? undefined : 'transform 150ms',
    },
    handlers: {
      onTouchStart: (e) => {
        const touch = e.touches[0]!;
        start.current = { x: touch.clientX, y: touch.clientY };
        rightward.current = Boolean(onBookmark) && touch.clientX > EDGE_PX;
      },
      onTouchMove: (e) => {
        if (!start.current) return;
        const touch = e.touches[0]!;
        const moveX = touch.clientX - start.current.x;
        const moveY = touch.clientY - start.current.y;
        if (!axis.current) {
          if (Math.abs(moveX) < 8 && Math.abs(moveY) < 8) return;
          axis.current = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
        }
        if (axis.current !== 'x') return;
        setDx(rightward.current ? moveX : Math.min(0, moveX));
      },
      onTouchEnd: end,
      onTouchCancel: end,
    },
  };
}

/**
 * What the sliding contents uncover: a panel that names what happens.
 *
 * The panel is the colour, not the words. Red text on the card's own
 * background read as an error message printed on the row — the row still
 * looked like itself, with a warning in it. Filling the uncovered strip
 * makes the gesture legible as one thing: the card is sliding off
 * something, and the something is red — or, going the other way, amber.
 *
 * Its width follows the finger exactly, so the fill IS the strip the
 * contents have vacated — no colour showing where the card still is, none
 * missing where it is not. Past the threshold it goes solid and says so;
 * before it, it is dimmer, which is the only cue that letting go now
 * would do nothing.
 */
export function SwipeTrack({ dx, bookmarked = false }: { dx: number; bookmarked?: boolean }) {
  if (dx === 0) return null;
  const armed = Math.abs(dx) >= THRESHOLD;
  const removing = dx < 0;
  const Icon = removing ? Trash2 : bookmarked ? BookmarkX : Bookmark;
  const label = removing
    ? armed
      ? t('Release to remove')
      : t('Remove')
    : bookmarked
      ? armed
        ? t('Release to unbookmark')
        : t('Remove bookmark')
      : armed
        ? t('Release to bookmark')
        : t('Bookmark');
  return (
    <div
      className={cn(
        'absolute inset-y-0 flex items-center overflow-hidden transition-colors duration-100',
        // The strip is on the side the contents came FROM: sliding left
        // uncovers the right edge, sliding right uncovers the left.
        removing ? 'right-0 justify-end' : 'left-0 justify-start',
        removing
          ? armed
            ? 'bg-bad text-bad-fg'
            : 'bg-bad/55 text-bad-fg'
          : armed
            ? 'bg-warn text-warn-fg'
            : 'bg-warn/55 text-warn-fg',
      )}
      style={{ width: Math.abs(dx) }}
      aria-hidden
    >
      {/* Pinned to the strip's outer edge so the icon and its word stay
          together and stay visible as the strip narrows, instead of
          sliding out of their own panel. */}
      <span className="flex shrink-0 items-center gap-2 px-4">
        <Icon className="size-4" />
        <span className="whitespace-nowrap text-xs font-semibold">{label}</span>
      </span>
    </div>
  );
}
