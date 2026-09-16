import {
  createElement,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
  type FunctionComponent,
} from 'react';
import { useSlowLoad } from './slowLoad';

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
 *
 * The empty box is not left empty for long, though. "A section's chunk
 * usually beats the next paint" is true of a fast link and false of a
 * slow one: on the demo build, an emulated phone at 1.5 Mbps and 150 ms,
 * a first tap on the Games tab drew nothing at all for 3.7 s, Puzzles
 * for 1.6 s, and a game opened from Home slid a bare ground in after the
 * router's 400 ms wait and kept it for another 3.3 s. So a route may
 * carry an `outline`, drawn once the wait is long enough to admit to,
 * held as ordinary state for the reason above (never as a Suspense
 * fallback, which pays the 300 ms reveal throttle on every navigation).
 *
 * The wait is governed by the same hook every page's own skeleton uses
 * (lib/slowLoad), with two figures of its own. The placeholder appears
 * after PENDING_MS and, once shown, stays MIN_VISIBLE_MS so it cannot
 * flash. The guides disagree on the first: Apple's HIG says show the
 * screen at once with placeholders in it (no delay at all), Android's
 * ContentLoadingProgressBar and eBay's skeleton floor say 500 ms,
 * Nielsen's one second is the ceiling past which a wait needs feedback,
 * and Material's guidelines give no number. 200 ms is lanph3re's call
 * between Apple's zero and the 500 the others share: a warm chunk lands
 * in 50 to 90 ms and never shows it, a slow link waits a fifth of a
 * second for a shape instead of half of one. The stay is TanStack
 * Router's default `pendingMinMs`. During a phone's page transition the
 * placeholder is there from the first frame, as the hook does for every
 * page: the slide is what hides a flash, and a page that slides in blank
 * is the sight this exists to remove.
 */
const RELOADED_AT = 'chess-vault:chunk-reload';
const COOLDOWN_MS = 10_000;
/** How long a chunk may take before its placeholder is drawn. */
export const PENDING_MS = 200;
/** How long a drawn placeholder stays, so it cannot flash. */
export const MIN_VISIBLE_MS = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React's own
// lazy() was typed this way; narrowing it here would reject valid components.
export type LazyRouteComponent<P> = FunctionComponent<P> & {
  /**
   * Whether the chunk is already in hand, and if not, the promise of it.
   * Null when the route will draw on its next render; otherwise the
   * import, started here if it has not been. This is the PAGE, and it is
   * what warming waits on (lib/prefetch), one section at a time.
   */
  pending: () => Promise<void> | null;
  /**
   * The same, but resolving as soon as there is anything to draw —
   * whichever of the page and its outline arrives first.
   *
   * The router asks this before a phone's page transition (lib/router,
   * swapRoute), and waits CHUNK_WAIT_MS for it: a route that draws blank
   * until its chunk lands slides a bare ground in, and nobody wants to
   * watch that. The outline is a fraction of the page's size, so on the
   * link where that mattered it is the one that answers.
   */
  drawable: () => Promise<void> | null;
};

/**
 * Whether a route's outline is on screen right now.
 *
 * A page whose chunk has just landed mounts UNDER its own outline, and
 * then starts its own wait for its own data — through `useSlowLoad`,
 * which holds a placeholder back 180ms so one cannot flash where nothing
 * stood. Here something did stand: the route's outline, drawn from the
 * same module the page is about to draw from. Without this the two waits
 * hand over through a 180ms hole, and the outline blinks out and back.
 *
 * So a page ORs this into its own gate. It is the same bargain
 * SettingsPage struck by hand between its own two waits (`outlineShown`),
 * made once here for the wait before them both.
 */
let outlineOnScreen = 0;
export const routePlaceholderShown = (): boolean => outlineOnScreen > 0;

