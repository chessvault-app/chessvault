import { cn } from '@/lib/cn';

/**
 * A tag, in a colour it keeps.
 *
 * The hue comes from the tag's own letters, so "endgame" is the same green
 * everywhere it appears and two tags on one card are almost never the same
 * colour — without anybody having to configure a palette, and without the
 * app having an opinion about which words a user is allowed to tag with.
 *
 * Muted on purpose: a shelf of cards each wearing three saturated badges
 * is a shelf you cannot read. These sit at the lightness of body text with
 * a tinted background, so they register as a group and recede as content.
 */
function hue(tag: string): number {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

export function TagPill({ tag, className }: { tag: string; className?: string }) {
  const h = hue(tag);
  return (
    <span
      className={cn(
        'inline-flex max-w-[8rem] shrink-0 items-center truncate rounded-full px-1.5 py-px',
        'text-[0.625rem] font-medium leading-4',
        className,
      )}
      style={{
        color: `oklch(78% 0.09 ${h})`,
        backgroundColor: `oklch(78% 0.09 ${h} / 14%)`,
      }}
    >
      {tag}
    </span>
  );
}
