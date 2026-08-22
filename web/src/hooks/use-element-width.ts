import { useCallback, useRef, useState } from 'react';

/**
 * An element's width, kept current by a ResizeObserver. Returned as a
 * CALLBACK ref: the measured pane may mount only when its tab is active,
 * so a static ref bound once on mount would never see it.
 */
export function useElementWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    ro.current = observer;
  }, []);
  return [attach, width];
}
