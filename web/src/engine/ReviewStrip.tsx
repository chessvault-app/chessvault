import { Loader2, Microscope, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';
import { useReview } from '@/store/review';
import { Button } from '@/ui/Button';
import { SideDot } from '@/ui/SideDot';
import type { SideSummary } from './review';

/**
 * Trigger for the engine review — lives in the Moves panel header, costs
 * one icon. Judgments land as NAGs on the moves themselves; the summary
 * appears in the ReviewStrip.
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
 * Review progress / summary, docked in the merged panel like the engine
 * block. Renders nothing until a review starts.
 */
export function ReviewStrip() {
  const status = useReview((s) => s.status);
  const progress = useReview((s) => s.progress);
  const white = useReview((s) => s.white);
  const black = useReview((s) => s.black);
  const error = useReview((s) => s.error);
  const clear = useReview((s) => s.clear);

  if (status === 'idle') return null;

  return (
    <div className="border-line shrink-0 border-b">
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
        <div className="flex items-center gap-1 px-3 py-1.5">
          <div className="grid min-w-0 flex-1 gap-0.5">
            {white && <SummaryRow side="white" summary={white} />}
            {black && <SummaryRow side="black" summary={black} />}
          </div>
          <Button variant="ghost" size="icon-sm" title="Dismiss review summary" onClick={clear}>
            <X className="size-3" />
          </Button>
        </div>
      )}
    </div>
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
