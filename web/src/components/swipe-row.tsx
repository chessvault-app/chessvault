import { Bookmark, BookmarkX, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { gestureHaptic } from '@/board/sound';
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
 *
 * The host also declares `touch-pan-y touch-pinch-zoom`. The handlers are
 * passive, so nothing here can take a gesture away from the browser once
 * it has begun; without the pan-y the page kept the vertical pan through
 * a sideways drag and the list crept while the row opened. pan-y hands
 * the browser only the axis it may have: a drag it judges horizontal is
 * left entirely to these handlers, and one it judges vertical scrolls as
 * before, with the axis lock below standing the row down. pinch-zoom sits
 * beside it because a row is words someone may need bigger, and the
 * second finger that asks for that is one this hook stands down for.
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
  // Whether the last move had crossed the threshold, so the tick fires
  // once on the way over (and once on the way back), not every frame.
  const wasArmed = useRef(false);

  /** Put the row back and let the gesture go, without doing anything it
      was pointing at. */
  const forget = (): void => {
    setDx(0);
    start.current = null;
    axis.current = null;
    rightward.current = false;
    wasArmed.current = false;
  };

  const end = (): void => {
    // `start` is what says the gesture is still this hook's: a pinch it
    // stood down from leaves it null, and a release must then do nothing.
    // The ref rather than `dx`, because a touchmove's setState is given a
    // task of its own and the 0 it wrote may not be in this closure yet.
    if (start.current) {
      if (dx <= -THRESHOLD) onRemove();
      else if (dx >= THRESHOLD) onBookmark?.();
    }
    forget();
  };

  return {
    dx,
    style: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      transition: dx ? undefined : 'transform 150ms',
    },
    handlers: {
      onTouchStart: (e) => {
        // A second finger is a pinch, never a swipe. The row follows one
        // touch and, until this line, never asked how many were down, so a
        // spread read as one finger travelling: measured on a note card at
        // 390px, the finger being followed went 120px left, past the
        // threshold below, and the note was removed.
        if (e.touches.length !== 1) return forget();
        const touch = e.touches[0]!;
        start.current = { x: touch.clientX, y: touch.clientY };
        rightward.current = Boolean(onBookmark) && touch.clientX > EDGE_PX;
      },
      onTouchMove: (e) => {
        if (!start.current) return;
        // The same pinch, arriving one finger at a time.
        if (e.touches.length !== 1) return forget();
        const touch = e.touches[0]!;
        const moveX = touch.clientX - start.current.x;
        const moveY = touch.clientY - start.current.y;
        if (!axis.current) {
          if (Math.abs(moveX) < 8 && Math.abs(moveY) < 8) return;
          axis.current = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
        }
        if (axis.current !== 'x') return;
        const next = rightward.current ? moveX : Math.min(0, moveX);
        const armed = Math.abs(next) >= THRESHOLD;
        if (armed !== wasArmed.current) {
          wasArmed.current = armed;
          gestureHaptic();
        }
        setDx(next);
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
 * something, and the something is red — or, going the other way, the
 * accent. Not amber, which it was: amber is caution app-wide, and the
 * row this strip is under says a kept game with the accent already.
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
            ? 'bg-destructive text-destructive-foreground'
            : 'bg-destructive/55 text-destructive-foreground'
          : armed
            ? 'bg-primary text-primary-foreground'
            : 'bg-primary/55 text-primary-foreground',
      )}
      style={{ width: Math.abs(dx) }}
      aria-hidden
    >
      {/* Pinned to the strip's outer edge so the icon and its word stay
          together and stay visible as the strip narrows, instead of
          sliding out of their own panel. */}
      <span className="flex shrink-0 items-center gap-2 px-4">
        <Icon className="size-4" />
        <span className="whitespace-nowrap text-sm font-semibold">{label}</span>
      </span>
    </div>
  );
}
