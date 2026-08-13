/**
 * When the app has drawn a PAGE, not just its frame.
 *
 * The launch screen used to come down on a timer, and the timer was
 * racing the wrong thing. Every section is a lazy chunk behind a Suspense
 * whose fallback is deliberately blank, so the first thing to paint is
 * the shell — the sidebar, the bottom nav bar — with an empty box where
 * the page will be. On a cold start the chunk can arrive after the timer,
 * and what lanph3re saw was exactly that: the launch screen went, the
 * frame showed for a moment with the nav bar in it, then the page
 * appeared.
 *
 * So the screen waits for this instead. `firstPaintDone` is called from
 * inside the Suspense boundary, which commits only once the route's own
 * chunk has resolved, and after two frames — one for React's commit,
 * one for the browser to have painted it.
 */
let painted = false;
const waiting: (() => void)[] = [];

export function firstPaintDone(): void {
  if (painted) return;
  painted = true;
  for (const resolve of waiting) resolve();
  waiting.length = 0;
}

/** Resolves once the first route has painted, or immediately if it has. */
export function whenFirstPainted(): Promise<void> {
  return painted ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve));
}
