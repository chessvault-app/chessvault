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
  'wide:flex-row wide:gap-4 wide:p-4 wide:mx-auto wide:w-full wide:max-w-[76rem]';

/** The side column next to the board: fixed share of the row at `wide`. */
export const BOARD_WIDE_SIDE = 'wide:w-[min(27rem,38%)] wide:flex-none';
