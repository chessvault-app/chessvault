import { useEffect, useRef } from 'react';

/** The zoom range every zoomable page in the app shares. */
export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 3;

/** Where a pinch is, relative to the element's top-left corner. */
export interface PinchPoint {
  x: number;
  y: number;
}

/** A pinch under way: how far it has gone, and where its centre is. */
export interface PinchLive extends PinchPoint {
  scale: number;
}

/**
 * Two-finger pinch on `ref` multiplies the zoom. A NATIVE non-passive
 * touchmove listener: React's own is passive, so preventDefault would be
 * ignored and the page would scroll/zoom underneath the gesture.
 *
 * Without `live`, every move applies its factor as it comes — right for
 * a crop that is an <img> the browser rescales for free. With `live`,
 * the gesture is previewed through it (a CSS transform is the idea) and
 * `apply` is called ONCE when the fingers lift, with the whole factor and
 * the centre: a page that is re-rastered at every zoom cannot follow the
 * fingers move by move, and applying each move made a pinch a stutter.
 */
export function usePinchZoom(
  ref: React.RefObject<HTMLDivElement | null>,
  apply: (factor: number, at?: PinchPoint) => void,
  /** Include anything that swaps the DOM node under the ref (e.g. the
      crop/full-page toggle) — the listeners must move to the new element. */
  rebind?: unknown,
  live?: (pinch: PinchLive | null) => void,
): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last: number | null = null;
    let start: number | null = null;
    let at: PinchPoint = { x: 0, y: 0 };
    const dist = (t: TouchList): number =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const centre = (t: TouchList): PinchPoint => {
      const r = el.getBoundingClientRect();
      return {
        x: (t[0]!.clientX + t[1]!.clientX) / 2 - r.left,
        y: (t[0]!.clientY + t[1]!.clientY) / 2 - r.top,
      };
    };
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) {
        last = dist(e.touches);
        start = last;
        at = centre(e.touches);
      }
    };
    const onMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || last === null || start === null) return;
      e.preventDefault();
      const d = dist(e.touches);
      if (d > 0 && last > 0) {
        if (liveRef.current) liveRef.current({ scale: d / start, ...at });
        else applyRef.current(d / last);
      }
      last = d;
    };
    const onEnd = (): void => {
      if (liveRef.current && last !== null && start !== null && start > 0) {
        liveRef.current(null);
        applyRef.current(last / start, at);
      }
      last = null;
      start = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, rebind]);
}
