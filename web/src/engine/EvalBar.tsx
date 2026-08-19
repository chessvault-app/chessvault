import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useEngine } from '@/store/engine';
import { formatScore, toWhitePov, winningChances } from './uci.ts';

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
 * `EvalBarSlot` is its WIDTH, beside the board, and exists only at `wide`;
 * stacked, the bar takes the player's row instead (EvalBarRow below), so
 * there is nothing to reserve.
 *
 * Both exist because the bar shares the board's box rather than floating
 * over it: 12px of bar and 8px of gap come out of whatever axis it sits on,
 * so a board drawn without the reservation is 20px bigger than the same
 * board drawn with it, and the difference shows the moment the two are the
 * same board — the engine being switched on, or a trainer handing its board
 * to AnalysisBoard when the puzzle ends. Reserved, nothing moves either way.
 *
 * The reservation is a `wide` idea for the same reason the bar is: it buys
 * a board that does not resize when the engine is switched, and it costs
 * 20px of width, which only the wide layout has to spend.
 */
export function EvalBarSlot() {
  return <div className="hidden w-3 shrink-0 wide:block" aria-hidden />;
}

/**
 * The engine's evaluation of the position on the board, from White's point
 * of view, or null when the engine is off or is still answering about the
 * position before this one. One rule, because a bar showing the last
 * position's score is worse than a bar showing nothing.
 */
export function useEvalScore(fen: string): { cp?: number; mate?: number } | null {
  const enabled = useEngine((s) => s.enabled);
  const lines = useEngine((s) => s.lines);
  const resultFen = useEngine((s) => s.resultFen);
  const top = enabled && resultFen === fen ? lines[0] : undefined;
  const turn: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  return top ? toWhitePov({ cp: top.cp, mate: top.mate }, turn) : null;
}

/**
 * Where the bar goes when the board is stacked: along the top edge, in the
 * row the player's name occupies, and only while the engine is on.
 *
 * Beside the board is a `wide` idea — there the column has width to spare.
 * On a phone the board IS the page, and 20px off its width is 20px off all
 * eight files. Under the board was the first answer to that and it was
 * worse: the row had to be held open whether or not the engine was on, or
 * the panels moved when it was switched, and a permanently empty strip
 * between the board and the name under it is exactly the space a phone has
 * least of (lanph3re).
 *
 * So it takes a row that already exists instead of adding one. h-6 is the
 * player row's own height — the board does not move when the engine comes
 * on, because what appears is the same size as what goes away — and the
 * caller hides the names while this is showing. The row costs nothing when
 * the engine is off: it is not rendered, and the panels have the space.
 *
 * AnalysisBoard is the only caller, and that is not an oversight. The
 * engine follows the ANALYSIS store's position (engine/EnginePane), so it
 * is the only board whose position the bar can be speaking about; a
 * trainer's own board would show an even bar for a position nothing had
 * evaluated. The trainers get one the moment they hand their board over.
 */
export function EvalBarRow({ fen }: { fen: string }) {
  const enabled = useEngine((s) => s.enabled);
  const score = useEvalScore(fen);
  if (!enabled) return null;
  return (
    // items-end, not items-center: the row is the name's, but the bar is
    // the BOARD's, and it reads as the board's edge rather than as a line
    // floating between the two. Sat in the middle it was 14px off the board
    // (6px of row plus the block's gap-2); against the bottom it is the
    // gap-2 alone. The row keeps its height, so nothing else moves —
    // lanph3re asked for the gap under the bar, not the one over it.
    <div className="flex h-6 w-full items-end wide:hidden">
      <EvalBar score={score} orientation="horizontal" />
    </div>
  );
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
