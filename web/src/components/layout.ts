/**
 * A page belongs to one of three families. The family is a statement
 * about what the page IS; the width tiers inside `PageShell` are a
 * statement about content, and only the first family has them — which is
 * why a canvas page could not be expressed as a fourth width and had to
 * become a shell of its own.
 *
 * 1. **Scrolling column** — `components/page-shell`, on one of three named widths.
 *    Games, studies, notes, shelves, dashboards, settings.
 * 2. **Board** — the constants below: fits the viewport instead of
 *    scrolling, board beside a side column at `wide`. Analysis, study and
 *    game viewers, trainers, repertoire, editor.
 * 3. **Canvas** — `components/canvas-shell`: one edge-to-edge surface with its
 *    chrome floating on top. The opening map.
 *
 * A page that fits none of the three is a fourth family to be named here,
 * not markup to be written inline — that is how the map spent its first
 * release off-template.
 */

/**
 * The board-family page shell: a column that fits the viewport when
 * stacked and becomes a centered board + side-column row at `wide`.
 * Every board page (analysis, study, trainers, repertoire, editor)
 * appends these to its own stacked-mode classes, so the wide-mode
 * geometry can only be changed in one place.
 *
 * Both strings must stay complete literals — the Tailwind scanner
 * reads them from this file, and classes assembled from fragments
 * would never be emitted.
 */
export const BOARD_WIDE_SHELL =
  // 76rem is the reading width, and it was also the ceiling: the row
  // stopped there, so the board stopped at the 736px left over after the
  // side column however much glass was going spare — a 27" monitor drew a
  // 13" laptop's board.
  //
  // One expression rather than a 2xl: override, because the override lost.
  // `wide` is a custom variant and its rules are emitted after the core
  // breakpoints, so at 1920 both matched and the LATER one won — the cap
  // stayed 76rem and the change did nothing. min/max inside the value
  // cannot be out-ordered: below about 1350px it is the 76rem it always
  // was, above that it follows the window to a 96rem ceiling. The side
  // column keeps its fixed share (BOARD_WIDE_SIDE), so the extra is the
  // board's.
  //
  // The third term is the one that keeps the board and the panels TOUCHING.
  // "The extra is the board's" was only true while the board was
  // width-bound; its own cap is also `100dvh-10rem`, so on a wide, short
  // window it cannot spend the extra — and the board column centres what
  // it holds, so the surplus split either side and half of it landed
  // BETWEEN the board and the side column. Measured at 1920x945: row
  // 1536, board 785, 135px of nothing on each side of it.
  //
  // So the row is also capped at what the board can actually use plus the
  // column beside it: 27rem of side, 1rem of gap, 2rem of padding. Now a
  // height-bound board makes the row shrink to fit it and the leftover
  // falls OUTSIDE the pair, where mx-auto centres it as margin.
  //
  // The row's own cap lives in index.css as `.board-row-cap`: it needs the
  // side column's width, and a rule that has to agree with another file is
  // better written where the number is than repeated as a constant here.
  //
  // `wide:overflow-y-auto` is the fallback BOARD_MAX_W has always said it
  // had and never got. The board keeps an 18rem floor so a short-landscape
  // viewport does not collapse it to nothing, and the note there ends "the
  // page scrolls" — but nothing in `wide` scrolled: the shell is `h-full`
  // with an overflow rule only under `stacked:`, and `main` is
  // overflow-hidden, so the floor's overflow was simply cut. Measured at
  // 740x360: the board page wanted 364px in 303px and lost 61 of them, the
  // editor 71, the repertoire 59, both trainers 35. It costs nothing where
  // the row fits, which is every window that was not already losing pixels.
  'wide:flex-row wide:gap-4 wide:p-4 wide:mx-auto wide:w-full wide:overflow-y-auto board-row-cap';

/**
 * The board's own column in that row.
 *
 * `flex-1` for the width and `justify-start` for the height — the board sits
 * at the same y in every view, whatever each stacks below it — and
 * `board-col-cap` (index.css) is the ceiling: the column takes what the
 * board can actually use and no more.
 *
 * That ceiling is why the gap beside the board is a gap and not a slider.
 * A flex-1 column collects every pixel the row has spare, and `items-center`
 * then splits it either side of the board — so half of it sat between the
 * board and the panels and MOVED as the window was resized, because the
 * surplus is a function of the height the row's cap is computed from.
 * Measured on the board page at 1920 wide: 16px of gap at a 945px-tall
 * window, 27px at 800, 44px at 700, 65px at 600.
 *
 * One literal, and not seven: this string was pasted into every board page
 * and the skeleton, which is how the trainers and the analysis board would
 * come to disagree about it.
 *
 * The above-centre placement `justify-start` produces is deliberate, not a
 * by-product to be corrected to true centring. The perceived middle of a
 * frame sits ABOVE its geometric middle (the vertical-bisection illusion;
 * "optical centre" in typography and framing, roughly 3–7% of the frame
 * height up), so a truly centred board would read as sagging. Measured on
 * the board page at 1600x900: the board block spans y 16–816, its centre
 * 3.8% of the viewport above geometric centre — inside that band. Tall
 * windows overshoot it (8.3% at 1600x1200, where the 64rem board cap bites
 * and the slack accrues below), and that is the accepted cost: proportional
 * centring would fix the rare tall window by breaking the same-y invariant
 * everywhere else.
 */
