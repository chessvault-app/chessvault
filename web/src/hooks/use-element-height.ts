import { useCallback, useRef, useState } from 'react';

/**
 * An element's height, kept current by a ResizeObserver — the vertical
 * twin of use-element-width, and a callback ref for the same reason: the
 * measured region may mount conditionally, so a static ref bound once on
 * mount would never see it.
 */
export function useElementHeight(): [(el: HTMLDivElement | null) => void, number] {
  const [height, setHeight] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    ro.current = observer;
  }, []);
  return [attach, height];
}
