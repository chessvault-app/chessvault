import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeNear } from '@/lib/floating';
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
  /** The position that ply leads to, worked out by the caller at hover
      time rather than carried on every ply of every line. */
  fen: string;
  /** The hovered ply, for centring the card on the move it belongs to. */
  rect: DOMRect;
  /** The row's edges. The card clears the whole row rather than the one
      move, or it opens on top of the line being read. */
  row: { left: number; right: number };
}

export interface PvPeekControls {
  peek: PvPeekState | null;
  show: (ply: PvPly, fen: string, anchor: HTMLElement) => void;
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
    (ply: PvPly, fen: string, anchor: HTMLElement) => {
      if (!enabled) return;
      cancel();
      // The li in a PV list, the text row in the Why card — either way the
      // box the card has to stay off, so it never covers the moves.
      const row = (anchor.closest('li') ?? anchor.parentElement ?? anchor).getBoundingClientRect();
      const next = {
        ply,
        fen,
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
  // title tooltips get in components/ui/tooltip.
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
 *
 * Two rectangles, which is why this composes one rather than passing a
 * DOMRect straight through: the card is level with the PLY (a word in a
 * line of moves) and clear of the ROW (the whole line), or a card for a
 * move halfway along a line would be laid over the rest of it.
 */
function place({ rect, row }: PvPeekState): { top: number; left: number } {
  return placeNear(
    {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      left: row.left,
      right: row.right,
      width: row.right - row.left,
    },
    { width: CARD_W, height: CARD_H },
    { side: 'left', align: 'center', gap: MARGIN, margin: MARGIN },
  );
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
      className="border-border bg-card pointer-events-none fixed z-50 rounded-lg border p-1 shadow-pop"
    >
      <Board
        fen={peek.fen}
        orientation={orientation}
        viewOnly
        coordinates={false}
        lastMove={peek.ply.squares}
        className="rounded-sm"
      />
      {/* The label, always — including on Black's moves, where the line
          itself prints none. On the board there is no line to read the
          number off, so "exd4" alone would not say which move this is. */}
      <p className="text-subtle pt-1 text-center font-mono text-[10px]">
        {peek.ply.label} {peek.ply.san}
      </p>
    </div>,
    document.body,
  );
}
