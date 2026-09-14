import { useEffect, useEffectEvent, useRef } from 'react';
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
  // An Effect Event: `moved` is read for the position it arrived with,
  // and a change to it alone is not a new position to sound.
  const sound = useEffectEvent((position: string | null | undefined) => {
    if (!position) {
      prevPieces.current = null;
      return;
    }
    const pieces = position.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;
    const prev = prevPieces.current;
    prevPieces.current = pieces;
    if (prev === null || !moved) return;
    playSound(pieces < prev ? 'capture' : 'move');
  });
  useEffect(() => {
    sound(fen);
  }, [fen]);
}
