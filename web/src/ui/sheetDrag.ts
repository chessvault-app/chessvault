import { useEffect, useRef, useState } from 'react';
import { suppressNextClick } from '@/lib/suppressNextClick';

/** Past this much of a downward drag, letting go dismisses the sheet. */
const DISMISS_PX = 72;

/** How far a finger must travel before the gesture is called one way or the other. */
const SLOP_PX = 6;

/**
 * A single move bigger than this did not come from a finger.
 *
 * When the keyboard opens, iOS shifts the page up to reveal the field.
 * The finger has not moved, but clientY is measured against a page that
 * HAS, so the next touchmove arrives with the whole shift in it — a
 * couple of hundred pixels of apparent downward drag, which is a dismiss.
 * Fingers do not travel 200px between two frames; viewports do.
 */
const JUMP_PX = 120;

/**
 * Is everything between `target` and the sheet scrolled to its top?
 *
 * The rule that lets a sheet be dragged from anywhere: a downward pull is
 * the sheet's only when the content under the finger has nothing left to
 * scroll up. Pull inside a half-scrolled list and it is a scroll; pull
 * once that list is at its top and the sheet comes with you.
 */
function contentAtTop(target: Element | null, sheet: HTMLElement): boolean {
  for (let el = target; el && el !== sheet.parentElement; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    const scrolls =
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight + 1;
    if (scrolls && el.scrollTop > 0) return false;
  }
  return true;
}

/**
 * Push a bottom sheet away with the thumb, from anywhere on it.
 *
 * Shared by every sheet that rises from the bottom edge — the row's ⋯ menu
 * and the windows the Add button opens — so the gesture is one thing that
 * behaves identically wherever a sheet appears.
 *
 * `ref` goes on the SHEET, and is what makes the whole surface draggable:
 * the handle is a sign that the sheet can be pushed, not the only place it
 * answers. `handlers` are the mouse's version and belong on the grab area
 * only, since a pointer that can hover has the X and the scrim and no
 * reach problem to solve. `style` goes on the sheet with the ref.
 *
 * Touch is handled with native listeners rather than React's, because
 * React attaches touchmove PASSIVELY at the root, and a passive listener
 * cannot cancel the scroll it is competing with.
 */
export function useSheetDrag(onClose: () => void): {
  style: { transform?: string; transition?: string };
  ref: (node: HTMLElement | null) => void;
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
} {
  const [dragY, setDragY] = useState(0);
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
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

  // Kept in a ref so the native listeners, attached once, always call the
  // current one — an onClose rebuilt every render would otherwise be read
  // as it was at mount.
  const close = useRef(onClose);
  close.current = onClose;

  const end = (): void => {
    if (from.current === null) return;
    from.current = null;
    if (now.current > DISMISS_PX) {
      now.current = 0;
      close.current();
      return;
    }
    now.current = 0;
    setDragY(0);
  };

  useEffect(() => {
    if (!sheet) return;
    // Which way this gesture went: null while it is still undecided, true
    // once it belongs to the sheet, false once it belongs to a scroller.
    let mine: boolean | null = null;
    // The previous touchmove's position, for spotting a jump.
    let last = 0;

    const onStart = (e: TouchEvent): void => {
      // A second finger means a pinch or a stray palm, not a push.
      // A finger on a text field is a caret, not a push either: the sheet
      // must not move because somebody reached for the thing they came to
      // type in. This is the one that bit — tapping the PGN box dismissed
      // the whole window, because focusing it opened the keyboard, which
      // shifted the page, which arrived here as a long downward drag.
      // A canvas is the same bargain: it draws its own handles and reads
      // its own pointers, and the picture window's four corner handles are
      // dragged DOWNWARDS as often as any other way — every one of those
      // would otherwise be a dismiss, throwing the alignment away.
      const target = e.target as Element | null;
      if (
        e.touches.length !== 1 ||
        target?.closest('input, textarea, canvas, [contenteditable="true"]')
      ) {
        from.current = null;
        mine = false;
        return;
      }
      from.current = e.touches[0]!.clientY;
      last = from.current;
      mine = null;
      now.current = 0;
    };

    const onMove = (e: TouchEvent): void => {
      if (from.current === null || mine === false) return;
      const y = e.touches[0]!.clientY;
      // The viewport moved, not the finger. Abandon the gesture rather
      // than act on a number that is mostly somebody else's arithmetic.
      if (Math.abs(y - last) > JUMP_PX) {
        from.current = null;
        mine = false;
        now.current = 0;
        setDragY(0);
        return;
      }
      last = y;
      const dy = y - from.current;
      if (mine === null) {
        if (Math.abs(dy) < SLOP_PX) return;
        // Down, and nothing under the finger left to scroll up.
        mine = dy > 0 && contentAtTop(e.target as Element, sheet);
        if (!mine) {
          from.current = null;
          return;
        }
        // Start counting from HERE, so the sheet does not jump by the
        // slop the moment it is claimed.
        from.current += SLOP_PX;
      }
      // The browser is not to scroll what this gesture is now moving.
      // Cancelable only until a scroll has started; it has not, because
      // the content was at its top and there was nothing to start.
      if (e.cancelable) e.preventDefault();
      const moved = Math.max(0, y - from.current);
      now.current = moved;
      setDragY(moved);
    };

    const onEnd = (): void => {
      if (mine) {
        // The finger may have started on a verb. A gesture that moved the
        // sheet was not a press on whatever it began over, and the click
        // a touch synthesizes afterwards would run that verb — dismissing
        // the sheet AND doing the thing.
        suppressNextClick();
        end();
      }
      mine = null;
      from.current = null;
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  return {
    style: {
      transform: dragY ? `translateY(${dragY}px)` : undefined,
      // No transition mid-drag, or the sheet lags the thumb by 180ms.
      transition: from.current === null ? 'transform 180ms cubic-bezier(0.4,0,0.2,1)' : undefined,
    },
    ref: setSheet,
    handlers: {
      onPointerDown: (e) => {
        // Touch has its own path above, which knows about the scrollers.
        if (e.pointerType === 'touch') return;
        // A press on a control IN the grab area is a press. Capturing it
        // retargets the pointerup — and with it the click — to the strip,
        // so the header's Back chevron ate its own clicks under a mouse.
        if ((e.target as Element).closest('button, a, input')) return;
        from.current = e.clientY;
        // Capture keeps the moves coming when the pointer leaves the
        // header, and throws for one the browser no longer holds active —
        // a throw here would take the gesture with it.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable — track what we can */
        }
      },
      onPointerMove: (e) => {
        if (e.pointerType === 'touch' || from.current === null) return;
        // Downwards only: a sheet that follows the pointer up suggests it
        // can be expanded, which is a promise it does not keep.
        const dy = Math.max(0, e.clientY - from.current);
        now.current = dy;
        setDragY(dy);
      },
      onPointerUp: end,
      onPointerCancel: () => {
        from.current = null;
        now.current = 0;
        setDragY(0);
      },
    },
  };
}
