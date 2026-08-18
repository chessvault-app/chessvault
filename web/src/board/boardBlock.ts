/**
 * Publish the board block's height to the row it sits in, so the column
 * beside it can stop where the board stops.
 *
 * The two columns are the same height already — they are flex items of a
 * stretched row — but the board's CONTENT is shorter than the column it is
 * centred in, so the panels ran on past the bottom of the board. Two
 * reasons, both by design: the eval bar shares the board's width box, and
 * `100dvh - 10rem` reserves for the tallest chrome any board page stacks
 * (the editor's palettes), which every other page then over-reserves.
 *
 * Measured rather than computed. The height is the end of a chain of
 * min/max in boardSize.ts that no sibling selector can read, and the strips
 * above and below the board differ per page — so the alternative is a copy
 * of that arithmetic at every call site, each free to rot on its own.
 *
 * To the board's BOX, and not to the board chessground draws inside it.
 * The drawn board is floored to a whole number of pixels per square — 704
 * = 88x8 inside a 709 box — and the remainder is centred, so its visible
 * edge sits a pixel or three inside the box and the panels are that far
 * out. Aligning to the visible edge was tried and reverted (lanph3re's
 * call): it needed a second variable for the column to shift itself down
 * by, and a variable that measured wrong for ANY reason moved the whole
 * column instead of three pixels of it — which is precisely what went
 * wrong, twice. `.aspect-square` is a box this file owns, it cannot be
 * confused with anything else, and it exists from the first render, so
 * nothing has to wait for chessground to appear either.
 *
 * A callback ref rather than a hook: the board block is rendered inside
 * conditionals (a trainer swaps it for the analysis board), and a hook
 * called from there would be a hook called conditionally. React 19 runs the
 * returned function as the cleanup.
 */

/**
 * Which block last spoke for a row.
 *
 * Two of them overlap on every load: the skeleton's board block and the
 * real one. React mounts a replacement before unmounting what it replaces,
 * so the skeleton's cleanup runs LAST and used to remove the variable the
 * real block had just set — leaving the column uncapped with nothing left
 * to re-publish, because a block only publishes when it resizes. Cleanup
 * clears a row only if this block still owns it.
 */
const owner = new WeakMap<HTMLElement, Element>();

export function publishBoardHeight(el: HTMLDivElement | null): (() => void) | void {
  if (!el) return;
  const row = el.closest('.board-row-cap');
  if (!(row instanceof HTMLElement)) return;

  const publish = (): void => {
    // The board's bottom edge, not the block's: the block also holds the
    // player strips, and the one UNDER the board has no counterpart in the
    // side column — the strip above it is answered by the column's own h-9
    // band, which is why the board and the first panel start on one line.
    // Measuring the whole block put the panels 34px low on a page with
    // players.
    const box = el.querySelector('.aspect-square') ?? el;
    const height = box.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
    owner.set(row, el);
    row.style.setProperty('--board-col-h', `${Math.round(height)}px`);
  };
  publish();

  const observer = new ResizeObserver(publish);
  observer.observe(el);
  return () => {
    observer.disconnect();
    // Left set, the last board's height would cap the next page's column
    // before its own block has had a chance to measure — but only clear it
    // if this block is still the one that set it. See `owner`.
    if (owner.get(row) !== el) return;
    owner.delete(row);
    row.style.removeProperty('--board-col-h');
  };
}
