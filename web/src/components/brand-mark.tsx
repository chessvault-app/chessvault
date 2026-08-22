/**
 * The app's mark: a three-by-three lattice of dots with the centre left
 * hollow. The same drawing as web/public/favicon.svg, minus the rounded
 * square — whoever places it supplies the tile, so it sits on the
 * sidebar's primary tile, the lock screen's, and the home header's in
 * whatever colour the theme gives them.
 *
 * It is the BRAND, not "chess": where the app needs to say chess (the
 * notes palette, an archive row, an empty state) it still uses
 * KnightIcon.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="20 20 80 80" className={className} fill="currentColor" aria-hidden>
      <circle cx="35" cy="35" r="9.5" />
      <circle cx="60" cy="35" r="9.5" />
      <circle cx="85" cy="35" r="9.5" />
      <circle cx="35" cy="60" r="9.5" />
      <circle cx="85" cy="60" r="9.5" />
      <circle cx="35" cy="85" r="9.5" />
      <circle cx="60" cy="85" r="9.5" />
      <circle cx="85" cy="85" r="9.5" />
      <circle cx="60" cy="60" r="7.75" fill="none" stroke="currentColor" strokeWidth="3.5" />
    </svg>
  );
}
