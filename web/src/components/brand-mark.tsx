/**
 * The app's mark: a hexagon outline with one of its six wedges filled.
 * The same drawing as web/public/favicon.svg (which
 * scripts/render-icons.mjs writes from the same paths). Everywhere the
 * mark appears it is bare in the surrounding ink — the sidebar, the lock
 * screen, the home header, the favicon, the splash screens. A ground
 * survives only on the icons an OS composites onto grounds the image
 * cannot see: apple-touch and the desktop installers.
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
