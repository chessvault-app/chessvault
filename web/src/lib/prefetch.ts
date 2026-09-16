/**
 * Warming the sections nobody has opened yet.
 *
 * Every section is its own chunk, fetched the first time it is drawn
 * (lib/lazyRoute), and nothing fetched one ahead of time: every section
 * was cold until its first visit, and on a slow link a first tap on the
 * Games tab waited 3.7 s behind a placeholder. The routers this app is
 * shaped like do not leave it there. Next.js prefetches a link's route
 * when the link scrolls into view, TanStack Router on hover or on the
 * viewport, Remix on render, all of them once the page itself is up. So
 * this: once the app has loaded and the browser reports itself idle, the
 * sections are asked for one at a time, in the order a thumb reaches
 * them, each waiting for the next idle period before it starts.
 *
 * One at a time, never a burst: the board's page alone is forty-odd
 * files, and a burst of those beside the page the user is actually
 * reading is the fetch it was trying to spare them. And not at all
 * where the user has asked to save data (`navigator.connection.saveData`,
 * `prefers-reduced-data`) or the link reports itself as 2G, where every
 * byte is one the current page could have had.
 *
 * `requestIdleCallback` where it exists (Safari has none, as of 26): the
 * fallback is a plain timeout, which is what React's own scheduler does.
 */

const IDLE_TIMEOUT_MS = 2_000;
/** How long after `load` the first warm may start; the app's own first
    fetches (the launch section's rows, the fonts) get the link first. */
const SETTLE_MS = 1_500;

type Warm = () => Promise<void> | null;

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/** Whether this link should be spared: the user asked, or it is 2G. */
export function dataConstrained(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData) return true;
  if (connection?.effectiveType && /2g/.test(connection.effectiveType)) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-data: reduce)').matches;
}

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(resolve, 50);
  });
}

function afterLoad(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }));
}

/**
 * Warm `warms` in order, one at a time, each in an idle period after the
 * one before has landed. A warm that returns null (already in hand) is
 * skipped without waiting. Returns a stop, for the effect that started it.
 */
export function prefetchWhenIdle(warms: readonly Warm[]): () => void {
  let live = true;
  void (async () => {
    await afterLoad();
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    for (const warm of warms) {
      if (!live) return;
      if (dataConstrained()) return;
      await whenIdle();
      if (!live) return;
      // A chunk that will not come (offline, a stale deploy) is
      // lazyRoute's to handle when the route is drawn; here it only ends
      // the sweep, since the next one would fail the same way.
      try {
        await warm();
      } catch {
        return;
      }
    }
  })();
  return () => {
    live = false;
  };
}
