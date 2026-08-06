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
import { getNode, pathTo } from '@shared/tree';
import { BOARD_MAX_W } from '@/board/boardSize';
import { cn } from '@/lib/cn';
import { Board } from '@/board/Board';
import { PromotionPicker } from '@/board/PromotionPicker';
import { fromDrawShapes, toDrawShapes } from '@/board/shapes';
import { EvalBar } from '@/engine/EvalBar';
import { toWhitePov } from '@/engine/uci';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { SideDot } from '@/ui/SideDot';

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
  const hasGame = useAnalysis((s) => s.gameHeaders) !== null;

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
    // Top-anchored, not centred: the board must sit at the same y in every
    // view regardless of what each stacks below it.
    <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
      {/* Bounded by the shared budget so the board is the same size in every
          view — see boardSize.ts. */}
      <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
        {/* Small screens: the eval bar lies flat above the board instead of
            stealing width beside it — the board is the scarce resource. */}
        {engineOn && (
          <EvalBar score={evalScore} orientation="horizontal" className="shrink-0 wide:hidden" />
        )}
        {/* Fixed-height strip, matching the editor's palette strip: the board
            top stays put whether or not a player bar is shown. On phones the
            strip only exists when there is a player bar to show. */}
        <div className={cn('w-full items-end wide:flex wide:h-10', hasGame ? 'flex' : 'hidden wide:flex')}>
          <PlayerBar side={orientation === 'white' ? 'black' : 'white'} />
        </div>
        <div className="flex w-full items-stretch gap-2">
          {engineOn && <EvalBar score={evalScore} className="shrink-0 stacked:hidden" />}
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
            <NagBadge node={node} orientation={orientation} />
          </div>
        </div>
        <PlayerBar side={orientation} />
      </div>
      <BoardControls />
    </div>
  );
}

/** Move-quality NAGs drawn on the board, coloured via the --nag-* tokens. */
const BOARD_NAGS: Record<number, { glyph: string; className: string }> = {
  1: { glyph: '!', className: 'bg-nag-good' },
  2: { glyph: '?', className: 'bg-nag-mistake' },
  3: { glyph: '!!', className: 'bg-nag-brilliant' },
  4: { glyph: '??', className: 'bg-nag-blunder' },
  5: { glyph: '!?', className: 'bg-nag-interesting' },
  6: { glyph: '?!', className: 'bg-nag-dubious' },
};

/**
 * Badge pinned to the destination square's top-right corner when the move on
 * screen carries a quality NAG — the annotation is visible on the board
 * itself, not only in the move list.
 */
function NagBadge({
  node,
  orientation,
}: {
  node: { uci?: string; nags: number[] };
  orientation: 'white' | 'black';
}) {
  const nag = node.nags.find((n) => BOARD_NAGS[n]);
  if (!nag || !node.uci || node.uci.length < 4) return null;
  const badge = BOARD_NAGS[nag]!;

  const dest = node.uci.slice(2, 4);
  const file = dest.charCodeAt(0) - 97;
  const rank = dest.charCodeAt(1) - 49;
  const column = orientation === 'white' ? file : 7 - file;
  const rowFromTop = orientation === 'white' ? 7 - rank : rank;

  return (
    <span
      aria-hidden
      style={{
        left: `calc(${(column + 1) * 12.5}% - 0.85rem)`,
        top: `calc(${rowFromTop * 12.5}% - 0.4rem)`,
      }}
      className={cn(
        'pointer-events-none absolute z-30 grid size-6 place-items-center rounded-full',
        'text-nag-fg text-sm font-bold shadow-md',
        badge.className,
      )}
    >
      {badge.glyph}
    </span>
  );
}

/** "0:09:58.1" style seconds → "9:58"; hours only when they exist. */
function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Name plate for one side of a loaded game: player, rating, and the clock as
 * it stood at the current move (from the [%clk] comments chess.com and
 * lichess write). Renders nothing for scratch analysis.
 */
function PlayerBar({ side }: { side: 'white' | 'black' }) {
  const headers = useAnalysis((s) => s.gameHeaders);
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  if (!headers) return null;

  const name = headers[side === 'white' ? 'White' : 'Black'] ?? '?';
  const elo = headers[side === 'white' ? 'WhiteElo' : 'BlackElo'];

  // The side's clock after its most recent move at or before the cursor.
  let clock: number | undefined;
  for (const id of pathTo(tree, cursorId)) {
    const n = getNode(tree, id);
    // Odd plies are White's moves.
    if (n.clock !== undefined && (n.ply % 2 === 1) === (side === 'white')) clock = n.clock;
  }

  const turn = getNode(tree, cursorId).fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const toMove = turn === side;

  return (
    <div className="flex h-6 w-full items-center gap-2 px-0.5">
      <SideDot side={side} />
      <span className="text-fg min-w-0 truncate text-sm font-medium">{name}</span>
      {elo && <span className="text-subtle text-xs">{elo}</span>}
      {clock !== undefined && (
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-0.5 font-mono text-xs tabular-nums',
            toMove ? 'bg-primary-soft text-primary font-semibold' : 'text-muted',
          )}
        >
          {formatClock(clock)}
        </span>
      )}
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
