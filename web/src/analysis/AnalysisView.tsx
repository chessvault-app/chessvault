import { RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getNode, isOnMainline } from '@shared/tree';
import { AnalysisBoard } from '@/board/AnalysisBoard';
import { EnginePane } from '@/engine/EnginePane';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { useExplorer } from '@/store/explorer';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { PaneTabs } from '@/ui/PaneTabs';
import { MoveTreePane } from './MoveTreePane';
import { LoadPositionButton } from './PositionLoader';

type AnalysisPane = 'moves' | 'engine' | 'explorer';

export function AnalysisView() {
  // Small screens show ONE pane under the board (lichess-app style); the
  // others stay mounted but hidden so the engine keeps following the board.
  const [pane, setPane] = useState<AnalysisPane>('moves');

  // Stateless page (lanph3re's call): entering analysis always starts a fresh
  // board with the engine off and the explorer at its default — UNLESS a
  // view just handed a position over (editor, games, puzzles), marked by
  // the handoff flag. The ref makes the decision once per real mount:
  // StrictMode runs the effect twice, and the second run must not treat
  // the just-consumed flag as "no handoff" and wipe the board.
  const entered = useRef(false);
  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    const analysis = useAnalysis.getState();
    if (analysis.handoff) {
      useAnalysis.setState({ handoff: false });
      return;
    }
    analysis.reset();
    const engine = useEngine.getState();
    if (engine.enabled) engine.setEnabled(false);
    useExplorer.setState({ enabled: true });
  }, []);

  return (
    // Stacked layouts scroll the page (full-width board, pane past the fold,
    // like the lichess app); desktop fits the viewport with internal scrolls.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
      <AnalysisBoard />

      {/* Side column. Desktop shows every pane; small screens switch, with
          the active pane flexing into the space left under the board.
          min-h-0 only on side-by-side layouts: stacked keeps the natural
          content minimum so squat viewports scroll instead of crushing
          panels into their own overflow-hidden. */}
      <div className="flex flex-1 flex-col gap-3 stacked:gap-2 wide:min-h-0 wide:w-[min(27rem,38%)] wide:flex-none wide:overflow-y-auto">
        <PaneTabs
          className="lg:hidden"
          value={pane}
          onChange={setPane}
          tabs={[
            { id: 'moves', label: 'Moves' },
            { id: 'engine', label: 'Engine' },
            { id: 'explorer', label: 'Explorer' },
          ]}
        />
        <EnginePane
          className={cn('shrink-0', pane !== 'engine' && 'max-lg:hidden')}
        />
        {/* The caps keep the explorer from squeezing the move list out of
            existence on short desktop viewports. */}
        <ExplorerPane
          resizeKey="analysis-explorer"
          className={cn(
            'max-lg:min-h-[8rem] max-lg:flex-1 lg:min-h-min lg:max-h-[45%]',
            pane !== 'explorer' && 'max-lg:hidden',
          )}
        />
        {/* min-h-min, NOT min-h-auto: Panel's overflow-hidden disables the
            automatic content-based minimum (it computes to 0), but the
            explicit min-content keyword still applies — the panel refuses
            to shrink below its floors (header + tree min-h + status bar)
            and overflows the column into scroll instead of clipping. */}
        <Panel
          flush
          className={cn('min-h-min flex-1', pane !== 'moves' && 'max-lg:hidden')}
        >
          <PanelHeader
            title="Moves"
            actions={
              <>
                <LoadPositionButton />
                <MoveActions />
              </>
            }
          />
          <MoveTreePane />
          <StatusBar />
        </Panel>
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
