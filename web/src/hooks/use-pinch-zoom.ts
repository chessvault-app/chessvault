import { useEffect, useRef } from 'react';

/** The zoom range every zoomable page in the app shares. */
export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 3;

/**
 * Two-finger pinch on `ref` multiplies the zoom. A NATIVE non-passive
 * touchmove listener: React's own is passive, so preventDefault would be
 * ignored and the page would scroll/zoom underneath the gesture.
 */
export function usePinchZoom(
  ref: React.RefObject<HTMLDivElement | null>,
  apply: (factor: number) => void,
  /** Include anything that swaps the DOM node under the ref (e.g. the
      crop/full-page toggle) — the listeners must move to the new element. */
  rebind?: unknown,
): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last: number | null = null;
    const dist = (t: TouchList): number =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) last = dist(e.touches);
    };
    const onMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || last === null) return;
      e.preventDefault();
      const d = dist(e.touches);
      if (d > 0 && last > 0) applyRef.current(d / last);
      last = d;
    };
    const onEnd = (): void => {
      last = null;
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
