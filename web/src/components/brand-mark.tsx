/**
 * The app's mark: a knight's head as one open line, ear to base. Straight
 * where a horse has bone (the forehead, the ear, the two mane steps, the
 * muzzle) and curved where it has muscle (the throat, the neck). The same
 * drawing as the line in scripts/render-icons.mjs, which also carries the
 * solid cut of it that the favicon and the .ico use, since a 7-unit line
 * is 1.4 px at 16 px and vanishes in a tab strip. Everywhere the mark
 * appears in the app it is bare in the surrounding ink — the sidebar, the
 * lock screen, the home header, the splash screens. A ground survives only
 * on the icons an OS composites onto grounds the image cannot see:
 * apple-touch and the desktop installers.
 *
 * It is the BRAND, and it is also a knight, which the previous hexagon
 * was chosen not to be. Where the app means "chess" rather than itself
 * (the notes palette, an archive row, an empty state) it still uses
 * KnightIcon, the cburnett piece; the two are different enough in
 * construction that they do not read as one thing.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} fill="none" aria-hidden>
      <path
        d="M22 66 C24 61 27 57 29 54 L19 45 L11 39 L19 29 L33 11 L39 19 L45 15 L52 23 L61 33 C64 41 65 53 64 66"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
