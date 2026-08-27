import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Where a square sits on the board as drawn, in grid steps from the
 * top-left of what is on screen.
 *
 * Three overlays needed this and each had written it out: the analysis
 * board's NAG badge, the puzzle trainer's move badge, and the NNUE heat
 * map — which spelled the rank as `Number(sq[1]) - 1` where the other two
 * used `charCodeAt(1) - 49`. The same arithmetic three times is three
 * chances for a flipped board to be right in two places and wrong in the
 * third, and nothing would have said so: a badge on the wrong square is
 * still a badge.
 *
 * Callers multiply by 12.5% — a square is an eighth of the board, and the
 * board is always square, so one number does both axes.
 */
export function squareToGrid(
  square: string,
  orientation: 'white' | 'black',
): { column: number; rowFromTop: number } {
  const file = square.charCodeAt(0) - 97; // a..h -> 0..7
  const rank = square.charCodeAt(1) - 49; // 1..8 -> 0..7
  return {
    column: orientation === 'white' ? file : 7 - file,
    rowFromTop: orientation === 'white' ? 7 - rank : rank,
  };
}

/**
 * The disc pinned to a square's top-right corner: the analysis board's
 * move-quality NAG, the book mark, and the trainer's verdict on the move
 * just played.
 *
 * One component because it was one component twice — the two copies
 * agreed on the offsets (-0.85rem, -0.4rem), the size, the weight and the
 * shadow to the character, which is the state a shared thing is in just
 * before someone tunes one of them.
 *
 * The FILL is the caller's, and only the fill: a badge means what its
 * colour says, and the colours are the --nag-* tokens either way.
 *
 * z-30 because chessground paints its pieces over anything lower, and a
 * wide piece swallowed a badge sitting at z-20.
 */
export function SquareBadge({
  square,
  orientation,
  className,
  children,
}: {
  /** Algebraic, e.g. "e4" — normally a move's destination. */
  square: string;
  orientation: 'white' | 'black';
  /** The fill, as a bg-nag-* class. */
  className?: string;
  children: ReactNode;
}) {
  const { column, rowFromTop } = squareToGrid(square, orientation);
  return (
    <span
      aria-hidden
      style={{
        left: `calc(${(column + 1) * 12.5}% - 0.85rem)`,
        top: `calc(${rowFromTop * 12.5}% - 0.4rem)`,
      }}
      className={cn(
        'pointer-events-none absolute z-30 grid size-6 place-items-center rounded-full',
        'text-nag-foreground text-base font-bold shadow-sm',
        className,
      )}
    >
      {children}
    </span>
  );
}
