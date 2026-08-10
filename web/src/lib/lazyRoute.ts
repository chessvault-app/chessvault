import { lazy, type ComponentType } from 'react';

/**
 * A lazily-loaded route that survives the app being redeployed under it.
 *
 * Every section is a separate chunk, fetched the first time you go there.
 * The filenames carry a content hash, so a deploy replaces them — and a
 * window that was already open still holds the OLD index, which asks for
 * chunks that are no longer on the server. The import rejects, React
 * unmounts the tree, and what you get is a black window on the next
 * navigation. Nothing is wrong with the app; it is simply out of date.
 *
 * So a failed chunk fetch is treated as what it is: this page is stale.
 * Reload once and the new index arrives with chunk names that exist.
 *
 * Guarded against looping. If a reload does not fix it — genuinely offline,
 * a broken deploy — the second failure inside the window is allowed to
 * surface instead of reloading forever.
 */
const RELOADED_AT = 'chess-vault:chunk-reload';
const COOLDOWN_MS = 10_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React's own
// lazy() is typed this way; narrowing it here would reject valid components.
export function lazyRoute<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((error: unknown) => {
      const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
      if (Date.now() - last > COOLDOWN_MS) {
        sessionStorage.setItem(RELOADED_AT, String(Date.now()));
        location.reload();
        // Never settles: the reload is on its way and rendering an error
        // for the half-second before it lands would only flash.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }),
  );
}
