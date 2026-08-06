import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { getNode, isOnMainline } from '@shared/tree';
import { Board } from '@/board/Board';
import { PromotionPicker } from '@/board/PromotionPicker';
import { fromDrawShapes, toDrawShapes } from '@/board/shapes';
import { EnginePane } from '@/engine/EnginePane';
import { EvalBar } from '@/engine/EvalBar';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { toWhitePov } from '@/engine/uci';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { MoveTreePane } from './MoveTreePane';
import { PositionLoader } from './PositionLoader';

export function AnalysisView() {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const orientation = useAnalysis((s) => s.orientation);
  const pendingPromotion = useAnalysis((s) => s.pendingPromotion);

  const playMove = useAnalysis((s) => s.playMove);
  const completePromotion = useAnalysis((s) => s.completePromotion);
  const cancelPromotion = useAnalysis((s) => s.cancelPromotion);
  const setShapes = useAnalysis((s) => s.setShapes);

  const node = getNode(tree, cursorId);
  const dests = useAnalysis((s) => s.dests)();
  const isCheck = useAnalysis((s) => s.isCheck)();

  const lastMove = node.uci
    ? ([node.uci.slice(0, 2), node.uci.slice(2, 4)] as [string, string])
    : undefined;

  // -- engine overlays --
  const engineOn = useEngine((s) => s.enabled);
  const engineLines = useEngine((s) => s.lines);
  const engineFen = useEngine((s) => s.resultFen);

  // Only trust engine output that belongs to the position on screen, otherwise a
  // late message paints the previous position's arrow and eval.
  const engineFresh = engineOn && engineFen === node.fen;
  const topLine = engineFresh ? engineLines[0] : undefined;
  const turn: 'white' | 'black' = node.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const evalScore = topLine ? toWhitePov({ cp: topLine.cp, mate: topLine.mate }, turn) : null;

  const engineArrow = useMemo((): DrawShape[] => {
    const best = topLine?.moves[0];
    if (!best || best.length < 4) return [];
    // An auto-shape, so drawing your own arrows never clobbers it.
    return [{ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'blue' }];
  }, [topLine?.moves]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row lg:gap-4 lg:p-4">
      {/* Board column */}
      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 lg:flex-1 lg:justify-center">
        {/* Bounded by height so the board never pushes the controls off-screen,
            and by an absolute cap so it stops stealing room from the side panes
            on a wide display. */}
        <div className="flex w-full max-w-[min(100%,calc(100dvh-11rem))] items-stretch gap-2 lg:max-w-[min(100%,calc(100dvh-8rem),40rem)]">
          {engineOn && <EvalBar score={evalScore} className="shrink-0" />}
          <div className="relative min-w-0 flex-1">
            <Board
              fen={node.fen}
              orientation={orientation}
              dests={dests}
              lastMove={lastMove}
              check={isCheck}
              shapes={toDrawShapes(node.shapes)}
              autoShapes={engineArrow}
              onMove={playMove}
              onShapesChange={(next) => setShapes(cursorId, fromDrawShapes(next))}
            />
            {pendingPromotion && (
              <PromotionPicker
                color={pendingPromotion.color}
                dest={pendingPromotion.dest}
                orientation={orientation}
                onSelect={completePromotion}
                onCancel={cancelPromotion}
              />
            )}
          </div>
        </div>
        <BoardControls />
      </div>

      {/* Side column */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:max-w-[27rem]">
        <EnginePane className="shrink-0" />
        {/* min-h keeps either pane from squeezing the other out of existence
            on short viewports; both scroll internally. */}
        <ExplorerPane className="min-h-10 max-h-[45%] shrink-0" />
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

function BoardControls() {
  const goToStart = useAnalysis((s) => s.goToStart);
  const goBack = useAnalysis((s) => s.goBack);
  const goForward = useAnalysis((s) => s.goForward);
  const goToEnd = useAnalysis((s) => s.goToEnd);
  const flip = useAnalysis((s) => s.flip);

  // Arrow keys should drive the board from anywhere except a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          goBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goForward();
          break;
        case 'ArrowUp':
        case 'Home':
          e.preventDefault();
          goToStart();
          break;
        case 'ArrowDown':
        case 'End':
          e.preventDefault();
          goToEnd();
          break;
        case 'f':
          flip();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goForward, goToStart, goToEnd, flip]);

  return (
    <div className="flex w-full items-center justify-center gap-1">
      <Button variant="ghost" size="icon" onClick={goToStart} title="Start (↑)">
        <ChevronFirst className="size-[1.1rem]" />
      </Button>
      <Button variant="ghost" size="icon" onClick={goBack} title="Back (←)">
        <ChevronLeft className="size-[1.1rem]" />
      </Button>
      <Button variant="ghost" size="icon" onClick={goForward} title="Forward (→)">
        <ChevronRight className="size-[1.1rem]" />
      </Button>
      <Button variant="ghost" size="icon" onClick={goToEnd} title="End (↓)">
        <ChevronLast className="size-[1.1rem]" />
      </Button>
      <div className="bg-line mx-1 h-5 w-px" />
      <Button variant="ghost" size="icon" onClick={flip} title="Flip board (f)">
        <FlipVertical2 className="size-[1.1rem]" />
      </Button>
    </div>
  );
}

function MoveActions() {
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
      <Button variant="ghost" size="icon-sm" onClick={() => reset()} title="Clear the board">
        <RotateCcw className="size-3.5" />
      </Button>
    </>
  );
}

function StatusBar() {
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

