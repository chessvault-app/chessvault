import { createElement, useEffect, useState, type ComponentProps, type ComponentType } from 'react';

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
 *
 * Loaded by hand rather than through React.lazy, because a route that
 * suspends pays for it twice over. lazy() suspends the first time it draws
 * a route whatever else is true — it calls the loader DURING that render
 * and settles it a microtask later — so the blank fallback commits, and
 * once a fallback has been committed React holds the real content back for
 * its reveal throttle (FALLBACK_THROTTLE_MS, 300 ms), which exists to stop
 * a spinner flashing past. On a launch there is no spinner to protect.
 * Measured on a cold launch against a local server, the Databases page
 * rendered at 171 ms and did not commit — so did not fetch its own
 * contents — until 453 ms, with the chunk in hand since 139 ms and the
 * main thread idle throughout.
 *
 * The same blank box, held as ordinary state instead of as a fallback,
 * costs none of that: it is replaced the moment the module lands. The
 * import is started during render rather than from an effect, which is
 * what lazy() does internally and is what keeps the request going out
 * before the first paint instead of after it.
 *
 * Warming the chunk BEFORE the first render was tried and rejected: it
 * does not help (the boundary suspends anyway, since lazy calls its own
 * loader), and holding the render for the chunk made a narrow link
 * markedly worse — on a throttled 1.6 Mbps link the Board's twenty-odd
 * chunks pushed the webfonts back behind them and first contentful paint
 * went from 3.1 s to 4.5 s. A route is worth drawing as soon as it is
 * there, and never worth holding the app's own frame for.
 */
const RELOADED_AT = 'chess-vault:chunk-reload';
const COOLDOWN_MS = 10_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React's own
// lazy() was typed this way; narrowing it here would reject valid components.
export function lazyRoute<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): ComponentType<ComponentProps<T>> {
  // Module-level, so a section visited twice draws immediately the second
  // time and the import is never asked for twice.
  let ready: T | null = null;
  // What the boundary above is owed when the chunk will not come at all:
  // React.lazy threw it out of the render, and so does this — a route that
  // silently stayed blank would be the black window all over again.
  let failure: unknown = null;
  let pending: Promise<void> | null = null;

  const fetchModule = (): Promise<void> =>
    (pending ??= load()
      .catch((error: unknown) => {
        const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
        if (Date.now() - last > COOLDOWN_MS) {
          sessionStorage.setItem(RELOADED_AT, String(Date.now()));
          location.reload();
          // Never settles: the reload is on its way and rendering an error
          // for the half-second before it lands would only flash.
          return new Promise<{ default: T }>(() => {});
        }
        throw error;
      })
      .then(
        (module) => {
          ready = module.default;
        },
        (error: unknown) => {
          failure = error;
        },
      ));

  return function Route(props: ComponentProps<T>) {
    const [, redraw] = useState(0);
    // In render, not in an effect: effects run after the paint, and the
    // chunk should be asked for while the browser is already fetching the
    // shell's own files, not a frame later.
    if (!ready && !failure) void fetchModule();
    useEffect(() => {
      if (ready) return;
      let live = true;
      void fetchModule().then(() => {
        if (live) redraw((n) => n + 1);
      });
      return () => {
        live = false;
      };
    }, []);
    // Thrown from render so the route's error boundary catches it, which
    // is where lazy() used to put it.
    if (failure) throw failure;
    // Until then the same empty box the Suspense fallback drew, and for
    // the same reason: a section's chunk usually beats the next paint, so
    // anything more would be a skeleton nobody sees.
    return ready ? createElement(ready, props) : null;
  };
}
