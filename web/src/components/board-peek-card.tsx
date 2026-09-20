import type { ComponentProps, ReactNode, Ref } from 'react';
import { Board } from '@/board/Board';
import { cn } from '@/lib/utils';

/**
 * The hover card that shows a position beside the thing being pointed
 * at: a game row's final position, a puzzle's start, the position at a
 * ply of an engine line. Three lists drew it themselves, and one had
 * drifted to a border where the others drew the window ring, the 2px
 * the tonal rule in docs/design-principles.md exists to stop.
 *
 * `pointer-events-none`: the card sits between the pointer and the row
 * it was opened from, and must not take the hover away from it.
 */
export function BoardPeekCard({
  top,
  left,
  width,
  fen,
  orientation,
  lastMove,
  cardRef,
  className,
  children,
}: {
  top: number;
  left: number;
  /** In px, for a card that is not the default `w-44`. */
  width?: number;
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: ComponentProps<typeof Board>['lastMove'];
  cardRef?: Ref<HTMLDivElement>;
  className?: string;
  /** Under the board, inside the padding. */
  children?: ReactNode;
}) {
  return (
    <div
      ref={cardRef}
      style={{ top, left, width }}
      className={cn(
        'bg-popover ring-window-ring pointer-events-none fixed z-50 rounded-lg p-1 shadow-lg ring-1',
        width === undefined && 'w-44',
        className,
      )}
    >
      <Board fen={fen} orientation={orientation} viewOnly coordinates={false} lastMove={lastMove} className="rounded-sm" />
      {children}
    </div>
  );
}

/**
 * The same peek under a thumb: centred over a scrim rather than beside
 * the eye, where a 176px card on a 390px screen lands on the row it
 * belongs to. Every eye that shows a board on a coarse pointer draws
 * this one. The puzzle log once anchored the small card above its row
 * instead, and the same tap meant two things on two pages.
 *
 * It is the modal peek, so the caller owes it `useCloseRequest` (Android
 * Back puts a scrimmed layer away). `onDismiss` fires on a press of the
 * scrim, never of the board.
 */
export function BoardPeekOverlay({
  fen,
  orientation,
  cardRef,
  onDismiss,
}: {
  fen: string;
  orientation: 'white' | 'black';
  cardRef?: Ref<HTMLDivElement>;
  onDismiss?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-8">
      <div className="bg-scrim absolute inset-0" onPointerDown={onDismiss} />
      <div ref={cardRef} className="bg-card relative w-64 max-w-[80vw] rounded-xl ring-1 ring-window-ring p-1.5 shadow-lg">
        <Board fen={fen} orientation={orientation} viewOnly coordinates={false} className="rounded-lg" />
      </div>
    </div>
  );
}

/**
 * The default card's box, MEASURED rather than derived: it is `w-44` with
 * `p-1`, so the width is 176 and the board inside it should make the
 * height 176 too — but chessground floors a board to a whole number of
 * device pixels per square, so what it actually comes out at is 170
 * (measured in the running app at 1x). The old numbers assumed 184 and
 * centred the card 7px above the row it was pointing at.
 */
export const PEEK_CARD = { width: 176, height: 170 };
