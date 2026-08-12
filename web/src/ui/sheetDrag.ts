import { useRef, useState } from 'react';

/** Past this much of a downward drag, letting go dismisses the sheet. */
const DISMISS_PX = 72;

/**
 * Push a bottom sheet away with the thumb.
 *
 * Shared by every sheet that rises from the bottom edge — the row's ⋯
 * menu and the windows the Add button opens — so the gesture is one
 * thing that behaves identically wherever a sheet appears.
 *
 * `handlers` go on the GRAB AREA (the header), not the whole sheet:
 * below it is content, and a drag that starts on a button or in a text
 * field must not have to decide whether it was a press. `style` goes on
 * the sheet itself.
 */
export function useSheetDrag(onClose: () => void): {
  style: { transform?: string; transition?: string };
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
} {
  const [dragY, setDragY] = useState(0);
  const from = useRef<number | null>(null);
  /**
   * The live offset, for the release to judge by.
   *
   * NOT the state: if the last move and the release land in one React
   * batch, the release handler still closes over the previous render's
   * dragY — zero — and a long throw would spring back instead of
   * dismissing. The state is only what the sheet is painted from.
   */
  const now = useRef(0);

  return {
    style: {
      transform: dragY ? `translateY(${dragY}px)` : undefined,
      // No transition mid-drag, or the sheet lags the thumb by 180ms.
      transition: from.current === null ? 'transform 180ms cubic-bezier(0.4,0,0.2,1)' : undefined,
    },
    handlers: {
      onPointerDown: (e) => {
        from.current = e.clientY;
        // Capture keeps the moves coming when the finger leaves the
        // header, and throws for a pointer the browser no longer holds
        // active — a throw here would take the gesture with it.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable — track what we can */
        }
      },
      onPointerMove: (e) => {
        if (from.current === null) return;
        // Downwards only: a sheet that follows the finger up suggests it
        // can be expanded, which is a promise it does not keep.
        const dy = Math.max(0, e.clientY - from.current);
        now.current = dy;
        setDragY(dy);
      },
      onPointerUp: () => {
        if (from.current === null) return;
        from.current = null;
        if (now.current > DISMISS_PX) {
          onClose();
          return;
        }
        now.current = 0;
        setDragY(0);
      },
      onPointerCancel: () => {
        from.current = null;
        now.current = 0;
        setDragY(0);
      },
    },
  };
}
