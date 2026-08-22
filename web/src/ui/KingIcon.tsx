import { cn } from '@/lib/utils';

/**
 * The cburnett king, at text size.
 *
 * Beside a "White to play" line, a swatch (`SideDot`) says which colour
 * and a piece says which GAME — and this page is a column of positions,
 * where the second reads faster than the first.
 *
 * Two departures from the board's own artwork, both forced by the size.
 * The source is drawn on a 45-unit square whose content only occupies
 * the middle ~35 of it, so at 1em the padding would shrink the glyph to
 * noticeably smaller than the text beside it — the viewBox is cropped to
 * the ink. And cburnett's three fine lines across the base are dropped:
 * at 13px they are half a pixel apart and read as a smudge rather than
 * as detail.
 *
 * The fills are the app's own side tokens rather than the artwork's flat
 * #fff/#000, which is what lets a white king stay visible on the light
 * theme and a black one on the dark — the same bargain `SideDot` makes.
 */
export function KingIcon({
  side,
  className,
}: {
  side: 'white' | 'black';
  className?: string;
}) {
  return (
    <svg
      viewBox="5 5 35 35"
      className={cn(
        'inline-block size-[1em] shrink-0 align-[-0.125em]',
        side === 'white'
          ? 'fill-side-white stroke-side-white-line'
          : 'fill-side-black stroke-side-black-line',
        className,
      )}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* The cross, stroked only — it has no interior to fill. */}
      <path d="M22.5 11.63V6M20 8h5" fill="none" strokeLinejoin="miter" />
      {/* The mitre, then the body. */}
      <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" />
      <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z" />
    </svg>
  );
}
