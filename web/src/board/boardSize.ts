/**
 * The one board-width budget, shared by every view that shows the main board
 * (analysis, studies, games, editor) so navigating between them never resizes
 * the board. The height term reserves room for the tallest chrome any of
 * them stacks around the board (the editor's two palettes + toolbar); the
 * rem cap stops the board from starving the side panes on large displays.
 */
export const BOARD_MAX_W =
  // Small screens must leave room for the pane tabs + one pane + the bottom
  // nav (~23rem of chrome); tall phones end up width-bound anyway.
  'max-w-[min(100%,calc(100dvh-23rem))] lg:max-w-[min(100%,calc(100dvh-10rem),48rem)]';
