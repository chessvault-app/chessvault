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
  // The 56dvh cap bites only on tall-AND-wide stacked viewports (tablet
  // portrait): an iPad mini otherwise gave the board its full 744px width
  // and left the moves panel a sliver — a smaller board that leaves the
  // panels readable is the better trade there (lanph3re's call). Phones
  // are width-bound long before 56dvh, so they are untouched.
  // The wide-mode height budget reads --board-budget with the old
  // expression as its default: every full-viewport board page leaves the
  // variable unset and computes exactly what it always did, while a page
  // whose board region is NOT the viewport (the workspace, whose games
  // band takes the bottom of the window) publishes the height its region
  // actually has. `.board-col-cap` (index.css) reads the same variable so
  // the column keeps agreeing with the board it holds.
  'max-w-[min(100%,max(35dvh,calc(100dvh-20rem)),56dvh)] wide:max-w-[min(100%,max(18rem,var(--board-budget,calc(100dvh-10rem))))] wide:lg:max-w-[min(100%,max(18rem,var(--board-budget,calc(100dvh-10rem)),64rem))]';

// (The lg: ceiling rides on wide: — a bare lg: is the viewport's word, and
// inside a `.force-stacked` region of a wide page it sized the editor's
// board for the whole screen while its palettes laid out phone-style.)
export const EDITOR_BOARD_MAX_W =
  // The stacked editor has no pane below — just palettes, the toolbar and
  // the nav — so its board can run essentially full-width on phones.
  // 19rem: the measured chrome (two palettes, toolbar, gaps, page padding,
  // nav + iOS safe-area) sits just under 16rem, and a reserve at exactly
  // that line made phones overflow by a few px — a sliver of scroll and a
  // toolbar flush against the nav. The rest is breathing room (rio-tuned
  // on an iPad mini). Tall phones stay width-bound, so it costs them
  // nothing.
  'max-w-[min(100%,max(35dvh,calc(100dvh-19rem)),56dvh)] wide:max-w-[min(100%,max(18rem,calc(100dvh-10rem)))] wide:lg:max-w-[min(100%,max(18rem,calc(100dvh-10rem)),64rem)]';
