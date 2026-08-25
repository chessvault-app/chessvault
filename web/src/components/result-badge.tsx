import { cn } from '@/lib/utils';

/**
 * A game's result as a chip: white's win on the eval bar's white, black's
 * on its black, and a draw as a single ½ on the neutral accent — "1/2-1/2"
 * spelled out is the PGN tag showing through, and at column width it
 * wraps. Shared by the explorer's game lists and the opening map's
 * deviations, so a result reads the same everywhere it appears.
 */
export function ResultBadge({ result }: { result: string }) {
  const label = result === '1-0' ? '1-0' : result === '0-1' ? '0-1' : '½';
  return (
    <span
      className={cn(
        'shrink-0 rounded-sm px-1 py-px font-mono text-xs font-semibold',
        result === '1-0' && 'bg-eval-white text-on-eval-white',
        result === '0-1' && 'bg-eval-black text-on-eval-black',
        result !== '1-0' && result !== '0-1' && 'bg-accent text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}
