import { cn } from '@/lib/cn';

/**
 * A chess-side swatch: the colour of the white or black pieces, with an
 * opposing-contrast border so it reads on either theme's background. Used
 * beside player names and as game-result dots.
 */
export function SideDot({
  side,
  shape = 'square',
  className,
  title,
}: {
  side: 'white' | 'black';
  /** Squares mark players; circles mark results. */
  shape?: 'square' | 'circle';
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'shrink-0 border',
        shape === 'square' ? 'size-2.5 rounded-[3px]' : 'size-2 rounded-full',
        side === 'white'
          ? 'bg-side-white border-side-white-line'
          : 'bg-side-black border-side-black-line',
        className,
      )}
    />
  );
}
