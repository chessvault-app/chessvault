import { Loader2, Microscope, X } from 'lucide-react';
import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';
import { useReview, type GraphPoint } from '@/store/review';
import { Button } from '@/ui/Button';
import { SideDot } from '@/ui/SideDot';
import type { SideSummary } from './review';

/**
 * Trigger for the engine review — lives in the Moves panel header, costs
 * one icon. Judgments land as NAGs on the moves themselves; the summary
 * and evaluation graph appear in the ReviewStrip under the move list.
 */
export function ReviewButton() {
  const status = useReview((s) => s.status);
  const run = useReview((s) => s.run);
  const hasMoves = useAnalysis((s) => getRootHasMoves(s));

  if (!hasMoves) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={status === 'running'}
      title="Engine review — judge every move (?!/?/??) and measure accuracy"
      onClick={() => void run()}
    >
      {status === 'running' ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Microscope className="size-3.5" />
      )}
    </Button>
  );
}

function getRootHasMoves(s: { tree: { rootId: string; nodes: unknown } }): boolean {
  // Cheap check without importing tree helpers: the root node's children.
  const nodes = s.tree.nodes as Record<string, { children: string[] }>;
  return (nodes[s.tree.rootId]?.children.length ?? 0) > 0;
}

/**
 * Review progress, evaluation graph and per-side summary, docked under
 * the move list (lanph3re's call). Renders nothing until a review starts.
 */
export function ReviewStrip() {
  const status = useReview((s) => s.status);
  const progress = useReview((s) => s.progress);
  const white = useReview((s) => s.white);
  const black = useReview((s) => s.black);
  const points = useReview((s) => s.points);
  const error = useReview((s) => s.error);
  const clear = useReview((s) => s.clear);

  if (status === 'idle') return null;

  return (
    <div className="border-line shrink-0 border-t">
      {status === 'running' ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-subtle text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
            Reviewing
          </span>
          <div className="bg-surface-inset h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="text-subtle w-9 text-right font-mono text-[0.6875rem] tabular-nums">
            {Math.round(progress * 100)}%
          </span>
        </div>
      ) : status === 'error' ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-bad min-w-0 flex-1 truncate text-xs">{error}</span>
          <Button variant="ghost" size="icon-sm" title="Dismiss" onClick={clear}>
            <X className="size-3" />
          </Button>
        </div>
      ) : (
        <>
          {points && points.length > 1 && <EvalGraph points={points} />}
          <div className="flex items-center gap-1 px-3 py-1.5">
            <div className="grid min-w-0 flex-1 gap-0.5">
              {white && <SummaryRow side="white" summary={white} />}
              {black && <SummaryRow side="black" summary={black} />}
            </div>
            <Button variant="ghost" size="icon-sm" title="Dismiss review" onClick={clear}>
              <X className="size-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const GRAPH_W = 100;
const GRAPH_H = 28;

/**
 * Winning-chances area chart, lichess-style: white's share fills from the
 * bottom, the midline is equality. Click or drag to jump to a position;
 * the cursor's ply is marked.
 */
function EvalGraph({ points }: { points: GraphPoint[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const cursorId = useAnalysis((s) => s.cursorId);
  const setCursor = useAnalysis((s) => s.setCursor);
  const nodes = useAnalysis((s) => s.tree.nodes as Record<string, unknown>);

  const x = (i: number): number => (i / (points.length - 1)) * GRAPH_W;
  const y = (chances: number): number => (1 - chances) * GRAPH_H;

  const area =
    `M 0 ${GRAPH_H} ` +
    points.map((p, i) => `L ${x(i).toFixed(2)} ${y(p.chances).toFixed(2)}`).join(' ') +
    ` L ${GRAPH_W} ${GRAPH_H} Z`;

  const cursorIndex = points.findIndex((p) => p.id === cursorId);

  const scrub = (e: React.PointerEvent<SVGSVGElement>): void => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const target = points[Math.round(fraction * (points.length - 1))];
    // The tree may have been edited since the review ran; never navigate
    // to a node that no longer exists.
    if (target && nodes[target.id] && target.id !== useAnalysis.getState().cursorId) {
      setCursor(target.id);
    }
  };

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
      preserveAspectRatio="none"
      className="bg-surface-inset block h-16 w-full cursor-crosshair touch-none select-none"
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic events can carry unknown pointer ids; scrubbing
          // still works, only drag-capture is lost.
        }
        scrub(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) scrub(e);
      }}
      role="slider"
      aria-label="Evaluation graph — click to jump to a move"
    >
      <path d={area} fill="var(--color-eval-white)" opacity="0.85" />
      {/* Equality midline. */}
      <line
        x1="0"
        y1={GRAPH_H / 2}
        x2={GRAPH_W}
        y2={GRAPH_H / 2}
        stroke="var(--color-eval-border)"
        strokeWidth="0.4"
        strokeDasharray="1.5 1.5"
        vectorEffect="non-scaling-stroke"
      />
      {cursorIndex >= 0 && (
        <line
          x1={x(cursorIndex)}
          y1="0"
          x2={x(cursorIndex)}
          y2={GRAPH_H}
          stroke="var(--color-primary)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function SummaryRow({ side, summary }: { side: 'white' | 'black'; summary: SideSummary }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <SideDot side={side} />
      <span className="text-fg w-12 font-mono font-semibold tabular-nums">
        {summary.accuracy.toFixed(1)}%
      </span>
      <span className="text-subtle font-mono text-[0.6875rem] tabular-nums">
        {summary.acpl} acpl
      </span>
      <span className="text-subtle ml-auto flex gap-2 font-mono text-[0.6875rem] tabular-nums">
        <Judged count={summary.inaccuracies} glyph="?!" className="text-nag-dubious" />
        <Judged count={summary.mistakes} glyph="?" className="text-nag-mistake" />
        <Judged count={summary.blunders} glyph="??" className="text-nag-blunder" />
      </span>
    </div>
  );
}

function Judged({ count, glyph, className }: { count: number; glyph: string; className: string }) {
  return (
    <span className={cn(count === 0 ? 'text-subtle/50' : className)}>
      {count}
      {glyph}
    </span>
  );
}
