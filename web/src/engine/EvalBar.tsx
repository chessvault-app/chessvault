import type { ReactNode } from 'react';
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
 * The room the bar takes, kept open whether or not there is a bar in it —
 * one of these per axis, because the bar changes sides with the layout.
 *
 * `EvalBarSlot` is its WIDTH, beside the board, and exists only at `wide`.
 * `EvalBarStrip` is its HEIGHT, under the board, and only when stacked.
 *
 * Both exist because the bar shares the board's box rather than floating
 * over it: 12px of bar and 8px of gap come out of whatever axis it sits on,
 * so a board drawn without the reservation is 20px bigger than the same
 * board drawn with it, and the difference shows the moment the two are the
 * same board — the engine being switched on, or a trainer handing its board
 * to AnalysisBoard when the puzzle ends. Reserved, nothing moves either way.
 *
 * Which side it sits on is a layout question, not a taste one. Beside the
 * board it costs WIDTH, and on a phone the board has none to spare: the
 * board is the page there, and 20px off its width is 20px off all eight
 * files (lanph3re: the reservation made the board look pushed off-centre).
 * Under the board it costs HEIGHT, which the stacked layouts already spend
 * on strips and controls.
 */
export function EvalBarSlot() {
  return <div className="hidden w-3 shrink-0 wide:block" aria-hidden />;
}

export function EvalBarStrip({ children }: { children?: ReactNode }) {
  // Fixed height, always rendered: the switch turning the bar on must not
  // move the pane switcher and the panels under it by 12px.
  return <div className="h-3 w-full wide:hidden">{children}</div>;
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
          glance. 3px and red — a hairline at 45% opacity disappeared
          against the halves it separates, and the accent blue that
          replaced it still leaned into the dark half (both lanph3re's
          reports). Red belongs to neither side of the bar, so it reads
          on both. Centred on the midline, not below it. */}
      <div
        className={cn(
          'bg-bad/80 absolute',
          orientation === 'vertical'
            ? 'left-0 right-0 top-1/2 h-[3px] -translate-y-1/2'
            : 'bottom-0 top-0 left-1/2 w-[3px] -translate-x-1/2',
        )}
      />
    </div>
  );
}
