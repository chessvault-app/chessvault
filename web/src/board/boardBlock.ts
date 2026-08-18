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
/**
 * Which block last spoke for a row.
 *
 * Two of them overlap on every load: the skeleton's board block and the
 * real one. React mounts the replacement before unmounting what it
 * replaces, so the skeleton's cleanup runs LAST and used to remove the
 * variable the real block had just set — leaving the column uncapped with
 * nothing left to re-publish, because a block only re-publishes when it
 * resizes. Cleanup now only clears the row it still owns.
 */
const owner = new WeakMap<HTMLElement, Element>();

export function publishBoardHeight(el: HTMLDivElement | null): (() => void) | void {
  if (!el) return;
  const row = el.closest('.board-row-cap');
  if (!(row instanceof HTMLElement)) return;

  const publish = (): void => {
    // To the BOARD's bottom edge, not the block's. The block also holds the
    // player strips, and the one UNDER the board has no counterpart in the
    // side column — the strip above it is answered by the column's own h-9
    // band, which is why the board and the first panel start on the same
    // line. Measuring the whole block put the panels 34px below the board
    // on a page with players, which is the offness lanph3re saw.
    const top = el.getBoundingClientRect().top;
    const square = el.querySelector('.aspect-square');
    // The DRAWN board, which is not the box it is drawn in: chessground
    // floors the board to a whole number of pixels per square — 704 = 88x8
    // inside a 709 box — and centres what is left over. So the visible edge
    // sits a pixel or three inside its own wrapper, at the top and at the
    // bottom, and a column aligned to the wrapper is aligned to nothing you
    // can see. Published as an inset the column pads itself by, which keeps
    // the number where it is measured rather than hard-coded as a 3.
    const drawn = el.querySelector('cg-container');
    const box = (drawn ?? square ?? el).getBoundingClientRect();
    // Measured against the board's OWN wrapper, not against whichever
    // `.aspect-square` matches first inside the block. The remainder
    // chessground leaves is a pixel or three; a large value here would
    // shove the whole column down the page, so anything absurd is refused
    // rather than trusted.
    const wrap = drawn?.parentElement;
    const raw = drawn && wrap ? Math.abs(box.top - wrap.getBoundingClientRect().top) : 0;
    const inset = raw <= 8 ? raw : 0;
    owner.set(row, el);
    row.style.setProperty('--board-inset', `${Math.round(inset)}px`);
    row.style.setProperty('--board-col-h', `${Math.round(box.bottom - top)}px`);
  };
  publish();

  const observer = new ResizeObserver(publish);
  observer.observe(el);

  /**
   * And on the drawn board itself, once chessground has made it.
   *
   * Observing the block alone was not enough and failed in a way that hid:
   * cg-container does not exist at first publish, so the measurement fell
   * back to the block — 28px taller, being the player strip — and the
   * block's own size, which comes from CSS, never changes again, so the
   * observer never fired a second time and the wrong number stood. A hard
   * reload happened to be slow enough that the board existed by the first
   * measurement, which is why it looked fine exactly when you bypassed the
   * cache and broken every other time.
   *
   * The mutation watch stops as soon as it has found the board: from then
   * on the ResizeObserver sees every size change, and leaving it running
   * would call publish on every piece that moves.
   */
  let drawn: Element | null = null;
  const watchDrawn = (): void => {
    const found = el.querySelector('cg-container');
    if (found && found !== drawn) {
      drawn = found;
      observer.observe(found);
      publish();
    }
  };
  watchDrawn();
  const mutations = new MutationObserver(() => {
    watchDrawn();
    if (drawn) mutations.disconnect();
  });
  if (!drawn) mutations.observe(el, { childList: true, subtree: true });

  return () => {
    mutations.disconnect();
    observer.disconnect();
    // Left set, the last board's height would cap the next page's column
    // before its own block has had a chance to measure — but only clear it
    // if this block is still the one that set it. See `owner`.
    if (owner.get(row) !== el) return;
    owner.delete(row);
    row.style.removeProperty('--board-col-h');
    row.style.removeProperty('--board-inset');
  };
}
