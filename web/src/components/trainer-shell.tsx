import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { AnalysisBoard, BoardControls, ColumnControls } from '@/board/AnalysisBoard';
import { publishBoardHeight } from '@/board/boardBlock';
import { BOARD_MAX_W } from '@/board/boardSize';
import { BOARD_WIDE_COLUMN } from '@/components/layout';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { PaneTabs } from '@/components/pane-tabs';
import { Panel } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { EngineBlock } from '@/engine/EnginePane';
import { EvalBarSlot } from '@/engine/EvalBar';
import type { useAnalyseInPlace } from '@/hooks/use-analyse-in-place';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The parts of a trainer's page that are the same on all three of them
 * (the puzzle trainer, the book trainer, the repertoire drill): the board
 * column, the side column's row of panes, and the phone's bottom bar.
 * Each was written out three times, and every layout fix had to be made
 * per copy; the comments in the copies said "see the puzzle trainer's".
 */

/**
 * The board column, matching the shared budget so the board sits where
 * every other view puts it. Once the exercise is over it becomes the
 * analysis board itself, so the pieces move freely and the eval bar is
 * the one every other board page draws.
 *
 * `strip` is the row above the board — the repertoire drill puts the
 * opponent's name there; the others hold the height open — and `below`
 * the row under it. The eval bar's width is held open before there is
 * an eval bar: when the exercise ends this board is replaced by
 * AnalysisBoard, which draws one, and without the same reservation here
 * the board narrowed and stepped right at the exact moment the answer
 * appeared (lanph3re's two screenshots).
 */
export function TrainerBoard({
  analysing,
  strip,
  below,
  children,
}: {
  analysing: boolean;
  strip?: ReactNode;
  below?: ReactNode;
  /** The trainer's own Board, with whatever it lays over it. */
  children: ReactNode;
}) {
  if (analysing) return <AnalysisBoard />;
  return (
    <div className={BOARD_WIDE_COLUMN}>
      <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
        {strip ?? <div className="hidden w-full items-end wide:flex wide:h-10" />}
        <div className="flex w-full items-stretch gap-2">
          <EvalBarSlot />
          <div className="relative min-w-0 flex-1">{children}</div>
        </div>
        {below}
      </div>
    </div>
  );
}

/**
 * The side column's panes: one at a time on a phone behind the switcher,
 * all of them down the column on a desktop. Moves above the trainer's
 * own panel, because they are what you read while solving and the engine
 * docks on top of them the moment it is over. The strip at the column's
 * floor appears only once the exercise is over: until then the board is
 * the trainer's own tree, not the analysis store those buttons drive.
 */
export function TrainerPanes({
  wide,
  view,
  moves,
  info,
}: {
  wide: boolean;
  view: ReturnType<typeof useAnalyseInPlace>;
  moves: ReactNode;
  info: ReactNode;
}) {
  const { analysing, shownPane, setPane, panes, paneSwipe } = view;
  return (
    <>
      {!wide && <PaneTabs variant="header" value={shownPane} onChange={setPane} tabs={panes} />}
      {(wide || paneSwipe.shows('moves')) && moves}
      {!wide && analysing && paneSwipe.shows('engine') && (
        <Panel className="min-h-0 flex-1">
          <EngineBlock standalone />
        </Panel>
      )}
      {(wide || paneSwipe.shows('info')) && info}
      {analysing && <ColumnControls className="wide:hidden" />}
    </>
  );
}

/**
 * Phones: the bottom bar steps through the line played so far, like every
 * other board page. The trainer's own actions (hint, solution, skip, next)
 * live in its panel — no duplicates here.
 *
 * Once the exercise is over the board is AnalysisBoard and the line lives
 * in the analysis store, so buttons that drive the trainer's own cursor
 * would drive nothing: the analysis pages' own control strip is what
 * moves that board, and AnalysisBoard itself owns the arrow keys.
 */
export function TrainerNavBar({
  analysing = false,
  startDisabled,
  forwardDisabled,
  lastDisabled = forwardDisabled,
  firstTitle = t('First move'),
  onFirst,
  onBack,
  onForward,
  onLast,
  onFlip,
}: {
  analysing?: boolean;
  /** First and Back: nothing has been played yet. */
  startDisabled: boolean;
  forwardDisabled: boolean;
  lastDisabled?: boolean;
  firstTitle?: string;
  onFirst: () => void;
  onBack: () => void;
  onForward: () => void;
  onLast: () => void;
  onFlip: () => void;
}) {
  return (
    <MobileActionBar>
      {analysing ? (
        <BoardControls className="py-1.5" />
      ) : (
        <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
          <Button variant="ghost" size="icon" disabled={startDisabled} onClick={onFirst} title={firstTitle}>
            <ChevronFirst className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={startDisabled} onClick={onBack} title={t('Back')}>
            <ChevronLeft className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={forwardDisabled} onClick={onForward} title={t('Forward')}>
            <ChevronRight className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={lastDisabled} onClick={onLast} title={t('Go to the end')}>
            <ChevronLast className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onFlip} title={t('Flip board')}>
            <FlipVertical2 className="size-[1.1rem]" />
          </Button>
        </div>
      )}
    </MobileActionBar>
  );
}
