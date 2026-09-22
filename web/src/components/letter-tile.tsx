import { cn } from '@/lib/utils';

/**
 * The thumbnail a card wears when it has no picture of its own: the
 * name's first letter on a tinted square, the shape GitHub gives an
 * organisation and Google Drive a folder. A shelf of notes with no
 * boards was a column of identical grey glyphs, and two notes could only
 * be told apart by reading both names (lanph3re, 2026-09-18).
 *
 * The tint is the name's own: a hash picks the hue, so a note keeps its
 * colour across visits and devices with nothing stored, and two names
 * rarely share one. The hue is mixed INTO the theme's card and text
 * colours rather than painted flat, so the tile is a pale wash on a
 * light page and a deep one on a dark page, from the same two rules.
 * The same 64px box and radius as the mini board it stands in for, so a
 * shelf with both stays level.
 */
export function LetterTile({ name, size = 64, className }: { name: string; size?: number; className?: string }) {
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <div
      aria-hidden
      style={{ width: size, height: size, '--tile': `oklch(var(--tile-l) var(--tile-c) ${hueOf(name)})` } as React.CSSProperties}
      className={cn(
        'grid shrink-0 select-none place-items-center overflow-hidden rounded-md font-semibold',
        'bg-[color-mix(in_oklch,var(--tile)_22%,var(--card))] text-[color-mix(in_oklch,var(--tile)_65%,var(--foreground))]',
        className,
      )}
    >
      <span style={{ fontSize: size * 0.4, lineHeight: 1 }}>{letter}</span>
    </div>
  );
}

/** A stable hue for a name: FNV-1a over its code points, onto the wheel. */
function hueOf(name: string): number {
  let h = 2166136261;
  for (const ch of name) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}
