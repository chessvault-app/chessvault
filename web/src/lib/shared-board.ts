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

/**
 * Whether a tap has named a thumbnail for the route change about to run.
 *
 * The page's board takes the name only while this is set (board/Board),
 * and the router clears it once the transition has drawn. Without it the
 * page board was named on every phone route change, so a game opened
 * from a games row, which has no thumbnail, still ran the board group's
 * 337ms spring over a snapshot taken before the board's images had
 * loaded: an empty square for half a second where a 150ms cross-fade
 * was owed. Measured on the demo in phone-emulated Chromium: the
 * transition finished 349ms after the tap with the name always on.
 */
let armed = false;
export const sharedBoardArmed = (): boolean => armed;
export function disarmSharedBoard(): void {
  armed = false;
}
export function nameSharedBoard(el: HTMLElement | null): void {
  if (!el) return;
  el.style.viewTransitionName = SHARED_BOARD;
  armed = true;
}
