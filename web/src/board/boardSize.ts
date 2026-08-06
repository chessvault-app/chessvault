/**
 * The one board-width budget, shared by every view that shows the main board
 * (analysis, studies, games, editor) so navigating between them never resizes
 * the board. The height term reserves room for the tallest chrome any of
 * them stacks around the board (the editor's two palettes + toolbar); the
 * rem cap stops the board from starving the side panes on large displays.
 */
export const BOARD_MAX_W =
  // Stacked layouts scroll (like the lichess app): the board takes the full
  // width and the pane below extends past the fold, so the only mobile cap
  // is a sanity limit for squat windows. Desktop must fit without scrolling.
  'max-w-[min(100%,calc(100dvh-8rem))] lg:max-w-[min(100%,calc(100dvh-10rem),48rem)]';
