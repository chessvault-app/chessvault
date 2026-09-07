/**
 * The board that flies.
 *
 * A phone's route change runs inside a View Transition (lib/router). By
 * default the two pages cross-fade; naming the same thing on both sides
 * makes the browser morph it instead. The page's board carries the name
 * statically (board/Board.tsx), and a thumbnail takes it for one moment,
 * when it is tapped to open the document it shows, so the small board
 * on the card grows into the big board on the page. The card is gone
 * with its page once the route changes, so the name never lingers, and
 * a browser without the API ignores the property.
 *
 * Only at tap time, never at rest: a name has to be unique among the
 * elements on screen while a transition captures them, and a shelf shows
 * a dozen boards.
 */
export const SHARED_BOARD = 'board';

export function nameSharedBoard(el: HTMLElement | null): void {
  if (!el) return;
  el.style.viewTransitionName = SHARED_BOARD;
}
