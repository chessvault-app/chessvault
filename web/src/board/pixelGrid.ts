/**
 * One square's worth of device pixels, in CSS pixels, published as
 * `--cg-quantum` for the board box to round itself down to (`.board-box`
 * in index.css).
 *
 * Chessground sizes the board it draws as
 * `floor(width * dpr / 8) * 8 / dpr` (its render.ts, updateBounds) so that
 * every square is a whole number of device pixels and the squares come out
 * crisp. The remainder — up to 8 device pixels — is left over inside the
 * box we gave it, and our own CSS centres it. A box that is already a whole
 * number of squares wide has no remainder to leave, so the box and the
 * board you can see become the same rectangle, which is what the side
 * column needs: it measures the box.
 *
 * 8 / dpr rather than a flat 8px because the grid is in DEVICE pixels: at
 * 150% zoom, 8 CSS px is 12 device px, and rounding to that still leaves
 * chessground half a square to floor. The fallback in the CSS is 8px,
 * which is exact at 1x and 2x.
 *
 * A resolution query matches one dpr and one only, so there is no lasting
 * "the ratio changed" event to subscribe to: each listener fires once, when
 * the ratio it was created for stops being the ratio, and arms the next.
 * That covers browser zoom and a window dragged to a second monitor.
 */
export function startPixelGridTracking(): void {
  const publish = (): void => {
    const dpr = window.devicePixelRatio || 1;
    document.documentElement.style.setProperty('--cg-quantum', `${8 / dpr}px`);
    window
      .matchMedia(`(resolution: ${dpr}dppx)`)
      .addEventListener('change', publish, { once: true });
  };
  publish();
}
