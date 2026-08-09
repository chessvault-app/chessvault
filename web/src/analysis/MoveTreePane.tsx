import { useEffect, useRef } from 'react';
import { ArrowUpToLine } from 'lucide-react';
import { blackToMoveAtRoot, getNode, isOnMainline, moveNumberLabel } from '@shared/tree';
import type { MoveNode, MoveTree, NodeId } from '@shared/types';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';

/** Glyphs for the NAGs a study realistically uses. */
export const NAG_GLYPH: Record<number, string> = {
  1: '!',
  2: '?',
  // Standard ASCII pairs, matching the board badges (BOARD_NAGS) so a move's
  // mark reads identically in the tree and on the board.
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
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

/** Colour for the quality NAGs, matching board badges and the eval graph. */
const NAG_CLASS: Record<number, string> = {
  1: 'text-nag-good',
  2: 'text-nag-mistake',
  3: 'text-nag-brilliant',
  4: 'text-nag-blunder',
  5: 'text-nag-interesting',
  6: 'text-nag-dubious',
};

const nagText = (nags: number[]): string => nags.map((n) => NAG_GLYPH[n] ?? `$${n}`).join('');
const nagClass = (nags: number[]): string | undefined => {
  const quality = nags.find((n) => NAG_CLASS[n]);
  return quality ? NAG_CLASS[quality] : undefined;
};

const FIGURINE: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };

/** SAN with figurines — uppercase piece letters never mean anything else. */
export const figurine = (san: string): string => san.replace(/[KQRBN]/g, (m) => FIGURINE[m]!);

/**
 * The move list, lichess-style (lanph3re's mock): the mainline is a table —
 * number gutter, White's cell, Black's cell — and comments/variations
 * interrupt it as full-width rows, with `…` continuation cells picking the
 * move pair back up. Inside variations the old inline flow remains.
 */
export function MoveTreePane({ className }: { className?: string }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const setCursor = useAnalysis((s) => s.setCursor);
  const promoteNode = useAnalysis((s) => s.promoteNode);
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the active move visible as the user walks the line.
  useEffect(() => {
    scroller.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursorId]);

  const root = getNode(tree, tree.rootId);
  const isEmpty = root.children.length === 0;

  return (
    <>
      <div
        ref={scroller}
        // The floor keeps a few lines of moves visible even when the whole
        // panel is squeezed by a short viewport; the panel's minimum height
        // follows it, pushing its column into scroll instead of clipping.
        className={cn('min-h-24 flex-1 overflow-y-auto text-sm leading-relaxed', className)}
      >
        {isEmpty ? (
          <p className="text-subtle px-2 py-6 text-center text-xs">
            Play a move on the board, or load a FEN or PGN.
          </p>
        ) : (
          <MainlineTable tree={tree} cursorId={cursorId} onSelect={setCursor} />
        )}
      </div>
      <PromoteStrip tree={tree} cursorId={cursorId} onPromote={(id) => promoteNode(id, true)} />
    </>
  );
}

interface RowState {
  number: number;
  white: { id: NodeId; node: MoveNode } | 'ellipsis' | null;
  black: { id: NodeId; node: MoveNode } | 'ellipsis' | null;
}

export function MainlineTable({
  tree,
  cursorId,
  onSelect,
}: {
  tree: MoveTree;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
}) {
  const out: React.ReactNode[] = [];
  let row: RowState | null = null;
  const blackFirst = blackToMoveAtRoot(tree);

  const flushRow = (): void => {
    if (!row) return;
    const { number, white, black } = row;
    out.push(
      <div
        key={`row-${number}-${typeof white === 'object' && white ? white.id : 'w'}-${typeof black === 'object' && black ? black.id : 'b'}`}
        className="border-line/60 grid grid-cols-[2rem_1fr_1fr] border-b"
      >
        <span className="bg-surface-inset/60 border-line/60 text-subtle flex items-center justify-center border-r font-mono text-[0.6875rem]">
          {number}
        </span>
        <MoveCell entry={white} cursorId={cursorId} onSelect={onSelect} />
        <MoveCell entry={black} cursorId={cursorId} onSelect={onSelect} />
      </div>,
    );
    row = null;
  };

  let cursor: NodeId | undefined = tree.rootId;
  while (cursor) {
    const node = getNode(tree, cursor);
    const [mainChildId, ...variationIds] = node.children;
    if (!mainChildId) break;
    const child = getNode(tree, mainChildId);
    const effectivePly = child.ply + (blackFirst ? 1 : 0);
    const number = Math.ceil(effectivePly / 2);
    const isWhite = effectivePly % 2 === 1;

    if (isWhite) {
      flushRow();
      row = { number, white: { id: mainChildId, node: child }, black: null };
    } else if (row) {
      row.black = { id: mainChildId, node: child };
    } else {
      row = { number, white: 'ellipsis', black: { id: mainChildId, node: child } };
    }

    const interrupts = Boolean(child.comment) || variationIds.length > 0;
    if (interrupts) {
      // The pair resumes on its own row after the interruption ("2 c4 …" /
      // "2 … e6"), the same convention as PGN and lichess.
      if (isWhite && row) row.black = 'ellipsis';
      flushRow();

      if (child.comment) {
        out.push(
          <p
            key={`${mainChildId}-comment`}
            className="border-line/60 bg-surface-inset/40 text-muted whitespace-pre-line border-b px-2.5 py-1.5 text-xs leading-relaxed"
          >
            {child.comment}
          </p>,
        );
      }
      for (const variationId of variationIds) {
        out.push(
          <div
            key={`var-${variationId}`}
            className="border-line/60 text-muted flex flex-wrap items-baseline gap-x-1 gap-y-0.5 border-b py-1 pl-6 pr-2 text-[0.8125rem]"
          >
            <VariationBranch
              tree={tree}
              startId={variationId}
              cursorId={cursorId}
              onSelect={onSelect}
            />
          </div>,
        );
      }
    } else if (!isWhite) {
      flushRow();
    }

    cursor = mainChildId;
  }
  flushRow();

  return <div>{out}</div>;
}

