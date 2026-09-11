import { useEffect, useRef } from 'react';
import { playSound } from '@/board/sound';

/**
 * A sound per rendered position. No SAN here, so a capture is detected
 * by the piece count dropping; a position that was not reached by a
 * move (`moved` false: a fresh puzzle, the root) stays silent, and so
 * does the first position seen. Two trainers carried this effect by
 * hand, keyed on the same regex.
 */
export function useMoveSound(fen: string | null | undefined, moved: boolean): void {
  const prevPieces = useRef<number | null>(null);
  useEffect(() => {
    if (!fen) {
      prevPieces.current = null;
      return;
    }
    const pieces = fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;
    const prev = prevPieces.current;
    prevPieces.current = pieces;
    if (prev === null || !moved) return;
    playSound(pieces < prev ? 'capture' : 'move');
    // Per position, not per render: `moved` is read for the position it
    // arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);
}