export function lazyRoute<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  {
    outline,
  }: {
    /**
     * The page's OWN outline, as its own module, fetched in parallel
     * with the page.
     *
     * This is the shape every router settles on — Next's `loading`,
     * TanStack's `pendingComponent`, React Router's `HydrateFallback` —
     * and the rule they all keep is that the outline must not sit inside
     * the chunk it stands in for, or it arrives with the thing it was
     * meant to cover. Beside the page, in its own chunk: the page
     * imports it for its DATA wait and this imports it for the CHUNK
     * wait, so one picture covers both and neither can drift from the
     * other. It is a fraction of the page's size, so it lands first.
     *
     * Drawn with the page's OWN props, so a section whose shape depends
     * on the address (a shelf, or one document out of it) can answer the
     * same question the page answers from the same `params`. An outline
     * that does not care simply takes none.
     */
    outline?: () => Promise<{ default: ComponentType<ComponentProps<T>> }>;
  } = {},
): LazyRouteComponent<ComponentProps<T>> {
  // Module-level, so a section visited twice draws immediately the second
  // time and the import is never asked for twice.
  let ready: T | null = null;
  /** The outline module, on the same terms as `ready` above. */
  let sketch: ComponentType<ComponentProps<T>> | null = null;
  let sketchPending: Promise<void> | null = null;
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

  /**
   * The outline, asked for alongside the page.
   *
   * A failure is swallowed rather than thrown: the page itself is on its
   * way and will report its own trouble, and a stale-deploy reload is
   * already `fetchModule`'s job. An outline that cannot be fetched
   * should cost the reader a plain wait, never an error screen.
   */
  const fetchSketch = (): Promise<void> =>
    (sketchPending ??= outline!().then(
      (module) => {
        sketch = module.default;
      },
      () => {
        /* no outline, so no picture: the page is still coming */
      },
    ));

  const Route: FunctionComponent<ComponentProps<T>> = function Route(props: ComponentProps<T>) {
    // Left to React as written. The compiler takes a component made
    // inside a factory for a top-level one: `ready` and `failure`, the
    // factory's own variables, read as module constants to it, so it
    // cached the first (empty) output for good and, once they were read
    // through state instead, outlined the initialiser to module scope,
    // where `ready` is not defined. Every page came up blank, then threw.
    'use no memo';
    const [settled, setSettled] = useState<{ ready: T | null; failure: unknown } | null>(() =>
      ready || failure ? { ready, failure } : null,
    );
    // Whether the outline is in hand. Held as state for the same reason
    // `settled` is: the render that has it has to be a new one.
    const [drawn, setDrawn] = useState<ComponentType<ComponentProps<T>> | null>(() => sketch);
    // In render, not in an effect: effects run after the paint, and the
    // chunk should be asked for while the browser is already fetching the
    // shell's own files, not a frame later. Both requests go out together
    // — the point of the outline being its own chunk is that the small
    // one can overtake the large one.
    if (!settled) {
      void fetchModule();
      if (outline && !sketch) void fetchSketch();
    }
    useEffect(() => {
      if (settled) return;
      let live = true;
      void fetchModule().then(() => {
        if (live) setSettled({ ready, failure });
      });
      return () => {
        live = false;
      };
    }, [settled]);
    useEffect(() => {
      if (settled || !outline || drawn) return;
      let live = true;
      void fetchSketch().then(() => {
        // `() => sketch`, never `sketch`: a setter handed a FUNCTION
        // treats it as an updater and calls it, so React rendered what
        // the outline component RETURNED as if that were the component
        // (error #130 on every converted route).
        if (live) setDrawn(() => sketch);
      });
      return () => {
        live = false;
      };
    }, [settled, drawn]);
    // Whether the placeholder is up. It goes up after PENDING_MS of
    // waiting (or at once inside a page transition) and, once up, stays
    // its minimum even after the module has landed, which is what holds
    // a chunk that arrives just behind it from flashing the placeholder.
    const placeholder = useSlowLoad(!settled && outline !== undefined, PENDING_MS, MIN_VISIBLE_MS);
    // What is actually on screen: the gate is open AND there is something
    // to put through it. With an outline that may still be on the wire,
    // in which case nothing is drawn yet and this is false.
    const showing = placeholder && drawn !== null;
    // Counted from an effect, never from render (the compiler refuses a
    // module variable written during one, and is right to).
    //
    // The timing still works, and it is worth writing down why. The
    // count goes up in the commit that first DRAWS the outline, and the
    // page cannot mount in that commit — it mounts in a later one, when
    // the chunk has landed and the placeholder's minimum stay is over.
    // By then the count has been up for at least MIN_VISIBLE_MS. It
    // comes down in this effect's cleanup, which React runs after that
    // later render and before its effects, so the page's own
    // `useState(() => routePlaceholderShown())` has already read it.
    useEffect(() => {
      if (!showing) return;
      outlineOnScreen += 1;
      return () => {
        outlineOnScreen -= 1;
      };
    }, [showing]);
    // Thrown from render so the route's error boundary catches it, which
    // is where lazy() used to put it.
    if (settled?.failure) throw settled.failure;
    if (settled?.ready && !placeholder) return createElement(settled.ready, props);
    // Until then the same empty box the Suspense fallback drew, for the
    // first PENDING_MS: a section's chunk usually beats the next paint,
    // and a skeleton nobody sees is a flash. Past that, the outline —
    // and still nothing if the outline itself has not landed, which on a
    // link slow enough to matter it has, being the smaller of the two.
    return placeholder && drawn ? createElement(drawn, props) : null;
  };
  return Object.assign(Route, {
    pending: () => (ready || failure ? null : fetchModule()),
    drawable: () => {
      if (ready || failure) return null;
      const page = fetchModule();
      // Whichever can be drawn first. Without the outline in the race the
      // router would hold its page transition for the whole page and then
      // slide in a bare ground when CHUNK_WAIT_MS ran out, which is the
      // sight the outline exists to remove.
      if (!outline) return page;
      if (sketch) return null;
      return Promise.race([page, fetchSketch()]);
    },
  });
}
