import { BookOpen, ChevronDown, Crown, Microscope, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAnalysis } from '@/store/analysis';
import { useReview, type GraphPoint } from '@/store/review';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SideDot } from '@/components/side-dot';
import type { SideSummary } from './review';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';

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
      title={t('Engine review: judge every move (?!/?/??) and measure accuracy')}
      onClick={() => void run()}
    >
      {status === 'running' ? (
        <Spinner className="size-3.5" />
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
export function ReviewStrip({
  panel = false,
  className,
}: {
  /**
   * Hosted as a panel's own content (the workspace's Analysis panel)
   * rather than docked under a move list. The panel's header carries a
   * fold of its own, so the strip's graph-fold and dismiss buttons go —
   * two closes one above the other were closing different things — and
   * the graph draws taller, because a panel has the room a moves panel's
   * foot never did. The error state keeps its X: that one clears a
   * failure, not the panel. Opt-in from the caller; the board pages are
   * unchanged.
   */
  panel?: boolean;
  className?: string;
} = {}) {
  const status = useReview((s) => s.status);
  // Folded state outlives one review: someone who does not want the graph
  // does not want it again on the next game either.
  const [graphOpen, setGraphOpen] = useState(() => localStorage.getItem(GRAPH_FOLD) !== 'closed');
  const toggleGraph = (): void => {
    setGraphOpen((open) => {
      localStorage.setItem(GRAPH_FOLD, open ? 'closed' : 'open');
      return !open;
    });
  };
  const progress = useReview((s) => s.progress);
  const white = useReview((s) => s.white);
  const black = useReview((s) => s.black);
  const points = useReview((s) => s.points);
  const error = useReview((s) => s.error);
  const clear = useReview((s) => s.clear);
  const run = useReview((s) => s.run);
  // The offer below: a whole game just opened, and the feature that
  // judges it was a 14px icon in a six-icon cluster nobody found.
  const gameHeaders = useAnalysis((s) => s.gameHeaders);
  const hasMoves = useAnalysis((s) => getRootHasMoves(s));
  // Dismissal is per game, by identity: the next loaded game offers again.
  const [offerDismissed, setOfferDismissed] = useState<unknown>(null);

  if (status === 'idle') {
    if (!gameHeaders || !hasMoves || offerDismissed === gameHeaders) return null;
    return (
      <div className={cn('border-border flex shrink-0 items-center gap-2 border-t px-3 py-2', className)}>
        {/* Wraps in a panel, truncates in the dock: the dock is a strip
            under a move list where one line is the budget, but a panel
            hosting this as its CONTENT was clipping its own sentence
            mid-word beside empty height (lanph3re's catch). */}
        <p className={cn('text-muted-foreground min-w-0 flex-1 text-sm', !panel && 'truncate')}>
          {t('See accuracy, mistakes and the evaluation graph.')}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void run()}>
          <Microscope className="size-3.5" data-icon="inline-start" />
          {t('Review game')}
        </Button>
        {!panel && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Close')}
            onClick={() => setOfferDismissed(gameHeaders)}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    // A shrinkable flex column, not shrink-0: this strip is the newest
    // band in a panel whose every other band refuses to shrink, and the
    // panel clips from the BOTTOM when its children outgrow it — so a
    // rigid strip did not lose itself to a short window, it lost the
    // navigation bar below it (measured at 1440x500 with the engine on:
    // BoardControls at y 484..525 in a panel clipped at 384). The graph
    // is the part that gives — see EvalGraph.
    //
    // The floor is stated EXPLICITLY, and both of its alternatives were
    // measured wrong. min-h-0 let the strip fold to 1px and paint its
    // summary rows over the controls; no min-height at all floored it at
    // its intrinsic minimum, which flexbox computes from the graph
    // wrapper's SPECIFIED 4rem, not from the 1.75rem it can shrink to —
    // so the strip never shrank. 6rem is the compressed graph plus the
    // two summary rows.
    <div
      className={cn(
        'border-border flex shrink flex-col border-t',
        // Only while the graph is actually drawn: progress and error are
        // single rows that a 5rem floor would inflate, and a FOLDED graph
        // left the same inflation as dead space under the summary rows
        // (lanph3re's screenshot). 5rem = the graph at its 1.5rem floor
        // + the two summary rows + the border, exactly — a floor an inch
        // over its contents just moves the clip onto the band below.
        status !== 'running' &&
          status !== 'error' &&
          points &&
          points.length > 1 &&
          (panel || graphOpen) &&
          'min-h-20',
        className,
      )}
    >
      {status === 'running' ? (
        <div className="flex shrink-0 items-center gap-2 px-3 py-2">
          <span className="text-muted-foreground text-sm font-medium">
            {t('Reviewing')}
          </span>
          <div className="bg-muted/50 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="text-muted-foreground w-9 text-right font-mono text-xs tabular-nums">
            {Math.round(progress * 100)}%
          </span>
        </div>
      ) : status === 'error' ? (
        <div className="flex shrink-0 items-center gap-2 px-3 py-2">
          <span className="text-destructive min-w-0 flex-1 truncate text-sm" role="alert">
            {error}
          </span>
          <Button variant="ghost" size="icon-sm" title={t('Close')} onClick={clear}>
            <X className="size-3" />
          </Button>
        </div>
      ) : (
        <>
          {/* A panel host always draws the graph: its fold pref belongs
              to the docked strip, and the panel's own fold covers "not
              now" without stranding the graph behind a hidden pref. */}
          {points && points.length > 1 && (panel || graphOpen) && (
            <EvalGraph points={points} tall={panel} />
          )}
          <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
            <div className="grid min-w-0 flex-1 gap-0.5">
              {white && <SummaryRow side="white" summary={white} />}
              {black && <SummaryRow side="black" summary={black} />}
            </div>
            {!panel && points && points.length > 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={graphOpen ? t('Hide the evaluation graph') : t('Show the evaluation graph')}
                onClick={toggleGraph}
              >
                <ChevronDown className={cn('size-3 transition-transform', graphOpen && 'rotate-180')} />
              </Button>
            )}
            {!panel && (
              <Button variant="ghost" size="icon-sm" title={t('Close the review')} onClick={clear}>
                <X className="size-3" />
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Where the fold is remembered, so it survives the next review. */
const GRAPH_FOLD = 'chess-vault.reviewGraph';

const GRAPH_W = 100;
const GRAPH_H = 28;

/**
 * Winning-chances area chart, lichess-style: white's share fills from the
 * bottom, the midline is equality. Click or drag to jump to a position;
 * the cursor's ply is marked, and the ply under the pointer is marked
 * too — a guide line and a grown dot, so the graph says "this is where
 * a click lands" before it is clicked. cursor-pointer for the same
 * reason: a crosshair promised measuring, and this surface only ever
 * navigates (lanph3re's call).
 */
function EvalGraph({ points, tall = false }: { points: GraphPoint[]; tall?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const cursorId = useAnalysis((s) => s.cursorId);
  const setCursor = useAnalysis((s) => s.setCursor);
  const nodes = useAnalysis((s) => s.tree.nodes as Record<string, unknown>);
  /** The ply the pointer is over — the one a click would jump to. */
  const [hover, setHover] = useState<number | null>(null);

  const x = (i: number): number => (i / (points.length - 1)) * GRAPH_W;
  const y = (chances: number): number => (1 - chances) * GRAPH_H;

  const outline = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.chances).toFixed(2)}`)
    .join(' ');
  const area = `M 0 ${GRAPH_H} ${outline.replace(/^M/, 'L')} L ${GRAPH_W} ${GRAPH_H} Z`;

  const cursorIndex = points.findIndex((p) => p.id === cursorId);

  const indexAt = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(fraction * (points.length - 1));
  };

  const scrub = (e: React.PointerEvent<SVGSVGElement>): void => {
    const i = indexAt(e);
    const target = i === null ? undefined : points[i];
    // The tree may have been edited since the review ran; never navigate
    // to a node that no longer exists.
    if (target && nodes[target.id] && target.id !== useAnalysis.getState().cursorId) {
      setCursor(target.id);
    }
  };

  return (
    // The band that gives when the panel is short: the WRAPPER carries
    // the height and a 1.75rem floor, and the svg fills it — sized the
    // other way round (a fixed-height svg inside), the svg's 4rem was
    // the strip's intrinsic minimum and the strip never shrank at all;
    // flexbox floors an item at its content's min size, and a floor on
    // the box the content merely fills is what that arithmetic can see.
    // The svg follows the wrapper down (preserveAspectRatio none
    // compresses the drawing rather than clipping it), because a
    // squashed graph is still a graph while a clipped panel loses its
    // navigation bar — the trade the strip's root explains.
    <div
      className={cn(
        'relative min-h-6 shrink overflow-hidden',
        // Taller where a panel hosts it (the workspace): the reading
        // surface is the whole panel, not a strip stealing move rows.
        tall ? 'h-24' : 'h-16',
      )}
    >
      <svg
        ref={svg}
        viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
        preserveAspectRatio="none"
        className="bg-muted/50 block h-full w-full cursor-pointer touch-none select-none"
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
          else setHover(indexAt(e));
        }}
        onPointerLeave={() => setHover(null)}
        // A slider in fact, not only in name: focusable, its value the
        // cursor's index along the points, and the arrows step it.
        role="slider"
        tabIndex={0}
        aria-label={t('Evaluation graph. Click to jump to a move.')}
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={Math.max(0, cursorIndex)}
        aria-valuetext={t('Position {n} of {total}', {
          n: Math.max(0, cursorIndex) + 1,
          total: points.length,
        })}
        onKeyDown={(e) => {
          const from = Math.max(0, cursorIndex);
          const last = points.length - 1;
          const to =
            e.key === 'ArrowLeft' || e.key === 'ArrowDown'
              ? from - 1
              : e.key === 'ArrowRight' || e.key === 'ArrowUp'
                ? from + 1
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? last
                    : null;
          if (to === null) return;
          // Handled here and nowhere else: the board's arrow keys listen
          // on the window and would step the game a second time.
          e.preventDefault();
          e.stopPropagation();
          const target = points[Math.min(last, Math.max(0, to))];
          if (target && nodes[target.id]) setCursor(target.id);
        }}
      >
        <path d={area} fill="var(--color-eval-white)" opacity="0.85" />
        {/* Thin line joining the move dots along the curve. */}
        <path
          d={outline}
          fill="none"
          stroke="var(--color-eval-border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {/* Equality line (eval 0.0). */}
        <line
          x1="0"
          y1={GRAPH_H / 2}
          x2={GRAPH_W}
          y2={GRAPH_H / 2}
          stroke="var(--color-border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {/* The hover guide: where a click would land. Over the area fill
            (it would be lost under it), thinner than the cursor's own
            line, and in the hovered dot's own info blue, so line and dot
            read as one "this one" and never as a second cursor. */}
        {hover !== null && hover !== cursorIndex && (
          <line
            x1={x(hover)}
            y1="0"
            x2={x(hover)}
            y2={GRAPH_H}
            stroke="var(--color-info)"
            strokeWidth="1"
            opacity="0.7"
            vectorEffect="non-scaling-stroke"
          />
        )}
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
      {/* Move dots live in an HTML overlay: the SVG is stretched
          non-uniformly, which would squash circles into ellipses. Judged
          moves wear their NAG colour; clean moves get neutral dots. */}
      <div className="pointer-events-none absolute inset-0">
        {points.map((p, i) =>
          i === 0 ? null : (
            <span
              key={p.id}
              style={{ left: `${(i / (points.length - 1)) * 100}%`, top: `${(1 - p.chances) * 100}%` }}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-75',
                // Shape as well as colour: a blunder is a diamond, a
                // mistake a square, an inaccuracy a circle — so the graph
                // still reads when the hues do not.
                p.nag === 4
                  ? 'bg-nag-blunder size-2 rotate-45 rounded-[1px]'
                  : p.nag === 2
                    ? 'bg-nag-mistake size-2 rounded-[1px]'
                    : p.nag === 6
                      ? 'bg-nag-dubious size-2 rounded-full'
                      : p.book
                        ? 'bg-nag-book size-1 rounded-full'
                        : 'bg-border size-1 rounded-full',
                i === cursorIndex && 'ring-primary ring-2',
                // The dot a click would land on grows AND recolours under
                // the pointer — the guide line says where, the dot says
                // "this one". Recoloured in the info blue the opening map
                // lights its mainline with (MapCanvas's ACCENT): primary
                // was tried first and is near-white in the neutral theme,
                // invisible on a chart whose dominant inks are already
                // white and black (lanph3re's report, twice).
                i === hover && 'bg-info scale-[1.8]',
              )}
            />
          ),
        )}
      </div>
    </div>
  );
}

function SummaryRow({ side, summary }: { side: 'white' | 'black'; summary: SideSummary }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <SideDot side={side} />
      <span className="text-foreground w-12 font-mono font-semibold tabular-nums">
        {summary.accuracy.toFixed(1)}%
      </span>
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {summary.acpl} acpl
      </span>
      <span className="text-muted-foreground ml-auto flex gap-2 font-mono text-xs tabular-nums">
        {/* No aria-label over the count: the number IS what this reads out,
            and Button's rule holds here too — a visible label is already
            the accessible name and must stay it. The sentence is what the
            hover adds. */}
        <TitleTip title={t('Book moves: known opening theory, not judged')}>
          <span
            className={cn(
              'flex items-center gap-0.5',
              summary.bookMoves === 0 ? 'text-muted-foreground/50' : 'text-muted-foreground',
            )}
          >
            {summary.bookMoves}
            <BookOpen className="size-3" />
          </span>
        </TitleTip>
        {/* Beside the book count, and for the same reason: both say that
            some of these moves were not the engine's to judge. Drawn only
            when there were any — an endgame under seven pieces is the
            exception, and a permanent 0 with a crown beside it would be a
            counter of nothing in every middlegame. */}
        {summary.tablebaseMoves > 0 && (
          <TitleTip title={t('Endgame moves judged against the tablebase, not the engine')}>
            <span className="text-muted-foreground flex items-center gap-0.5">
              {summary.tablebaseMoves}
              <Crown className="size-3" />
            </span>
          </TitleTip>
        )}
        <Judged count={summary.brilliancies} glyph="!!" className="text-nag-brilliant" />
        <Judged count={summary.inaccuracies} glyph="?!" className="text-nag-dubious" />
        <Judged count={summary.mistakes} glyph="?" className="text-nag-mistake" />
        <Judged count={summary.blunders} glyph="??" className="text-nag-blunder" />
      </span>
    </div>
  );
}

function Judged({ count, glyph, className }: { count: number; glyph: string; className: string }) {
  return (
    <span className={cn(count === 0 ? 'text-muted-foreground/50' : className)}>
      {count}
      {glyph}
    </span>
  );
}
