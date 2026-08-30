/**
 * Whether the user has asked for less motion.
 *
 * A function rather than a hook or a cached boolean: the two callers ask
 * at the moment they are about to move something, which is the only
 * moment the answer matters, and a value read once at import would
 * outlive a setting changed mid-session.
 *
 * The CSS side of this lives in `index.css` under
 * `@media (prefers-reduced-motion: reduce)`, and covers everything the
 * cascade can reach. This is for what it cannot: chessground animates
 * pieces from `requestAnimationFrame`, writing transforms frame by frame,
 * and ships no `transition` on a piece at all — so the blanket CSS rule
 * never touched the largest motion in the app, and could not have.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
