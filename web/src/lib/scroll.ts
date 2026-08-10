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
 */
export function scrollRowIntoPanel(panel: HTMLElement | null, row: HTMLElement | null): void {
  if (!panel || !row) return;
  const top = row.offsetTop - panel.offsetTop;
  const bottom = top + row.offsetHeight;
  const view = panel.clientHeight;
  // A margin below the row, so whatever is written under it comes too.
  const margin = Math.min(96, view / 3);
  if (top >= panel.scrollTop && bottom + margin <= panel.scrollTop + view) return;
  panel.scrollTop = Math.max(0, top - (view - row.offsetHeight - margin) / 2);
}
