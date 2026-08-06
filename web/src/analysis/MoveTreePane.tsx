import { useEffect, useRef } from 'react';
import { getNode, moveNumberLabel } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';

/** Glyphs for the NAGs a study realistically uses. */
const NAG_GLYPH: Record<number, string> = {
  1: '!',
  2: '?',
  3: '‼',
  4: '⁇',
  5: '⁉',
  6: '⁈',
  7: '□',
  10: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+−',
  19: '−+',
  22: '⨀',
};

const nagText = (nags: number[]): string => nags.map((n) => NAG_GLYPH[n] ?? `$${n}`).join('');

export function MoveTreePane({ className }: { className?: string }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const setCursor = useAnalysis((s) => s.setCursor);
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the active move visible as the user walks the line.
  useEffect(() => {
    scroller.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursorId]);

  const root = getNode(tree, tree.rootId);
  const isEmpty = root.children.length === 0;

  return (
    <div
      ref={scroller}
      className={cn('min-h-0 flex-1 overflow-y-auto px-2 py-2 text-sm leading-relaxed', className)}
    >
      {isEmpty ? (
        <p className="text-subtle px-2 py-6 text-center text-xs">
          Play a move on the board, or load a FEN or PGN.
        </p>
      ) : (
        <Line
          tree={tree}
          fromId={tree.rootId}
          cursorId={cursorId}
          onSelect={setCursor}
          depth={0}
        />
      )}
    </div>
  );
}

interface LineProps {
  tree: MoveTree;
  fromId: NodeId;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  depth: number;
}

/**
 * Renders one line and its variations.
 *
 * Mirrors PGN's own shape: the first child continues inline, and every further
 * child becomes a parenthesised variation rendered as a nested block. The result
 * reads the same as the notation in the file on disk.
 */
function Line({ tree, fromId, cursorId, onSelect, depth }: LineProps) {
  const items: React.ReactNode[] = [];
  let cursor: NodeId | undefined = fromId;
  // A comment or variation breaks the run of moves, so the next move needs its
  // number repeated to stay readable — the same convention PGN and Lichess use.
  let flowInterrupted = true;

  while (cursor) {
    const node = getNode(tree, cursor);
    const [mainChildId, ...variationIds] = node.children;
    if (!mainChildId) break;

    const child = getNode(tree, mainChildId);
    // White's moves always carry a number; Black's only after an interruption.
    const showNumber = child.ply % 2 === 1 || flowInterrupted;
    flowInterrupted = false;

    items.push(
      <MoveChip
        key={mainChildId}
        label={child.san ?? '?'}
        number={showNumber ? moveNumberLabel(child.ply) : undefined}
        nags={nagText(child.nags)}
        hasComment={Boolean(child.comment)}
        active={mainChildId === cursorId}
        onClick={() => onSelect(mainChildId)}
      />,
    );

    // Comments render at every depth: in a notes vault, an annotation buried in
    // a variation is often the whole point of the variation.
    if (child.comment) {
      items.push(
        <p
          key={`${mainChildId}-comment`}
          className={cn(
            'border-line my-1 basis-full whitespace-pre-line border-l-2 pl-2 italic',
            depth === 0 ? 'text-muted text-xs' : 'text-subtle text-[0.6875rem]',
          )}
        >
          {child.comment}
        </p>,
      );
      flowInterrupted = true;
    }

    for (const variationId of variationIds) {
      items.push(
        <div
          key={`var-${variationId}`}
          className={cn(
            'my-1 flex basis-full flex-wrap items-baseline gap-x-1 gap-y-0.5',
            'border-line/70 border-l-2 pl-2',
            // Variations are dimmer than the mainline, and dimmer again the
            // deeper they nest, so the main line stays readable at a glance.
            depth === 0 ? 'text-muted' : 'text-subtle text-[0.8125rem]',
          )}
        >
          <VariationBranch
            tree={tree}
            startId={variationId}
            cursorId={cursorId}
            onSelect={onSelect}
            depth={depth + 1}
          />
        </div>,
      );
      flowInterrupted = true;
    }

    cursor = mainChildId;
  }

  return <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">{items}</div>;
}

/** A variation: its own first move, then the rest of that line. */
function VariationBranch({
  tree,
  startId,
  cursorId,
  onSelect,
  depth,
}: {
  tree: MoveTree;
  startId: NodeId;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  depth: number;
}) {
  const node = getNode(tree, startId);
  return (
    <>
      <MoveChip
        label={node.san ?? '?'}
        number={moveNumberLabel(node.ply)}
        nags={nagText(node.nags)}
        hasComment={Boolean(node.comment)}
        active={startId === cursorId}
        onClick={() => onSelect(startId)}
      />
      {/* The variation's own first move is rendered here rather than by `Line`,
          so its comment has to be emitted here too or it would be dropped. */}
      {node.comment && (
        <p className="text-subtle border-line my-1 basis-full whitespace-pre-line border-l-2 pl-2 text-[0.6875rem] italic">
          {node.comment}
        </p>
      )}
      <Line tree={tree} fromId={startId} cursorId={cursorId} onSelect={onSelect} depth={depth} />
    </>
  );
}

interface MoveChipProps {
  label: string;
  number?: string;
  nags: string;
  hasComment: boolean;
  active: boolean;
  onClick: () => void;
}

function MoveChip({ label, number, nags, hasComment, active, onClick }: MoveChipProps) {
  return (
    <span className="inline-flex items-baseline gap-1">
      {number && <span className="text-subtle font-mono text-[0.6875rem]">{number}</span>}
      <button
        type="button"
        onClick={onClick}
        data-active={active}
        className={cn(
          'rounded px-1 py-px font-medium transition-colors duration-100',
          'hover:bg-surface-3',
          active && 'bg-primary text-primary-fg hover:bg-primary',
        )}
      >
        {label}
        {nags && <span className="ml-px font-semibold">{nags}</span>}
        {hasComment && (
          <span
            className={cn('ml-1 inline-block size-1 rounded-full align-middle', active ? 'bg-primary-fg/70' : 'bg-info')}
            title="Has a comment"
          />
        )}
      </button>
    </span>
  );
}
