import { prefersReducedMotion } from './motion';

/**
 * Scroll a panel so its active row is comfortably visible — WITHOUT ever
 * scrolling the page.
 *
 * Two problems with scrollIntoView here. It walks up to every scrollable
 * ancestor, including the document, so in a mobile browser the first move
 * of a puzzle scrolled the whole page and clipped the top of the panel.
 * And `block: 'nearest'` stops the moment the row's own box is in view,
 * which leaves the annotation printed underneath it still cut off — the
 * comment is the reason you are looking.
 *
 * The row's place is measured with bounding rects, not `offsetTop`.
 * `offsetTop` is relative to the nearest POSITIONED ancestor, and the
 * sideline rows are `relative` (their branch guides are pseudo-elements
 * hung on them), so a move inside one reported a few pixels instead of
 * its place in the list — and every step into a sideline scrolled the
 * panel back to the top (lanph3re's report). Rects are relative to the
 * viewport for both boxes, so the difference is the row's place in the
 * panel whatever sits between them.
 */
export function scrollRowIntoPanel(panel: HTMLElement | null, row: HTMLElement | null): void {
  if (!panel || !row) return;
  const top =
    row.getBoundingClientRect().top -
    panel.getBoundingClientRect().top -
    panel.clientTop +
    panel.scrollTop;
  const bottom = top + row.offsetHeight;
  const view = panel.clientHeight;
  // A margin below the row, so whatever is written under it comes too.
  const margin = Math.min(96, view / 3);
  if (top >= panel.scrollTop && bottom + margin <= panel.scrollTop + view) return;
  panel.scrollTop = Math.max(0, top - (view - row.offsetHeight - margin) / 2);
}

/**
 * The nearest ancestor that scrolls vertically, whether or not it has
 * anything to scroll yet.
 *
 * Distinct from keyboardInset's scrollerOf, which wants the box a caret
 * can be scrolled INTO and so skips one that fits its content. A header
 * that watches its page's scroller has to find it before the list has
 * loaded, or a page that arrives empty and fills a moment later is a page
 * whose header never compacts.
 */
export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/**
 * Back to the top of the open page, for a tap on the tab that is already
 * current.
 *
 * `main` never scrolls; each page owns its own scroller (PageShell's
 * column, the home grid, a launcher), so the one to reset is whichever
 * box under `main` has actually moved — the outermost first, which is
 * document order. The bar's own `navigate()` is a no-op on the same
 * hash, which is what made a second tap dead: on every platform tab bar
 * the second tap means "take me back to the top of this".
 */
export function scrollPageToTop(): void {
  const main = document.getElementById('main');
  if (!main) return;
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  for (const el of main.querySelectorAll<HTMLElement>('*')) {
    if (el.scrollTop > 0) {
      el.scrollTo({ top: 0, behavior });
      return;
    }
  }
}