export const BOARD_WIDE_COLUMN =
  'flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start board-col-cap';

/** The side column next to the board: fixed share of the row at `wide`. */
export const BOARD_WIDE_SIDE =
  'wide:w-[min(var(--board-side),38%)] wide:flex-none board-side-cap';

/**
 * The whole shell — stacked and wide halves — for the board pages whose
 * COLUMN scrolls when stacked: the solution recorder, the repertoire and
 * the editor. One string, because these shells were pasted literals and
 * drifted exactly as pasted literals do.
 *
 * The bottom padding — this column is what scrolls on a phone, and its
 * last panel used to end flush against the bottom navigation with its own
 * border cut off. Padding inside the scroll area gives it somewhere to
 * finish. It is the shell's own p-3 and no more: pb-8 was 32px, and what
 * a scrolled-to-the-end column looked like was a panel floating a third
 * of an inch above the navigation with page behind it. The panels that
 * hold still (BOARD_HELD_SHELL) end 12px above the bar, so these do too.
 * pr-4 and the stable gutter are the same idea sideways: the
 * scrollbar is drawn OUTSIDE the padding (measured: 12px of padding,
 * then a 10px scrollbar), so p-3 alone left the panels almost touching
 * the thumb while the whole column sat 10px left of centre.
 *
 * Both are FINE-POINTER allowances, and scoped so (the same judgment
 * as PageShell's gutter): the styled classic scrollbar they make room
 * for only exists where index.css styles one, which is pointer: fine.
 * A phone's overlay scrollbar draws over content and reserves nothing,
 * so on coarse pointers the pair only made the right edge 16px against
 * the left's 12 — the gutter asymmetry lanph3re flagged on the margins
 * pass.
 *
 * The pages whose panels own their scrolling take BOARD_HELD_SHELL
 * instead — see below. The gutter earns nothing there: it reserves a lane
 * for a scrollbar that cannot appear.
 */
export const BOARD_SCROLL_SHELL =
  'flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto stacked:pointer-fine:pr-4 stacked:pointer-fine:[scrollbar-gutter:stable_both-edges] ' +
  BOARD_WIDE_SHELL;

/**
 * The same shell for the board pages that do NOT scroll when stacked:
 * analysis, study and both puzzle trainers. Their side column is a
 * `min-h-0 flex-1` box with its own `overflow-y-auto`, so the shell around
 * it fits the screen exactly and does not scroll — on any window where the
 * column can be squeezed as far as it needs to go.
 *
 * `stacked:overflow-y-auto` is for the windows where it cannot. The column
 * now keeps a floor (AnalysisView, StudyView), because a column squeezed
 * without one stopped being a pane: measured at 667x375, a phone in
 * landscape narrow enough to stay stacked, the board page's column was 54px
 * and the moves panel inside it 18px around 40px of content. A floor is
 * only worth stating if something gives when it binds, and the shell is
 * what gives. It stays `hidden` in effect wherever the column fits, since
 * `auto` draws nothing until there is something to scroll.
 *
 * Which is why it still takes none of BOARD_SCROLL_SHELL's allowances. A
 * phone ends flush against the bottom bar here BY DESIGN: the column has
 * already given the last panel a hard bottom edge to sit on, and 32px of
 * padding for a panel border that is not being cut is 32px of dead page
 * between the panel and the navigation you are reaching past it for. `pr-4`
 * and the stable gutter go with it — reserving a lane for a scrollbar that
 * is drawn on the rare window that overflows only pushed the column 4px
 * off centre on every window that does not.
 *
 * Analysis and study wrote this string out by hand, twice, which is the
 * drift BOARD_SCROLL_SHELL exists to prevent; the trainers moving here
 * made it a fourth copy, so it is a constant like its sibling.
 */
export const BOARD_HELD_SHELL =
  'flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto ' + BOARD_WIDE_SHELL;

/**
 * One fixed size for the editor window's whole page CHAIN — board,
 * Position, Load, picture. The design was settled by iteration
 * (lanph3re, 2026-08-29): the pages are CONTENT of one window, and a
 * frame that never moves is what makes each page turn read as the
 * window changing its mind rather than windows trading places — every
 * window-swap variant tried before it (parking, floating, same-rect
 * sibling windows) cost a visible frame somewhere. Desktop only
 * (sm:) — the phone sheets keep their own physics. The height term
 * also feeds the board's size: at 46rem the board runs to the card's
 * 28rem inner width; on shorter viewports both the card (94dvh) and
 * the board's own dvh formula shrink in step.
 */
export const EDITOR_WINDOW_SIZE = 'sm:h-[min(46rem,94dvh)] sm:w-[min(30rem,94vw)] sm:max-w-none';
