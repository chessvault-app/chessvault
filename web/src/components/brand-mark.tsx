/**
 * The app's mark: a hexagon outline with one of its six wedges filled.
 * The same drawing as web/public/favicon.svg, minus the rounded square —
 * whoever places it supplies the tile, so it sits on the sidebar's
 * primary tile, the lock screen's, and the home header's in whatever
 * colour the theme gives them.
 *
 * It is the BRAND, not "chess": where the app needs to say chess (the
 * notes palette, an archive row, an empty state) it still uses
 * KnightIcon.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="20 20 80 80" className={className} fill="currentColor" aria-hidden>
      <path
        d="M60 24 L91 42 V78 L60 96 L29 78 V42 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path d="M60 60 L60 24 L91 42 Z" />
    </svg>
  );
}
