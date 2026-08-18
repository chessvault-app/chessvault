/**
 * Publish the board block's height to the row it sits in, so the column
 * beside it can stop where the board stops.
 *
 * The two columns are the same height already — they are flex items of a
 * stretched row — but the board's CONTENT is shorter than the column it is
 * centred in, so the panels ran on past the bottom of the board by 68px on
 * a 889px-tall window. Two reasons, both by design and neither a bug: the
 * eval bar shares the board's width box, and `100dvh - 10rem` reserves for
 * the tallest chrome any board page stacks (the editor's palettes), which
 * every other page then over-reserves.
 *
 * Measured rather than computed. The height is the end of a chain of
 * min/max in boardSize.ts that no sibling selector can read, and the strips
 * above and below the board differ per page — so the alternative is a copy
 * of that arithmetic at each of the six call sites, each free to rot on its
 * own. One observer states the number instead.
 *
 * A callback ref rather than a hook: the board block is rendered inside
 * conditionals (a trainer swaps it for the analysis board), and a hook
 * called from there would be a hook called conditionally. React 19 runs the
 * returned function as the cleanup.
 */
export function publishBoardHeight(el: HTMLDivElement | null): (() => void) | void {
  if (!el) return;
  const row = el.closest('.board-row-cap');
  if (!(row instanceof HTMLElement)) return;

  const publish = (): void => {
    row.style.setProperty('--board-col-h', `${Math.round(el.getBoundingClientRect().height)}px`);
  };
  publish();

  const observer = new ResizeObserver(publish);
  observer.observe(el);
  return () => {
    observer.disconnect();
    // Left set, the last board's height would cap the next page's column
    // before its own block has had a chance to measure.
    row.style.removeProperty('--board-col-h');
  };
}
