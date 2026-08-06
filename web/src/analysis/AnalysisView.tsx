import { RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { getNode, isOnMainline } from '@shared/tree';
import { AnalysisBoard } from '@/board/AnalysisBoard';
import { EnginePane } from '@/engine/EnginePane';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { PaneTabs } from '@/ui/PaneTabs';
import { MoveTreePane } from './MoveTreePane';
import { PositionLoader } from './PositionLoader';

type AnalysisPane = 'moves' | 'engine' | 'explorer' | 'load';

export function AnalysisView() {
  // Small screens show ONE pane under the board (lichess-app style); the
  // others stay mounted but hidden so the engine keeps following the board.
  const [pane, setPane] = useState<AnalysisPane>('moves');

  return (
    // Stacked layouts scroll the page (full-width board, pane past the fold,
    // like the lichess app); desktop fits the viewport with internal scrolls.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 max-lg:overflow-y-auto lg:flex-row lg:gap-4 lg:p-4">
      <AnalysisBoard />

      {/* Side column. Desktop shows every pane; small screens switch. */}
      <div className="flex flex-col gap-3 max-lg:shrink-0 lg:min-h-0 lg:w-[min(27rem,38%)] lg:flex-none">
        <PaneTabs
          className="lg:hidden"
          value={pane}
          onChange={setPane}
          tabs={[
            { id: 'moves', label: 'Moves' },
            { id: 'engine', label: 'Engine' },
            { id: 'explorer', label: 'Explorer' },
            { id: 'load', label: 'Load' },
          ]}
        />
        <EnginePane
          className={cn('shrink-0', pane !== 'engine' && 'max-lg:hidden')}
        />
        {/* The caps keep the explorer from squeezing the move list out of
            existence on short desktop viewports. */}
        <ExplorerPane
          className={cn(
            'max-lg:h-[26rem] max-lg:shrink-0 lg:min-h-10 lg:max-h-[45%]',
            pane !== 'explorer' && 'max-lg:hidden',
          )}
        />
        <Panel
          flush
          className={cn(
            'min-h-[8.5rem] max-lg:h-[26rem] max-lg:shrink-0 lg:flex-1',
            pane !== 'moves' && 'max-lg:hidden',
          )}
        >
          <PanelHeader title="Moves" actions={<MoveActions />} />
          <MoveTreePane />
          <StatusBar />
        </Panel>
        <div className={cn(pane !== 'load' && 'max-lg:hidden')}>
          <PositionLoader />
        </div>
      </div>
    </div>
  );
}

export function MoveActions({ allowReset = true }: { allowReset?: boolean }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const deleteNode = useAnalysis((s) => s.deleteNode);
  const promoteNode = useAnalysis((s) => s.promoteNode);
  const reset = useAnalysis((s) => s.reset);

  const node = getNode(tree, cursorId);
  const atRoot = node.parentId === null;
  const offMainline = !atRoot && !isOnMainline(tree, cursorId);

  return (
    <>
      {offMainline && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => promoteNode(cursorId, true)}
          title="Make this the main line"
        >
          Promote
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={atRoot}
        onClick={() => deleteNode(cursorId)}
        title="Delete this move and everything after it"
      >
        <Trash2 className="size-3.5" />
      </Button>
      {allowReset && (
        <Button variant="ghost" size="icon-sm" onClick={() => reset()} title="Clear the board">
          <RotateCcw className="size-3.5" />
        </Button>
      )}
    </>
  );
}

export function StatusBar() {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const exportPgn = useAnalysis((s) => s.exportPgn);
  const [copied, setCopied] = useState<'fen' | 'pgn' | null>(null);

  const node = getNode(tree, cursorId);

  const copy = useCallback(
    async (kind: 'fen' | 'pgn', value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(kind);
        setTimeout(() => setCopied(null), 1400);
      } catch {
        // Clipboard can be blocked; the FEN is selectable below regardless.
      }
    },
    [],
  );

  return (
    <div className="border-line flex shrink-0 items-center gap-2 border-t px-2 py-1.5">
      <code
        className="text-subtle min-w-0 flex-1 truncate font-mono text-[0.6875rem]"
        title={node.fen}
      >
        {node.fen}
      </code>
      <Button variant="ghost" size="sm" onClick={() => copy('fen', node.fen)}>
        {copied === 'fen' ? 'Copied' : 'FEN'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => copy('pgn', exportPgn())}>
        {copied === 'pgn' ? 'Copied' : 'PGN'}
      </Button>
    </div>
  );
}
