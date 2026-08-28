/**
 * The app's mark: a hexagon outline with one of its six wedges filled.
 * The same drawing as web/public/favicon.svg, minus the rounded square.
 * In the app it renders bare, in currentColor — the sidebar, the lock
 * screen and the home header all set it in the surrounding text's ink.
 * The rounded-square tile survives only where an icon needs its own
 * ground: the favicon, the OS icons, the splash screens.
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
