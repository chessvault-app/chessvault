import { useEffect, useRef, useState } from 'react';
import { routeChanging } from './router';

/**
 * Whether a wait has gone on long enough to be worth admitting to.
 *
 * A skeleton that flashes is worse than no skeleton: the eye reads a
 * flicker as something going wrong, and it also makes a fast load FEEL
 * slower than the same load with nothing in it. So nothing is shown for
 * the first `delay` — most loads finish inside it and stay invisible — and
 * once something is shown it stays for `minVisible`, so it cannot appear
 * and vanish in the same breath.
 *
 * One hook for the two waits a page has. A page's DATA wait (its rows,
 * its record) uses the defaults, 180 ms and 400 ms, which were set here
 * by watching the app's own loads. A route's CODE wait, the chunk itself
 * (lib/lazyRoute), passes its own two figures. The two waits are in
 * sequence, never at once: a route's placeholder stands until the chunk
 * lands, then the page mounts and its own wait begins. That the second
 * placeholder waits its own delay is by design: the page's header and
 * frame are up by then, and a list that lands inside 180 ms is best not
 * mentioned.
 *
 * Here, in lib, rather than beside the skeletons it governs:
 * components/skeletons composes the board, the panel and the vault tree
 * and is a chunk of its own, and lib/lazyRoute has to be in the shell.
 */
export function useSlowLoad(active: boolean, delay = 180, minVisible = 400): boolean {
  // Up from the first frame while a page is arriving: a phone's push
  // slides the new page in over 337ms, and a page that draws nothing
  // until its record lands slid in as a bare ground (black on a dark
  // theme, seen on a phone over 5G opening a game). The slide is what
  // hides a flash, so the placeholder can be there from the first frame.
  // In the initialiser, not in the effect: the transition snapshots
  // what the commit painted, and an effect's setState is a frame late
  // for that picture. The minimum stay still applies.
  const [shown, setShown] = useState(() => active && routeChanging());
  // oxlint-disable-next-line react/purity -- a mount timestamp, read only by the effect
  const shownAt = useRef(shown ? Date.now() : 0);
  useEffect(() => {
    if (active) {
      if (shown) return;
      const wait = routeChanging() ? 0 : delay;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, wait);
      return () => clearTimeout(timer);
    }
    if (!shown) return;
    const remaining = minVisible - (Date.now() - shownAt.current);
    if (remaining <= 0) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(false), remaining);
    return () => clearTimeout(timer);
  }, [active, shown, delay, minVisible]);
  return shown;
}
