import { cn } from '@/lib/cn';

/**
 * What this panel does, drawn: a board pulling games down from a cloud.
 *
 * The generic globe that was here said "internet" and nothing else — it is
 * the icon on the button beside it, and an empty state that repeats a
 * button's icon at four times the size explains nothing. This one names
 * the actual transaction: games live up there, they come down here.
 *
 * Everything is currentColor at graded opacity, so it takes the theme with
 * it and never has to be redrawn for a palette.
 */
export function CloudBoardArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 76"
      fill="none"
      className={cn('text-subtle', className)}
      aria-hidden
      role="presentation"
    >
      {/* The cloud */}
      <path
        d="M27 27a13 13 0 0 1 25.2-4.4A10.5 10.5 0 0 1 69 26.6 11 11 0 0 1 67.5 48H29a11 11 0 0 1-2-20.9Z"
        fill="currentColor"
        fillOpacity="0.09"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Falling: three dashes on the way down, fading as they approach */}
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M48 52v4" strokeOpacity="0.55" />
        <path d="M40 54v3" strokeOpacity="0.35" />
        <path d="M56 54v3" strokeOpacity="0.35" />
      </g>

      {/* The board, in perspective — a plain square read as a table */}
      <g transform="translate(48 66) skewX(-24) translate(-48 -66)">
        <rect
          x="30"
          y="58"
          width="48"
          height="16"
          rx="2"
          stroke="currentColor"
          strokeOpacity="0.6"
          strokeWidth="2"
        />
        {/* Four lit squares: enough to read as a chequer, few enough to
            stay legible at 5rem. */}
        <g fill="currentColor" fillOpacity="0.22">
          <rect x="30" y="58" width="12" height="8" />
          <rect x="54" y="58" width="12" height="8" />
          <rect x="42" y="66" width="12" height="8" />
          <rect x="66" y="66" width="12" height="8" />
        </g>
      </g>
    </svg>
  );
}
