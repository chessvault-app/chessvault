import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { getNode } from '@shared/tree';
import { Board } from '@/board/Board';
import { PromotionPicker } from '@/board/PromotionPicker';
import { fromDrawShapes, toDrawShapes } from '@/board/shapes';
import { EvalBar } from '@/engine/EvalBar';
import { toWhitePov } from '@/engine/uci';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';

/**
 * The complete board column driven by the analysis store: eval bar, board with
 * user shapes + engine arrow, promotion picker, navigation controls. Analysis
 * and Studies render exactly this; they differ only in their side columns.
 */
export function AnalysisBoard() {
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

  const engineOn = useEngine((s) => s.enabled);
  const engineLines = useEngine((s) => s.lines);
  const engineFen = useEngine((s) => s.resultFen);

  // Only trust engine output that belongs to the position on screen, otherwise
  // a late message paints the previous position's arrow and eval.
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
  );
}

export function BoardControls() {
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
