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
  // The 18rem wide/lg floor: on short-landscape viewports (a phone held
  // sideways) the height term collapses — measured 48px at a 209px-high
  // viewport — so the board keeps a usable minimum and the page scrolls.
  'max-w-[min(100%,max(35dvh,calc(100dvh-20rem)))] wide:max-w-[min(100%,max(18rem,calc(100dvh-10rem)))] lg:max-w-[min(100%,max(18rem,calc(100dvh-10rem)),48rem)]';

export const EDITOR_BOARD_MAX_W =
  // The stacked editor has no pane below — just palettes, the toolbar and
  // the nav — so its board can run essentially full-width on phones.
  // 18rem: the measured chrome (two palettes, toolbar, gaps, page padding,
  // nav + iOS safe-area) sits just under 16rem, and a reserve at exactly
  // that line made phones overflow by a few px — a sliver of scroll and a
  // toolbar flush against the nav. Tall phones stay width-bound, so the
  // extra 2rem costs them nothing.
  'max-w-[min(100%,max(35dvh,calc(100dvh-18rem)))] wide:max-w-[min(100%,max(18rem,calc(100dvh-10rem)))] lg:max-w-[min(100%,max(18rem,calc(100dvh-10rem)),48rem)]';
