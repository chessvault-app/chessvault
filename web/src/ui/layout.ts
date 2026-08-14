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
