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

/**
 * How long a piece takes to travel to its new square.
 *
 * Exported because a caller that REPLACES this board when a line finishes
 * has to let the last move land first — swap the component and chessground
 * mounts afresh at the final position, which is a jump, not a move (see
 * the trainers' solution replays).
 */
const BOARD_ANIM_MS = 180;

/**
 * That duration, or none at all when the user has asked for less motion.
 *
 * Reaching for it here rather than in CSS because CSS cannot reach it:
 * chessground animates from rAF and puts no transition on a piece, so
 * `@media (prefers-reduced-motion: reduce)` in index.css slid straight
 * past the board while it was crushing the spinners.
 *
 * Zero rather than merely shorter, because nothing is lost by it: which
 * move was just played is already carried without motion, by the
 * last-move highlight two lines below. The slide is the redundant channel,
 * which is exactly the kind the setting asks to remove.
 *
 * Callers that wait out the animation before swapping the board must
 * spend THIS, not the constant, or they wait 180ms for a move that has
 * already landed.
 */
export const boardAnimMs = (): number => (prefersReducedMotion() ? 0 : BOARD_ANIM_MS);
