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
 * Safari's proprietary pinch events, the only reliable pinch signal on
 * iOS: once a native pan has begun there — one finger moving before the
 * second lands is enough — every later touchmove arrives NON-cancelable,
 * preventDefault is ignored, and the touch arithmetic below never runs;
 * on the phone a pinch simply scrolled (lanph3re's report). Gesture
 * events carry the recognised pinch regardless of what the scroller is
 * doing, and preventDefault on them is honoured. WebKit-only, so where
 * they exist they are the implementation and the touch listeners are
 * demoted to holding the page still; everywhere else the touch path is
 * exactly what it was.
 */
interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
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
    // Read at bind time, not module load: the listeners bind when the
    // document arrives, which is also what lets a test stand the global
    // up first.
    const gestures = 'GestureEvent' in window;
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
      // Non-cancelable when a native pan already owns the touches (iOS);
      // calling preventDefault there is a console warning, not a stop.
      if (e.cancelable) e.preventDefault();
      // Where gesture events exist they carry the zoom (below); the touch
      // listener's remaining job is the preventDefault above, which holds
      // the page still under the fingers whenever it is allowed to.
      if (gestures) return;
      const d = dist(e.touches);
      if (d > 0 && last > 0) {
        if (liveRef.current) liveRef.current({ scale: d / start, ...at });
        else applyRef.current(d / last);
      }
      last = d;
    };
    const onEnd = (): void => {
      if (!gestures && liveRef.current && last !== null && start !== null && start > 0) {
        liveRef.current(null);
        applyRef.current(last / start, at);
      }
      last = null;
      start = null;
      // The freeze's backstop: every touch sequence ends in touchend or
      // touchcancel, so a gestureend WebKit swallowed cannot leave the
      // scroller locked.
      if (!gLive) unfreeze();
    };

    // The WebKit pinch. The centre is the gesture's own centroid, taken
    // once at the start the way the touch path takes it; `gLast` is what
    // makes the live-less path incremental, since e.scale is cumulative.
    //
    // The scroller is FROZEN for the gesture's lifetime. iOS lets its
    // native pan keep running under the pinch — the touchmoves are the
    // non-cancelable ones that forced this path to exist — which broke
    // two things the preview and the commit rely on: the transform's
    // origin is computed against a scrollTop that must hold still, and
    // the pan's leftover momentum kept scrolling AFTER the commit had
    // anchored the pinched point, which is the release flicker. Setting
    // overflow hidden is the preventDefault those moves refuse: user
    // scrolling stops, momentum is stranded, and the commit's own
    // programmatic anchoring is untouched by it. Undone when the gesture
    // ends — a finger still down pans normally again — and from the
    // touch-end side as well, in case WebKit ever drops a gestureend.
    let gLive = false;
    let gLast = 1;
    let gAt: PinchPoint = { x: 0, y: 0 };
    let frozen: string | null = null;
    const freeze = (): void => {
      if (frozen === null) {
        frozen = el.style.overflow;
        el.style.overflow = 'hidden';
      }
    };
    const unfreeze = (): void => {
      if (frozen !== null) {
        el.style.overflow = frozen;
        frozen = null;
      }
    };
    const onGStart = (e: SafariGestureEvent): void => {
      e.preventDefault();
      gLive = true;
      gLast = 1;
      freeze();
      const r = el.getBoundingClientRect();
      gAt = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onGChange = (e: SafariGestureEvent): void => {
      if (!gLive) return;
      e.preventDefault();
      if (e.scale <= 0) return;
      if (liveRef.current) liveRef.current({ scale: e.scale, ...gAt });
      else {
        applyRef.current(e.scale / gLast);
        gLast = e.scale;
      }
    };
    const onGEnd = (e: SafariGestureEvent): void => {
      if (!gLive) return;
      gLive = false;
      if (liveRef.current) {
        liveRef.current(null);
        if (e.scale > 0) applyRef.current(e.scale, gAt);
      }
      unfreeze();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    if (gestures) {
      el.addEventListener('gesturestart', onGStart as EventListener, { passive: false });
      el.addEventListener('gesturechange', onGChange as EventListener, { passive: false });
      el.addEventListener('gestureend', onGEnd as EventListener);
    }
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      if (gestures) {
        el.removeEventListener('gesturestart', onGStart as EventListener);
        el.removeEventListener('gesturechange', onGChange as EventListener);
        el.removeEventListener('gestureend', onGEnd as EventListener);
      }
      // Unbound mid-gesture (the crop/full toggle swaps the node): the
      // outgoing element gets its scrolling back.
      unfreeze();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, rebind]);
}
