import { useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';
import { useEngine } from '@/store/engine';
import { terminalResult, terminalScore } from './terminal.ts';
import { formatScore, formatScoreCompact, toWhitePov, winningChances } from './uci.ts';

interface EvalBarProps {
  /** Score from White's point of view, or null when there is no evaluation. */
  score: { cp?: number; mate?: number } | null;
  /**
   * The result of a game that is already over, printed in place of the
   * score — the way every board site writes a finished game, and the way a
   * scoresheet does. Only a DECISIVE end has one: a draw keeps its number,
   * which is `0.0` and says the same thing (see `terminalResult`).
   *
   * A caller with no finished game passes nothing. `useEvalReadout` works
   * it out for the bars that stand beside a board; the repertoire's
   * assessment passes it too, and prints it in its own number's slot —
   * there the bar shows nothing (`showScore={false}`), but the label and
   * the tip are still the bar's to name.
   */
  result?: '1-0' | '0-1' | null;
  /** Vertical bar beside the board, or horizontal above a pane. */
  orientation?: 'vertical' | 'horizontal';
  /**
   * Print the score inside the bar. Off for a caller that already prints
   * it beside the bar — the repertoire's assessment does, at text-xl and
   * signed, and the same number twice reads as two numbers.
   */
  showScore?: boolean;
  className?: string;
}

/**
 * The vertical bar's width, and the width `EvalBarSlot` holds open for it —
 * ONE constant, because a reservation that disagrees with the bar moves the
 * board by the difference the moment the engine is switched on.
 *
 * 28px is what the readout needs: four monospace digits at 10px inside the
 * 1px border ("12.3"), which is every score the bar prints short of a
 * hundred pawns. It was 12px while the bar was a gauge and nothing else.
 */
const EVAL_BAR_W = 'w-7';

/**
 * That same lane in PIXELS — the bar's `w-7` plus the board row's `gap-2` —
 * for the one host that has to lay the lane out in JavaScript.
 *
 * Every other board page is a centred column and lets CSS discover the
 * width. The workspace's board is a column among peers whose width IS its
 * height budget, computed and handed over as a number, so a lane it cannot
 * see is a lane it cannot pay for. Same rule as EVAL_BAR_W above, in the
 * other unit: a number that disagrees with the class moves the board by
 * the difference.
 */
export const EVAL_LANE_PX = 36;

/**
 * The horizontal bar's height, WITH a number in it and without.
 *
 * 20px is the number's room — a 10px line and its 1px borders, with enough
 * either side that the digits are not wedged against them — and it costs
 * nothing where it is spent: that bar is drawn against the bottom of a row
 * that is already h-6, so the 8px come out of the empty half of the row
 * rather than out of the board.
 *
 * 12px is what a bar with nothing printed in it needs, and it is what the
 * repertoire's assessment keeps: that one has the score beside it already
 * (showScore={false}), so height there would be height for nothing.
 */
const EVAL_BAR_H = { withScore: 'h-5', bare: 'h-3' };

/**
 * The room the bar takes, kept open whether or not there is a bar in it —
 * one of these per axis, because the bar changes sides with the layout.
 *
 * `EvalBarSlot` is its WIDTH, beside the board. At `wide` it is held open
 * whether or not there is a bar in it; at `roomy` — a tablet upright — it
 * is only there when the bar is, so `drawn` says which. Narrower than that
 * the bar takes the player's row instead (EvalBarRow below), so there is
 * nothing to reserve.
 *
 * Both exist because the bar shares the board's box rather than floating
 * over it: the bar's width and 8px of gap come out of whatever axis it sits
 * on, so a board drawn without the reservation is 36px bigger than the same
 * board drawn with it, and the difference shows the moment the two are the
 * same board — the engine being switched on, or a trainer handing its board
 * to AnalysisBoard when the puzzle ends. Reserved, nothing moves either way.
 *
 * The reservation buys a board that does not resize when the engine is
 * switched, and at `wide` it costs 36px of the board's width to do it.
 * `roomy` does not reserve, and does not have to: there the 36px is added
 * to the board's budget out of a column that had it spare
 * (BOARD_LANE_ALLOWANCE in boardSize.ts), so the board is the same size
 * either way — it only moves, by the 18px that centring board-plus-bar
 * costs against centring the board alone.
 *
 * `reserve={false}` is `roomy`'s bargain taken to `wide`, and the
 * workspace is the one host that can strike it: its board column is sized
 * in JavaScript, so it can widen the column by the lane instead of taking
 * the lane out of the board (EVAL_LANE_PX, WorkspaceView). Nothing is held
 * open there — an empty lane beside the board, and the same indent under
 * both player bars, was 36px of nothing on a page whose board is already
 * the smallest thing on it (lanph3re). Every centred board page keeps the
 * default: a page that cannot widen its column has only the board to pay
 * with, and paying on toggle is the resize the reservation exists to stop.
 */
export function EvalBarSlot({
  drawn = false,
  reserve = true,
}: { drawn?: boolean; reserve?: boolean } = {}) {
  // Nothing to hold open and nothing to line up with: no element, so the
  // row's gap-2 goes with it rather than being drawn against the board's
  // edge.
  if (!reserve && !drawn) return null;
  return (
      <div
        className={cn('hidden shrink-0 wide:block', drawn && 'roomy:block', EVAL_BAR_W)}
        aria-hidden
      />
    );
  }
  
  /**
   * A row laid over the BOARD, not over the board's column.
   *
   * The column is this bar's lane plus the board, so a `w-full` row above or
   * below the board starts a bar's width and a gap to the LEFT of the board it
   * describes — a player's colour swatch lining up with nothing (lanph3re).
   * This is the board row's own geometry, reused: the same reservation on the
   * left (`EvalBarSlot`, hidden exactly where the bar is), the same `flex-1`
   * cell, and the child then carries `.board-box` so it rounds down to the
   * pixel grid and centres in that cell exactly as the board does. The cell
   * alone is not enough: the board box is up to a square-quantum narrower
   * than the cell and centres in what is left, so a row that filled the cell
   * still started a couple of pixels left of the a-file (2px at 1280x800,
   * and it moves with the window).
   *
   * The gap costs nothing when stacked: the slot is `display: none` there, so
   * it is not a flex item and there is no gap to draw either side of it.
   *
   * Every row that stands over a board wears one, and they are not all
   * players: the repertoire's two side slots, which exist so its board sits
   * where the Board tab's does, and the line the book trainer's entry board
   * prints under itself. A row that skips it is a row that says it belongs to
   * the board and then starts somewhere else.
   */
  export function BoardLane({
    bar = false,
    reserve = true,
    className,
    children,
  }: {
    /** Whether a bar is drawn beside the board — see `EvalBarSlot`'s `drawn`. */
    bar?: boolean;
    /** Whether the lane is held open while no bar is in it — see `EvalBarSlot`. */
    reserve?: boolean;
    className?: string;
    children: ReactNode;
  }) {
    return (
      <div className={cn('flex w-full gap-2', className)}>
        <EvalBarSlot drawn={bar} reserve={reserve} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
  );
}

/**
 * What the bar is showing: the position's evaluation from White's point of
 * view, and — when the game on the board is already over and was won — the
 * result to print instead of it. Both null when the engine is off or is
 * still answering about the position before this one. One rule, because a
 * bar showing the last position's score is worse than a bar showing nothing.
 *
 * A FINISHED position is answered by rule and the engine is not consulted at
 * all. It cannot be: Stockfish replies to a mated board with `bestmove
 * (none)` and one PV-less `info` line, which parseInfo drops for carrying no
 * variation, so the search ends with zero lines and never says anything
 * about the position again (see terminal.ts). Waiting on `lines[0]` there is
 * waiting for something that is not coming — and the bar's own answer to
 * "no evaluation" is the halfway mark, so a checkmate drew as dead level
 * with a dash for a score. Every other reader of a terminal position already
 * had its own copy of this (EnginePane, FinalAssessment, review); the bar
 * was the one still asking the engine.
 */
export function useEvalReadout(fen: string): {
  score: { cp?: number; mate?: number } | null;
  result: '1-0' | '0-1' | null;
} {
  const enabled = useEngine((s) => s.enabled);
  const lines = useEngine((s) => s.lines);
  const resultFen = useEngine((s) => s.resultFen);
  const settled = useMemo(() => terminalScore(fen), [fen]);
  const top = enabled && resultFen === fen ? lines[0] : undefined;
  const turn: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  if (!enabled) return { score: null, result: null };
  if (settled) {
    // Only a decisive end is written as a result, and a draw keeps its
    // number — see terminalResult. `#1` on a board that has ALREADY been
    // mated reads as a mate still to be played, which is the thing this
    // bar must not say (lanph3re).
    return { score: settled, result: terminalResult(settled) };
  }
  return {
    score: top ? toWhitePov({ cp: top.cp, mate: top.mate }, turn) : null,
    result: null,
  };
}

/**
 * Where the bar goes when the board is stacked and NARROW: along the top
 * edge, in the row the player's name occupies, and only while the engine is
 * on. A stacked tablet is `roomy` instead and gets the bar beside the board
 * like `wide` — this row is the phone's arrangement, and hides there.
 *
 * Beside the board needs a column with width to spare. On a phone the board
 * IS the page, and 36px off its width is 36px off all eight files. Under the board was the first answer to that and it was
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
  const { score, result } = useEvalReadout(fen);
  if (!enabled) return null;
  return (
    // items-end, not items-center: the row is the name's, but the bar is
    // the BOARD's, and it reads as the board's edge rather than as a line
    // floating between the two. Sat in the middle it was 14px off the board
    // (6px of row plus the block's gap-2); against the bottom it is the
    // gap-2 alone. The row keeps its height, so nothing else moves —
    // lanph3re asked for the gap under the bar, not the one over it.
    <div className="flex h-6 w-full items-end wide:hidden roomy:hidden">
      {/* `board-box`: the bar is the board's, and now that its ends carry
          the number they have to BE the board's ends — the box below is up
          to a square-quantum narrower than the column and centres in what
          is left, so a bar drawn to the column overhung it by a pixel or
          two either side. Same class as the board, so the two cannot
          disagree. */}
      <EvalBar score={score} result={result} orientation="horizontal" className="board-box" />
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
export function EvalBar({
  score,
  result = null,
  orientation = 'vertical',
  showScore = true,
  className,
}: EvalBarProps) {
  const fraction = score ? winningChances(score) : 0.5;
  const percent = `${(fraction * 100).toFixed(1)}%`;
  // A finished game is named by its result and not by a score, everywhere
  // the bar names it: `-#1` is a mate in one, and the board it would be
  // printed on has already been mated.
  const label = result ?? (score ? formatScore(score) : '—');
  // Which end of the bar the readout sits at, and therefore which of the two
  // halves it is printed on. At or above the midpoint the White block is at
  // least half the bar, so that end is inside it; below, the Black block
  // holds the other end by the same arithmetic. No score, nothing to print —
  // and nothing either where the caller prints the number itself.
  const readout = showScore ? (result ?? (score ? formatScoreCompact(score) : '')) : '';
  const whiteAhead = fraction >= 0.5;

  return (
    // The bar is the only thing on the board that says which side the
    // number is FOR, and it says it on hover — so the tip carries real
    // information and stays. A result is already absolute, so there is no
    // point of view to name; the tip says in words what the notation says
    // in figures. `role="meter"` keeps its own name.
    <TitleTip
      title={
        result
          ? result === '1-0'
            ? t('White won')
            : t('Black won')
          : t("{score} (White's point of view)", { score: label })
      }
    >
      <div
        className={cn(
          // The explicit border keeps the dark half readable against a dark
          // panel background (and the light half against a light one).
          // Square, not the pill it was (lanph3re's call): the ends are
          // where the number is printed, and `rounded-full` on a 28px bar is
          // a 14px radius — the whole of the row the digits sit in.
          'bg-eval-black border-eval-border relative overflow-hidden border',
          // No width of its own when horizontal: the caller says how wide,
          // because the two of them want different answers — the board's own
          // rectangle above a phone's board, the rest of a row in the
          // repertoire's assessment — and a `w-full` here would beat either
          // (utilities layer over components).
          orientation === 'vertical'
            ? cn('h-full', EVAL_BAR_W)
            : showScore
              ? EVAL_BAR_H.withScore
              : EVAL_BAR_H.bare,
          className,
        )}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={fraction}
        aria-label={t('Evaluation {score}', { score: label })}
      >
        <div
          className="bg-eval-white absolute transition-[height,width] duration-300 ease-out"
          style={
            orientation === 'vertical'
              ? { bottom: 0, left: 0, right: 0, height: percent }
              : { top: 0, bottom: 0, left: 0, width: percent }
          }
        />
        {/* No midpoint marker. There was one — 3px of red across the middle,
            twice re-coloured to keep it legible on both halves — and it was
            the answer to a bar that could only be read by eye: within a
            couple of pixels of even, the eye needs something to measure the
            split against. The number says it now, so the line was one more
            thing drawn across a 28px bar that already carries digits, a fill
            edge and a border (lanph3re's call to drop it). */}
        {/* The score itself, at the leading side's end and in that side's
            own text colour — the same pairing the result bars use. Drawn
            over both halves; unsigned, because where it is and what colour
            it is already say whose advantage it is (formatScoreCompact). */}
        {readout && (
          <span
            className={cn(
              'absolute font-mono text-micro leading-none tabular-nums',
              orientation === 'vertical'
                ? cn('inset-x-0 text-center', whiteAhead ? 'bottom-0.5' : 'top-0.5')
                : cn('top-1/2 -translate-y-1/2', whiteAhead ? 'left-1' : 'right-1'),
              whiteAhead ? 'text-on-eval-white' : 'text-on-eval-black',
            )}
            aria-hidden
          >
            {readout}
          </span>
        )}
      </div>
    </TitleTip>
  );
}
