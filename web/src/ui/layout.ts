/**
 * A page belongs to one of three families. The family is a statement
 * about what the page IS; the width tiers inside `PageShell` are a
 * statement about content, and only the first family has them — which is
 * why a canvas page could not be expressed as a fourth width and had to
 * become a shell of its own.
 *
 * 1. **Scrolling column** — `ui/PageShell`, on one of three named widths.
 *    Games, studies, notes, shelves, dashboards, settings.
 * 2. **Board** — the constants below: fits the viewport instead of
 *    scrolling, board beside a side column at `wide`. Analysis, study and
 *    game viewers, trainers, repertoire, editor.
 * 3. **Canvas** — `ui/CanvasShell`: one edge-to-edge surface with its
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
  'wide:flex-row wide:gap-4 wide:p-4 wide:mx-auto wide:w-full wide:max-w-[min(96rem,max(76rem,90vw))]';

/** The side column next to the board: fixed share of the row at `wide`. */
export const BOARD_WIDE_SIDE = 'wide:w-[min(27rem,38%)] wide:flex-none';

/**
 * The whole shell — stacked and wide halves — for the board pages whose
 * COLUMN scrolls when stacked: the trainers, the solution recorder, the
 * repertoire and the editor. One string, because these six shells were
 * six pasted literals and drifted exactly as pasted literals do.
 *
 * stacked:pb-8 — this column is what scrolls on a phone, and its last
 * panel used to end flush against the bottom navigation with its own
 * border cut off. Padding inside the scroll area gives it somewhere to
 * finish. pr-4 and the stable gutter are the same idea sideways: the
 * scrollbar is drawn OUTSIDE the padding (measured: 12px of padding,
 * then a 10px scrollbar), so p-3 alone left the panels almost touching
 * the thumb while the whole column sat 10px left of centre.
 *
 * Analysis and study deliberately do NOT use this: stacked, they are
 * overflow-hidden columns whose panels own the scrolling, so flush
 * against the bottom bar is their design — they append BOARD_WIDE_SHELL
 * to stacked classes of their own.
 */
export const BOARD_SCROLL_SHELL =
  'flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto stacked:pb-8 stacked:pr-4 stacked:[scrollbar-gutter:stable_both-edges] ' +
  BOARD_WIDE_SHELL;
