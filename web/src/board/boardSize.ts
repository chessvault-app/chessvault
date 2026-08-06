/**
 * The one board-width budget, shared by every view that shows the main board
 * (analysis, studies, games, editor) so navigating between them never resizes
 * the board. The height term reserves room for the tallest chrome any of
 * them stacks around the board (the editor's two palettes + toolbar); the
 * rem cap stops the board from starving the side panes on large displays.
 */
export const BOARD_MAX_W =
  // Stacked layouts aim for ZERO page scroll: the board gets what is left
  // after the controls, pane tabs, a minimum pane and the bottom nav
  // (~21rem), which on tall phones means the full width. The 35dvh floor
  // keeps the board usable on squat windows, where the page then scrolls
  // as a fallback. Side-by-side layouts are height-bound; full desktop
  // additionally caps the board so the side panels keep room.
  'max-w-[min(100%,max(35dvh,calc(100dvh-21rem)))] wide:max-w-[min(100%,calc(100dvh-10rem))] lg:max-w-[min(100%,calc(100dvh-10rem),48rem)]';
