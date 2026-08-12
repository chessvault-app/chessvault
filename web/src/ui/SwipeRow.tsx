import { Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/** Past this much of a drag, letting go removes the row. */
const THRESHOLD = 96;

/**
 * A row you can swipe away.
 *
 * Deleting used to mean finding a ⋯ menu, choosing the red item and
 * answering a question — three taps to throw away one thing, and the
 * question was the only thing standing between you and a lost note. A
 * swipe is one gesture, and the safety net moves AFTER the act: the row
 * goes, an undo offers itself for a few seconds, and only then does
 * anything reach the vault (see `useUndoable`).
 *
 * Touch only. A mouse has the row's own delete control and no muscle
 * memory for this; a horizontal drag with a mouse is a text selection.
 */
export function SwipeRow({
  children,
  onSwipe,
  disabled = false,
}: {
  children: ReactNode;
  onSwipe: () => void;
  disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Once a gesture is judged vertical it stays that way: a list that
  // stole every diagonal scroll would be a list you cannot scroll.
  const axis = useRef<'x' | 'y' | null>(null);

  const end = (): void => {
    if (dx <= -THRESHOLD) onSwipe();
    setDx(0);
    start.current = null;
    axis.current = null;
  };

  return (
    <div className="relative overflow-hidden">
      {dx < 0 && (
        <div
          className="bg-bad/15 text-bad absolute inset-y-0 right-0 flex items-center gap-2 px-4"
          aria-hidden
        >
          <Trash2 className="size-4" />
          <span className="text-xs font-medium">
            {dx <= -THRESHOLD ? t('Release to remove') : t('Remove')}
          </span>
        </div>
      )}
      <div
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        className={cn('relative', !dx && 'transition-transform duration-150')}
        onTouchStart={(e) => {
          if (disabled) return;
          const touch = e.touches[0]!;
          start.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchMove={(e) => {
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
        }}
        onTouchEnd={end}
        onTouchCancel={end}
      >
        {children}
      </div>
    </div>
  );
}
