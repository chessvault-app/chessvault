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
    /**
     * Ceiled to the layout engine's own 1/64 px grid, not published raw.
     *
     * Chromium snaps used lengths to 1/64 px, DOWNWARD — so a box of
     * k x (8/dpr) came out a hair under it wherever 8/dpr is not exact in
     * 64ths (every fractional zoom), chessground's floor(w * dpr / 8)
     * dropped to k-1, and the "no remainder to leave" promise above broke
     * by a WHOLE square: at 110% zoom, 83 of 91 board widths left a
     * 7.27px remainder, and the side column started 3.65px above the
     * board's visible edge (lanph3re's report — per-origin zoom is why
     * one origin showed it and another did not). Ceiling to 1/64 makes
     * k x quantum exactly representable, so the snap cannot round it
     * below k squares; what chessground now leaves is the ceiling's own
     * excess, at most 1.25 CSS px across dprs 1-3 (simulated over k
     * 30-120) and exactly 0 at 1x and 2x, where 8/dpr was already exact.
     */
    const quantum = Math.ceil((8 / dpr) * 64) / 64;
    document.documentElement.style.setProperty('--cg-quantum', `${quantum}px`);
    window
      .matchMedia(`(resolution: ${dpr}dppx)`)
      .addEventListener('change', publish, { once: true });
  };
  publish();
}
