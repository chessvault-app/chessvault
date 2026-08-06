import { cn } from '@/lib/cn';
import { formatScore, winningChances } from './uci.ts';

interface EvalBarProps {
  /** Score from White's point of view, or null when there is no evaluation. */
  score: { cp?: number; mate?: number } | null;
  /** Vertical bar beside the board, or horizontal above a pane. */
  orientation?: 'vertical' | 'horizontal';
  /** Print the score inside the bar. Off by default — usually shown alongside. */
  showLabel?: boolean;
  className?: string;
}

/**
 * White-advantage gauge.
 *
 * Always drawn from White's perspective regardless of board orientation, which
 * is the convention every chess site uses — flipping it with the board would
 * make the same position appear to change evaluation.
 */
export function EvalBar({
  score,
  orientation = 'vertical',
  showLabel = false,
  className,
}: EvalBarProps) {
  const fraction = score ? winningChances(score) : 0.5;
  const percent = `${(fraction * 100).toFixed(1)}%`;
  const label = score ? formatScore(score) : '—';
  const whiteAhead = fraction >= 0.5;

  return (
    <div
      className={cn(
        // The explicit border keeps the dark half readable against a dark
        // panel background (and the light half against a light one).
        'bg-eval-black relative overflow-hidden border border-black/20 dark:border-white/25',
        orientation === 'vertical' ? 'h-full w-3 rounded-full' : 'h-3 w-full rounded-full',
        className,
      )}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={fraction}
      aria-label={`Evaluation ${label}`}
      title={`${label} (White's point of view)`}
    >
      <div
        className="bg-eval-white absolute transition-[height,width] duration-300 ease-out"
        style={
          orientation === 'vertical'
            ? { bottom: 0, left: 0, right: 0, height: percent }
            : { top: 0, bottom: 0, left: 0, width: percent }
        }
      />
      {/* Midpoint marker, so a near-equal position is readable at a glance. */}
      <div
        className={cn(
          'absolute bg-primary/45',
          orientation === 'vertical' ? 'left-0 right-0 h-px top-1/2' : 'top-0 bottom-0 w-px left-1/2',
        )}
      />
      {showLabel && orientation === 'horizontal' && (
        <span
          className={cn(
            'absolute inset-0 flex items-center px-1.5 font-mono text-[0.5625rem] font-semibold',
            whiteAhead ? 'justify-start text-black/70' : 'justify-end text-white/80',
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}
