import { EngineBlock } from '@/engine/EnginePane';
import { PaneControls } from '@/board/AnalysisBoard';
import { MoveActions, MovesOverflow } from '@/analysis/AnalysisView';
import { MoveTreePane, SidelinesToggle } from '@/analysis/MoveTreePane';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Panel, PanelHeader } from '@/components/panel';

/**
 * The moves panel the trainers show while analysing: the engine docked
 * over the move tree, with the board's own controls under it.
 *
 * Written once because it was written three times. The puzzle trainer, the
 * book trainer and the repertoire each carried an identical copy, so taking
 * the FEN strip out of the Board page left all three of them showing it —
 * StatusBar was shared, the panel around it was not, and only the second
 * of those is what a reader sees.
 *
 * The strip is gone here too. It listed the FEN and offered Copy FEN and
 * Copy PGN; the ... menu offers both already, so the row was a second way
 * to say the same thing that cost a line of every panel it sat in.
 */
export function AnalysisMovesPanel({
  /** False where the engine has a pane of its own (a phone's switcher). */
  engine = true,
  className,
}: {
  engine?: boolean;
  className?: string;
}) {
  return (
    <Panel className={cn('min-h-min flex-1', className)}>
      {engine && <EngineBlock />}
      <PanelHeader
        title={t('Moves')}
        actions={
          <>
            <SidelinesToggle />
            <MoveActions allowReset={false} />
            {/* Where Copy FEN and Copy PGN live now. */}
            <MovesOverflow allowReset={false} />
          </>
        }
      />
      <MoveTreePane />
      {/* `stacked:hidden`: where this panel is one tab of several, the
          column's own strip carries the buttons (ColumnControls). */}
      <PaneControls className="stacked:hidden" />
    </Panel>
  );
}
