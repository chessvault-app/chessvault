/**
 * One polite live region for the whole app.
 *
 * The moments of feedback here are visual: a verdict fades in over the
 * board, a toast rises from the corner, and a screen reader hears none
 * of it. Views call announce() at those moments; the region is created
 * once, on first use, and reused.
 *
 * Visually hidden the accessible way — display:none silences a live
 * region outright, so it is clipped instead.
 */

let region: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (!region || !region.isConnected) {
    region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    Object.assign(region.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      margin: '-1px',
      border: '0',
      padding: '0',
      clipPath: 'inset(50%)',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(region);
  }
  return region;
}

/** Say `text` to assistive tech without interrupting what it is reading. */
export function announce(text: string): void {
  const el = ensure();
  // Clearing first makes a repeat of the same text (two wrong tries in a
  // row) count as a change — an unchanged live region says nothing.
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = text;
  }, 30);
}