function MoveCell({
  entry,
  cursorId,
  onSelect,
}: {
  entry: { id: NodeId; node: MoveNode } | 'ellipsis' | null;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
}) {
  if (entry === null) return <span />;
  if (entry === 'ellipsis') {
    return <span className="text-subtle flex items-center px-3 py-1">…</span>;
  }
  const { id, node } = entry;
  const active = id === cursorId;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      data-active={active}
      className={cn(
        'flex items-baseline gap-1 px-3 py-1 text-left font-medium transition-colors duration-100',
        active ? 'bg-primary text-primary-fg' : 'hover:bg-surface-2',
      )}
    >
      <span>{figurine(node.san ?? '?')}</span>
      {node.nags.length > 0 && (
        <span className={cn('font-semibold', !active && nagClass(node.nags))}>
          {nagText(node.nags)}
        </span>
      )}
    </button>
  );
}

interface LineProps {
  tree: MoveTree;
  fromId: NodeId;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  /** True when the caller already rendered the move this line continues. */
  continued?: boolean;
}

/**
 * The visible promotion affordance: a full-width strip pinned under the
 * moves table whenever the CURRENT position sits on a side line. The
 * inline row buttons stay for direct manipulation; this one is the one
 * you cannot miss.
 */
export function PromoteStrip({
  tree,
  cursorId,
  onPromote,
}: {
  tree: MoveTree;
  cursorId: NodeId;
  onPromote: (id: NodeId) => void;
}) {
  if (isOnMainline(tree, cursorId)) return null;
  return (
    <button
      type="button"
      onClick={() => onPromote(cursorId)}
      className="bg-primary/10 text-primary hover:bg-primary/20 border-line flex w-full shrink-0 items-center justify-center gap-1.5 border-t px-3 py-1.5 text-xs font-medium transition-colors duration-100"
    >
      <ArrowUpToLine className="size-3.5" />
      Make mainline
    </button>
  );
}

/**
 * Inline rendering for variations, mirroring PGN's own shape: the first
 * child continues inline, and every further child becomes a parenthesised
 * variation rendered as a nested block.
 */
function Line({ tree, fromId, cursorId, onSelect, continued = false }: LineProps) {
  const items: React.ReactNode[] = [];
  let cursor: NodeId | undefined = fromId;
  const blackFirst = blackToMoveAtRoot(tree);
  // A comment or variation breaks the run of moves, so the next move needs its
  // number repeated to stay readable — the same convention PGN and Lichess use.
  let flowInterrupted = !continued;

  while (cursor) {
    const node = getNode(tree, cursor);
    const [mainChildId, ...variationIds] = node.children;
    if (!mainChildId) break;

    const child = getNode(tree, mainChildId);
    // White's moves always carry a number; Black's only after an interruption.
    const showNumber = (child.ply + (blackFirst ? 1 : 0)) % 2 === 1 || flowInterrupted;
    flowInterrupted = false;

    items.push(
      <MoveChip
        key={mainChildId}
        label={child.san ?? '?'}
        number={showNumber ? moveNumberLabel(child.ply, blackFirst) : undefined}
        nags={child.nags}
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
          className="text-subtle border-line my-1 basis-full whitespace-pre-line border-l-2 pl-2 text-[0.6875rem] italic"
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
            // Deeper variations dim further so the parent line stays readable.
            'text-subtle text-[0.8125rem]',
          )}
        >
          <VariationBranch
            tree={tree}
            startId={variationId}
            cursorId={cursorId}
            onSelect={onSelect}
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
}: {
  tree: MoveTree;
  startId: NodeId;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
}) {
  const node = getNode(tree, startId);
  return (
    <>
      <MoveChip
        label={node.san ?? '?'}
        number={moveNumberLabel(node.ply, blackToMoveAtRoot(tree))}
        nags={node.nags}
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
      <Line
        tree={tree}
        fromId={startId}
        cursorId={cursorId}
        onSelect={onSelect}
        continued={!node.comment}
      />
    </>
  );
}

interface MoveChipProps {
  label: string;
  number?: string;
  nags: number[];
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
        {figurine(label)}
        {nags.length > 0 && (
          <span className={cn('ml-px font-semibold', !active && nagClass(nags))}>
            {nagText(nags)}
          </span>
        )}
        {hasComment && (
          <span
            className={cn(
              'ml-1 inline-block size-1 rounded-full align-middle',
              active ? 'bg-primary-fg/70' : 'bg-info',
            )}
            title="Has a comment"
          />
        )}
      </button>
    </span>
  );
}
