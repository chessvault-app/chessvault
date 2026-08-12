import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/** Past this much of a drag, letting go removes the row. */
const THRESHOLD = 96;

/**
 * Swipe a row away.
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
 *   const swipe = useSwipeAway(onRemove);
 *   <div className="card relative overflow-hidden" {...swipe.handlers}>
 *     <SwipeTrack dx={swipe.dx} />
 *     <div style={swipe.style}>…</div>
 *   </div>
 *
 * Touch only. A mouse has the row's own menu, and a horizontal drag with a
 * mouse is a text selection.
 */
export function useSwipeAway(onSwipe: () => void): {
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

  const end = (): void => {
    if (dx <= -THRESHOLD) onSwipe();
    setDx(0);
    start.current = null;
    axis.current = null;
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
        // Leftwards only: a right-swipe is the browser's back gesture on
        // both platforms, and taking it would be taking navigation away.
        if (axis.current === 'x') setDx(Math.min(0, moveX));
      },
      onTouchEnd: end,
      onTouchCancel: end,
    },
  };
}

/**
 * What the sliding contents uncover: a red panel that names what happens.
 *
 * The panel is the colour, not the words. Red text on the card's own
 * background read as an error message printed on the row — the row still
 * looked like itself, with a warning in it. Filling the uncovered strip
 * makes the gesture legible as one thing: the card is sliding off
 * something, and the something is red.
 *
 * Its width follows the finger exactly, so the fill IS the strip the
 * contents have vacated — no red showing where the card still is, none
 * missing where it is not. Past the threshold it goes solid and says so;
 * before it, it is dimmer, which is the only cue that letting go now
 * would do nothing.
 */
export function SwipeTrack({ dx }: { dx: number }) {
  if (dx >= 0) return null;
  const armed = dx <= -THRESHOLD;
  return (
    <div
      className={cn(
        'absolute inset-y-0 right-0 flex items-center justify-end gap-2 overflow-hidden',
        'text-bad-fg transition-colors duration-100',
        armed ? 'bg-bad' : 'bg-bad/55',
      )}
      style={{ width: -dx }}
      aria-hidden
    >
      {/* Pinned to the right edge of the strip so the icon and its word
          stay together and stay visible as the strip narrows, instead of
          sliding out of their own panel. */}
      <span className="flex shrink-0 items-center gap-2 px-4">
        <Trash2 className="size-4" />
        <span className="whitespace-nowrap text-xs font-semibold">
          {armed ? t('Release to remove') : t('Remove')}
        </span>
      </span>
    </div>
  );
}
