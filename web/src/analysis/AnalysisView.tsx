import { RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getNode } from '@shared/tree';
import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { EngineBlock } from '@/engine/EnginePane';
import { ReviewButton, ReviewStrip } from '@/engine/ReviewStrip';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/clipboard';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { useExplorer } from '@/store/explorer';
import { useReview } from '@/store/review';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { PaneTabs } from '@/ui/PaneTabs';
import { MoveTreePane } from './MoveTreePane';
import { LoadPositionButton } from './PositionLoader';

type AnalysisPane = 'moves' | 'explorer';

export function AnalysisView() {
  // Small screens show ONE pane under the board (lichess-app style); the
  // others stay mounted but hidden so the engine keeps following the board.
  const [pane, setPane] = useState<AnalysisPane>('moves');
  const engineOn = useEngine((s) => s.enabled);

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
    useExplorer.setState({ enabled: false });
    useReview.getState().clear();
  }, []);

  return (
    // Stacked layouts scroll the page (full-width board, pane past the fold,
    // like the lichess app); desktop fits the viewport with internal scrolls.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto stacked:[scrollbar-gutter:stable_both-edges] wide:flex-row wide:gap-4 wide:p-4">
      <AnalysisBoard />

      {/* Side column. Desktop shows every pane; small screens switch, with
          the active pane flexing into the space left under the board. The
          column scrolls on every layout: panels keep explicit floors and
          the move table scrolls internally. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable] stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        <PaneTabs
          className="lg:hidden"
          value={pane}
          onChange={setPane}
          tabs={[
            { id: 'moves', label: 'Moves' },
            { id: 'explorer', label: 'Explorer' },
          ]}
        />
        {/* An EXPLICIT floor, not min-h-min: intrinsic sizing counts the
            move table's full content (overflow is ignored), so a content
            floor grows with the game. The fixed floor keeps the panel
            bounded — the table scrolls inside — while the column scrolls
            when the viewport can't fit the floor. */}
        <Panel
          flush
          // The engine block lives inside this panel, so its eval bar and PV
          // lines (~7rem) would otherwise eat the move table's rows — the
          // floor grows with it and the column scrolls instead.
          className={cn(engineOn ? 'min-h-[28rem]' : 'min-h-[22rem]', 'flex-1', pane !== 'moves' && 'max-lg:hidden')}
        >
          <EngineBlock />
          <PanelHeader
            title="Moves"
            actions={
              <>
                <ReviewButton />
                <LoadPositionButton />
                <MoveActions />
              </>
            }
          />
          <MoveTreePane />
          <ReviewStrip />
          {/* Navigation lives at the bottom of the moves panel (lanph3re's
              call), not under the board. */}
          <BoardControls className="border-line border-t stacked:hidden" keyboard={false} />
          <StatusBar />
        </Panel>
        {/* The caps keep the explorer from squeezing the move list out of
            existence on short desktop viewports. */}
        <ExplorerPane
          resizeKey="analysis-explorer"
          className={cn(
            'max-lg:min-h-[8rem] max-lg:flex-1 lg:min-h-min lg:max-h-[45%]',
            pane !== 'explorer' && 'max-lg:hidden',
          )}
        />
      </div>
    </div>
  );
}

export function MoveActions({ allowReset = true }: { allowReset?: boolean }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const deleteNode = useAnalysis((s) => s.deleteNode);
  const reset = useAnalysis((s) => s.reset);

  const node = getNode(tree, cursorId);
  const atRoot = node.parentId === null;

  // Promotion lives on the variation rows themselves (see MoveTreePane),
  // the same control in every moves table.
  return (
    <>
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
  const [copied, setCopied] = useState<'fen' | 'pgn' | 'failed' | null>(null);

  const node = getNode(tree, cursorId);

  const copy = useCallback(async (kind: 'fen' | 'pgn', value: string) => {
    setCopied((await copyText(value)) ? kind : 'failed');
    setTimeout(() => setCopied(null), 1400);
  }, []);

  return (
    <div className="border-line flex shrink-0 items-center gap-2 border-t px-2 py-1.5">
      <code
        className="text-subtle min-w-0 flex-1 truncate font-mono text-[0.6875rem]"
        title={node.fen}
      >
        {node.fen}
      </code>
      <Button variant="ghost" size="sm" onClick={() => void copy('fen', node.fen)}>
        {copied === 'fen' ? 'Copied' : copied === 'failed' ? 'Failed' : 'FEN'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void copy('pgn', exportPgn())}>
        {copied === 'pgn' ? 'Copied' : copied === 'failed' ? 'Failed' : 'PGN'}
      </Button>
    </div>
  );
}
