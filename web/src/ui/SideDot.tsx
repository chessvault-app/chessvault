import { cn } from '@/lib/utils';

/**
 * A chess-side swatch: the colour of the white or black pieces, with an
 * opposing-contrast border so it reads on either theme's background. Used
 * beside player names and as game-result dots.
 */
export function SideDot({
  side,
  className,
  title,
}: {
  side: 'white' | 'black';
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'size-2.5 shrink-0 rounded-[3px] border',
        side === 'white'
          ? 'bg-side-white border-side-white-line'
          : 'bg-side-black border-side-black-line',
        className,
      )}
    />
  );
}
