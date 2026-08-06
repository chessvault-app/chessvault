import { RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { getNode, isOnMainline } from '@shared/tree';
import { AnalysisBoard } from '@/board/AnalysisBoard';
import { EnginePane } from '@/engine/EnginePane';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { MoveTreePane } from './MoveTreePane';
import { PositionLoader } from './PositionLoader';

export function AnalysisView() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row lg:gap-4 lg:p-4">
      <AnalysisBoard />

      {/* Side column. Stacked layouts scroll the whole column; on desktop it
          fits the viewport and each pane scrolls internally instead. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:max-w-[27rem] lg:overflow-visible">
        <EnginePane className="shrink-0" />
        {/* The caps keep the explorer from squeezing the move list out of
            existence on short desktop viewports. */}
        <ExplorerPane className="max-h-80 shrink-0 lg:min-h-10 lg:max-h-[45%]" />
        <Panel flush className="min-h-[8.5rem] flex-1">
          <PanelHeader title="Moves" actions={<MoveActions />} />
          <MoveTreePane />
          <StatusBar />
        </Panel>
        <PositionLoader />
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
