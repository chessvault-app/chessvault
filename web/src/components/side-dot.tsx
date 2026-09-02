import { cn } from '@/lib/utils';

/**
 * A chess-side swatch: the colour of the white or black pieces, with an
 * opposing-contrast border so it reads on either theme's background. Used
 * beside player names and as game-result dots.
 *
 * No tip and nothing to name: the dot is decoration beside the name it
 * belongs to, which is the text right next to it. It carried an optional
 * `title` that all nine call sites left unset, so the attribute was never
 * written — a tooltip nobody could see, kept alive by the prop.
 */
export function SideDot({
  side,
  className,
}: {
  side: 'white' | 'black';
  className?: string;
}) {
  return (
    <span
      className={cn(
        // Fitted to a 10px mark, off the radius knob on purpose: the
        // ladder's smallest rung is 6px, which makes this a circle.
        'size-2.5 shrink-0 rounded-[3px] border',
        side === 'white'
          ? 'bg-side-white border-side-white-line'
          : 'bg-side-black border-side-black-line',
        className,
      )}
    />
  );
}
