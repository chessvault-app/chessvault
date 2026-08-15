import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Board } from '@/board/Board';
import type { PvPly } from './pv.ts';

/**
 * The board that appears beside a hovered ply of an engine line.
 *
 * Beside the pane rather than on the main board: that one already carries
 * the engine's arrow and the piece-value overlay, and redrawing it as the
 * pointer crosses a line would strobe the thing the reader is comparing
 * against. Desktop only — there is no hovering to preview with a thumb, so
 * on a coarse pointer none of this mounts.
 */

/** Card geometry, in px. Read by the placement maths, so not a class. */
const CARD_W = 188;
const CARD_H = 206;
const MARGIN = 8;

/** Long enough that crossing the pane opens nothing. */
const OPEN_DELAY_MS = 120;
/** Short enough to feel attached, long enough to survive the gap between
    two plies — without it, sliding along a line closes and reopens the
    board at every move. */
const CLOSE_DELAY_MS = 80;

export interface PvPeekState {
  ply: PvPly;
  /** The hovered ply, for centring the card on the move it belongs to. */
  rect: DOMRect;
  /** The row's edges. The card clears the whole row rather than the one
      move, or it opens on top of the line being read. */
  row: { left: number; right: number };
}

export interface PvPeekControls {
  peek: PvPeekState | null;
  show: (ply: PvPly, anchor: HTMLElement) => void;
  hide: () => void;
  /** Shut it now, no grace period — for when the anchor is about to go. */
  close: () => void;
}

export function usePvPeek(enabled: boolean): PvPeekControls {
  const [peek, setPeek] = useState<PvPeekState | null>(null);
  const timer = useRef<number | null>(null);
  const open = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const close = useCallback(() => {
    cancel();
    open.current = false;
    setPeek(null);
  }, [cancel]);

  const show = useCallback(
    (ply: PvPly, anchor: HTMLElement) => {
      if (!enabled) return;
      cancel();
      // The li in a PV list, the text row in the Why card — either way the
      // box the card has to stay off, so it never covers the moves.
      const row = (anchor.closest('li') ?? anchor.parentElement ?? anchor).getBoundingClientRect();
      const next = {
        ply,
        rect: anchor.getBoundingClientRect(),
        row: { left: row.left, right: row.right },
      };
      // Already up: track the pointer along the line immediately. The
      // delay guards the first open, not every move after it.
      if (open.current) {
        setPeek(next);
        return;
      }
      timer.current = window.setTimeout(() => {
        open.current = true;
        setPeek(next);
      }, OPEN_DELAY_MS);
    },
    [enabled, cancel],
  );

  const hide = useCallback(() => {
    cancel();
    timer.current = window.setTimeout(close, CLOSE_DELAY_MS);
  }, [cancel, close]);

  // The card is placed from the rect the ply had when it was hovered, and
  // the list of lines scrolls inside the pane — so a scroll leaves it
  // pointing at whatever moved into that spot. Capture phase, because the
  // scrolling element is the list, not the window. Same treatment the
  // title tooltips get in ui/tooltip.
  useEffect(() => {
    if (!peek) return;
    document.addEventListener('scroll', close, true);
    return () => document.removeEventListener('scroll', close, true);
  }, [peek, close]);

  useEffect(() => cancel, [cancel]);

  return { peek, show, hide, close };
}

/**
 * Level with the ply, clear of the row it sits in. The engine block is
 * docked right on a desktop, so the left is tried first and the right is
 * the fallback; the clamp keeps the card on screen for the lines nearest
 * the top and bottom of the pane.
 */
function place({ rect, row }: PvPeekState): { top: number; left: number } {
  const leftOf = row.left - CARD_W - MARGIN;
  const left =
    leftOf >= MARGIN ? leftOf : Math.min(row.right + MARGIN, window.innerWidth - CARD_W - MARGIN);
  const top = Math.min(
    rect.top + rect.height / 2 - CARD_H / 2,
    window.innerHeight - CARD_H - MARGIN,
  );
  return { top: Math.max(top, MARGIN), left: Math.max(left, MARGIN) };
}

export function PvPeek({
  peek,
  orientation,
}: {
  peek: PvPeekState | null;
  orientation: 'white' | 'black';
}) {
  if (!peek) return null;
  const { top, left } = place(peek);

  return createPortal(
    // Portalled, because a panel with a transform or an overflow clip
    // between here and the body would capture a `fixed` card.
    <div
      style={{ top, left, width: CARD_W }}
      className="border-line bg-surface pointer-events-none fixed z-50 rounded-lg border p-1 shadow-[var(--shadow-pop)]"
    >
      <Board
        fen={peek.ply.fen}
        orientation={orientation}
        viewOnly
        coordinates={false}
        lastMove={peek.ply.squares}
        className="rounded"
      />
      <p className="text-subtle pt-1 text-center font-mono text-[10px]">
        {peek.ply.number !== undefined ? `${peek.ply.number} ` : ''}
        {peek.ply.san}
      </p>
    </div>,
    document.body,
  );
}
