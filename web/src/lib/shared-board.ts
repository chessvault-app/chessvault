/**
 * The board that flies.
 *
 * A phone's route change runs inside a View Transition (lib/router). By
 * default the two pages cross-fade; naming the same thing on both sides
 * makes the browser morph it instead. The page's board carries the name
 * statically (board/Board.tsx), and a thumbnail takes it for one moment,
 * when it is tapped to open the document it shows, so the small board
 * on the card grows into the big board on the page. A browser without
 * the API ignores the property.
 *
 * Only at tap time, never at rest: a name has to be unique among the
 * elements on screen while a transition captures them, and a shelf shows
 * a dozen boards. The tapped card KEEPS the name afterwards, for the
 * flight back (armReturnFlight), since its shelf stays mounted under the
 * document (lib/keep-alive); so the next tap takes it off whichever card
 * had it. It did not, and the second document opened from a shelf left
 * two cards named: the browser skips a transition whose snapshot holds a
 * name twice ("Multiple elements found with view-transition-name: board"
 * in WebKit), so that push and every turn on that shelf after it was a
 * cut. Seen on an iPhone, Studies into a study, 2026-09-18.
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
/** Every element carrying the name inline, hidden pages' included. */
const namedBoards = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')].filter(
    (el) => el.style.viewTransitionName === SHARED_BOARD,
  );
export function nameSharedBoard(el: HTMLElement | null): void {
  if (!el) return;
  for (const other of namedBoards()) if (other !== el && other !== pageBoard) other.style.viewTransitionName = '';
  el.style.viewTransitionName = SHARED_BOARD;
  armed = true;
}

/**
 * The page's board, registered by board/Board while it is mounted, for the
 * flight BACK: a pop from a document to the shelf it was opened from.
 *
 * The thumbnail that was tapped keeps its name (the shelf stays mounted
 * under the document, lib/keep-alive), so the return needs only the
 * page's board named at the moment the old page is photographed. Named
 * here, imperatively and only when such a thumbnail exists, because the
 * name has to be in the DOM before the transition starts and the board
 * does not re-render on a route change; and never when no thumbnail
 * waits, or the board's group would fly its 337ms to nowhere, the
 * problem `armed` was made to stop.
 */
let pageBoard: HTMLElement | null = null;
export function registerPageBoard(el: HTMLElement | null): void {
  pageBoard = el;
}
export function armReturnFlight(): void {
  if (!pageBoard) return;
  const thumbnails = namedBoards().filter((el) => el !== pageBoard);
  if (thumbnails.length !== 1) return;
  pageBoard.style.viewTransitionName = SHARED_BOARD;
  armed = true;
}
