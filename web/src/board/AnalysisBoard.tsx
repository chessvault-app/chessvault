import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { getNode, pathTo } from '@shared/tree';
import { BOARD_MAX_W } from '@/board/boardSize';
import { playSound, soundForSan } from '@/board/sound';
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
export function AnalysisBoard({ editablePlayers = false }: { editablePlayers?: boolean } = {}) {
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

  // Every rendered move sounds — played AND replayed — like lichess. The
  // ref skips the mount so opening a study mid-game stays quiet.
  const lastCursor = useRef<string | null>(null);
  useEffect(() => {
    if (lastCursor.current !== null && lastCursor.current !== cursorId && node.san) {
      playSound(soundForSan(node.san));
    }
    lastCursor.current = cursorId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorId]);

  // Mouse wheel over the board steps through the game. Registered manually:
  // React's synthetic wheel listener is passive, so it cannot stop the page
  // from scrolling underneath.
  const boardColumn = useRef<HTMLDivElement>(null);
  const goBack = useAnalysis((s) => s.goBack);
  const goForward = useAnalysis((s) => s.goForward);
  useEffect(() => {
    const el = boardColumn.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // Accumulate so trackpads (many tiny deltas) step at a sane rate.
      acc += e.deltaY;
      if (acc > 24) {
        goForward();
        acc = 0;
      } else if (acc < -24) {
        goBack();
        acc = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [goBack, goForward]);

  return (
    // Top-anchored, not centred: the board must sit at the same y in every
    // view regardless of what each stacks below it.
    <div
      ref={boardColumn}
      className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start"
    >
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
        <div className={cn('w-full items-end wide:flex wide:h-10', hasGame || editablePlayers ? 'flex' : 'hidden wide:flex')}>
          <PlayerBar side={orientation === 'white' ? 'black' : 'white'} editable={editablePlayers} />
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
        <PlayerBar side={orientation} editable={editablePlayers} />
      </div>
      {/* Stacked layouts keep navigation under the board (the side pane may
          be showing Explorer, and touch has neither wheel nor arrow keys).
          EVERY side-by-side layout uses the copy in the Moves panel instead
          (lanph3re: the under-board toolbar looked stray at medium widths). */}
      <BoardControls className="wide:hidden" />
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
function PlayerBar({ side, editable = false }: { side: 'white' | 'black'; editable?: boolean }) {
  const headers = useAnalysis((s) => s.gameHeaders);
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  if (!headers && !editable) return null;

  const name = headers?.[side === 'white' ? 'White' : 'Black'] ?? '?';
  // Editable placeholders (the Board tab): typed names live in the same
  // gameHeaders the loaded games use, so PGN export picks them up.
  const setName = (value: string): void => {
    const key = side === 'white' ? 'White' : 'Black';
    const next = { ...(useAnalysis.getState().gameHeaders ?? {}) };
    const v = value.trim();
    if (v) next[key] = v;
    else delete next[key];
    useAnalysis.setState({ gameHeaders: Object.keys(next).length > 0 ? next : null });
  };
  const elo = headers?.[side === 'white' ? 'WhiteElo' : 'BlackElo'];

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
      {editable ? (
        <input
          key={name}
          type="text"
          defaultValue={name === '?' ? '' : name}
          placeholder={side === 'white' ? 'White' : 'Black'}
          spellCheck={false}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="text-fg placeholder:text-subtle min-w-0 flex-1 truncate bg-transparent text-sm font-medium outline-none"
        />
      ) : (
        <span className="text-fg min-w-0 truncate text-sm font-medium">{name}</span>
      )}
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

export function BoardControls({
  className,
  keyboard = true,
}: {
  className?: string;
  /** Exactly one rendered instance may own the arrow-key listener. */
  keyboard?: boolean;
}) {
  const goToStart = useAnalysis((s) => s.goToStart);
  const goBack = useAnalysis((s) => s.goBack);
  const goForward = useAnalysis((s) => s.goForward);
  const goToEnd = useAnalysis((s) => s.goToEnd);
  const flip = useAnalysis((s) => s.flip);

  // Arrow keys should drive the board from anywhere except a text field.
  useEffect(() => {
    if (!keyboard) return;
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
  }, [keyboard, goBack, goForward, goToStart, goToEnd, flip]);

  return (
    <div className={cn('flex w-full shrink-0 items-center justify-center gap-1 py-1', className)}>
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
