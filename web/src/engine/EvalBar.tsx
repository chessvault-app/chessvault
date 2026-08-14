import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { formatScore, winningChances } from './uci.ts';

interface EvalBarProps {
  /** Score from White's point of view, or null when there is no evaluation. */
  score: { cp?: number; mate?: number } | null;
  /** Vertical bar beside the board, or horizontal above a pane. */
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

/**
 * White-advantage gauge.
 *
 * Always drawn from White's perspective regardless of board orientation, which
 * is the convention every chess site uses — flipping it with the board would
 * make the same position appear to change evaluation.
 */
export function EvalBar({ score, orientation = 'vertical', className }: EvalBarProps) {
  const fraction = score ? winningChances(score) : 0.5;
  const percent = `${(fraction * 100).toFixed(1)}%`;
  const label = score ? formatScore(score) : '—';

  return (
    <div
      className={cn(
        // The explicit border keeps the dark half readable against a dark
        // panel background (and the light half against a light one).
        'bg-eval-black border-eval-border relative overflow-hidden border',
        orientation === 'vertical' ? 'h-full w-3 rounded-full' : 'h-3 w-full rounded-full',
        className,
      )}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={fraction}
      aria-label={t('Evaluation {score}', { score: label })}
      title={t("{score} (White's point of view)", { score: label })}
    >
      <div
        className="bg-eval-white absolute transition-[height,width] duration-300 ease-out"
        style={
          orientation === 'vertical'
            ? { bottom: 0, left: 0, right: 0, height: percent }
            : { top: 0, bottom: 0, left: 0, width: percent }
        }
      />
      {/* Midpoint marker, so a near-equal position is readable at a
          glance. 3px and stronger tint — a hairline at 45% opacity
          disappeared against the halves it separates (lanph3re's
          report), and the marker only earns its place if it can be seen
          without leaning in. Centred on the midline, not below it. */}
      <div
        className={cn(
          'bg-primary/80 absolute',
          orientation === 'vertical'
            ? 'left-0 right-0 top-1/2 h-[3px] -translate-y-1/2'
            : 'bottom-0 top-0 left-1/2 w-[3px] -translate-x-1/2',
        )}
      />
    </div>
  );
}
