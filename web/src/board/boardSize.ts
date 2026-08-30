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
  // The `roomy:` term is the same stacked expression plus 2.25rem, and the
  // 2.25rem is the eval bar's lane: EVAL_BAR_W (w-7) in engine/EvalBar.tsx
  // plus the board row's gap-2. Change the bar's width and change this with
  // it — a lane and an allowance that disagree is a board that moves by the
  // difference.
  //
  // ADDED, not taken. Everywhere else the bar comes out of the board's own
  // width, because the budget is what the board's SURROUNDINGS can spare.
  // `roomy` is the one layout where the column has more than the board can
  // use (a 469px board in a 780px column at 840x838), so the honest sum
  // there is board + bar rather than board − bar. The 100% term still caps
  // it, so a portrait window tall enough to make the board width-bound goes
  // back to paying for the lane out of the board, which is the only thing
  // it can do.
  //
  // What the reader sees: the bar hangs in what was margin, and the board
  // is the same size and in the same place as it was before the engine was
  // switched on. The pair is centred rather than the board, so the board's
  // own middle sits 18px right of the column's — the same offset `wide` has
  // always had, where nobody has ever noticed it.
  'max-w-[min(100%,max(35dvh,calc(100dvh-20rem)),56dvh)] roomy:max-w-[min(100%,calc(min(max(35dvh,calc(100dvh-20rem)),56dvh)+2.25rem))] wide:max-w-[min(100%,max(18rem,var(--board-budget,calc(100dvh-10rem))))] wide:lg:max-w-[min(100%,max(18rem,var(--board-budget,calc(100dvh-10rem)),64rem))]';

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
  // --editor-board-budget: the same idea as wide's --board-budget, for a
  // stacked editor whose region is NOT the viewport — the games hunt's
  // "Set up a position" window, which is min(46rem,94dvh) tall while this
  // default reads 100dvh, so on mid-height windows the board outgrew its
  // window by exactly the 6dvh the card had given up and the shell grew a
  // scrollbar (measured at 1280x720: 624px of content in a 609px shell).
  // The window publishes its own budget (EDITOR_WINDOW_SIZE); every
  // true-stacked page leaves the variable unset and computes what it
  // always did.
  // The same `roomy:` allowance as BOARD_MAX_W, for the same reason: the
  // editor reserves the bar's lane too (it never draws a bar — the
  // reservation is what keeps its board the same board as analysis's), and
  // an upright tablet has the room to give it.
  'max-w-[min(100%,max(35dvh,var(--editor-board-budget,calc(100dvh-19rem))),56dvh)] roomy:max-w-[min(100%,calc(min(max(35dvh,var(--editor-board-budget,calc(100dvh-19rem))),56dvh)+2.25rem))] wide:max-w-[min(100%,max(18rem,calc(100dvh-10rem)))] wide:lg:max-w-[min(100%,max(18rem,calc(100dvh-10rem)),64rem)]';
