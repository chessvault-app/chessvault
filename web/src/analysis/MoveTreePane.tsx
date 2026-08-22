import { useEffect, useMemo, useRef } from 'react';
import { ArrowUpToLine, BookOpen, GitBranch } from 'lucide-react';
import { blackToMoveAtRoot, getNode, isOnMainline, moveNumberLabel, pathTo } from '@shared/tree';
import type { MoveNode, MoveTree, NodeId } from '@shared/types';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { scrollRowIntoPanel } from '@/lib/scroll';
import { useAnalysis } from '@/store/analysis';
import { useReview } from '@/store/review';
import { ANNOTATION_CLASS, usePrefs } from '@/store/prefs';
import { useBookTags } from '@/lib/opening';
import { t } from '@/lib/i18n';

import { figurine, NAG_GLYPH } from './notation';

/** Colour for the quality NAGs, matching board badges and the eval graph. */
const NAG_CLASS: Record<number, string> = {
  1: 'text-nag-good',
  2: 'text-nag-mistake',
  3: 'text-nag-brilliant',
  4: 'text-nag-blunder',
  5: 'text-nag-interesting',
  6: 'text-nag-dubious',
};

/**
 * A full-width comment row in the mainline table — the chapter introduction
 * at the top, and every comment that interrupts a move pair below it.
 *
 * `leading-relaxed` AFTER the size: cn merges Tailwind, and a font size
 * dropping an earlier line height is exactly what it is for — put it first
 * and the comment reads at the size's own tighter leading (measured:
 * 14px/20px instead of 14px/22.75px).
 *
 * `break-words` because an annotation is not prose we control: paste a URL,
 * an engine line or a run of keyboard mash and the line breaker sees ONE
 * word, which pushed the whole panel into horizontal scroll (lanph3re's
 * report) rather than wrapping.
 */
const commentRow = (size: string): string =>
  cn(
    'border-line/60 bg-surface-inset/40 text-muted break-words whitespace-pre-line border-b px-2.5 py-1.5',
    size,
    'leading-relaxed',
  );

const nagText = (nags: number[]): string => nags.map((n) => NAG_GLYPH[n] ?? `$${n}`).join('');
const nagClass = (nags: number[]): string | undefined => {
  const quality = nags.find((n) => NAG_CLASS[n]);
  return quality ? NAG_CLASS[quality] : undefined;
};

/** Whether the tree branches at all — the control is noise on a game that never does. */
function hasSidelines(tree: MoveTree): boolean {
  return Object.values(tree.nodes).some((node) => node.children.length > 1);
}

/**
 * Show only the line the cursor is on.
 *
 * Lives in the moves panel's HEADER, beside the other things that act on
 * the whole list, rather than taking a row of its own above the moves —
 * a strip of chrome over a list is a strip of moves you cannot see, and
 * on a phone the list is already the shortest panel on the page.
 *
 * Renders nothing when the game has no side lines: a control that can
 * only ever be a no-op is worse than an absent one, because it invites
 * the press that proves it does nothing.
 */
export function SidelinesToggle() {
  const tree = useAnalysis((s) => s.tree);
  const on = useAnalysis((s) => s.currentLineOnly);
  const toggle = useAnalysis((s) => s.toggleCurrentLineOnly);
  const branching = useMemo(() => hasSidelines(tree), [tree]);
  if (!branching) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      active={on}
      onClick={toggle}
      aria-pressed={on}
      title={on ? t('Showing the current line only') : t('Show the current line only')}
      aria-label={on ? t('Showing the current line only') : t('Show the current line only')}
    >
      <GitBranch className="size-3.5" />
    </Button>
  );
}

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
  const currentLineOnly = useAnalysis((s) => s.currentLineOnly);
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the active move visible as the user walks the line, along with
  // the comment written under it — and without moving the page.
  useEffect(() => {
    scrollRowIntoPanel(
      scroller.current,
      scroller.current?.querySelector('[data-active="true"]') ?? null,
    );
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
        className={cn(
          // min-h-0 below lg, NOT a fixed floor: the move table must be able
          // to yield space to the annotation editor beneath it. Panel clips
          // its overflow, so a floor here pushed the editor out of the panel
          // entirely — visible on game pages, which spend ~56px more than a
          // study on the two player bars.
          'min-h-0 flex-1 overflow-y-auto text-base leading-relaxed lg:min-h-24',
          className,
        )}
      >
        {/* An introduction with no moves under it yet is still the chapter's
            text, so the table renders for it alone; the hint stays, under it,
            because the chapter is still empty of moves. */}
        {(!isEmpty || root.comment) && (
          <MainlineTable
            tree={tree}
            cursorId={cursorId}
            onSelect={setCursor}
            currentLineOnly={currentLineOnly}
          />
        )}
        {isEmpty && (
          <p className="text-subtle px-3 py-6 text-center text-sm">
            {t('Play a move on the board, or load a FEN or PGN.')}
          </p>
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
  currentLineOnly = false,
}: {
  tree: MoveTree;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  /** Hide every branch that is not on the way to the cursor. */
  currentLineOnly?: boolean;
}) {
  // The way to the current move. In reading mode a side line the cursor
  // is not in does not exist; walking into one therefore reveals it, and
  // its continuation, without leaving the mode.
  const onPath = useMemo(() => new Set(pathTo(tree, cursorId)), [tree, cursorId]);

  // Book moves, live from the opening catalogue — every branch, not just
  // the mainline, so a variation that stays in (or transposes into)
  // theory is tagged too. Never written to the tree: there is no PGN NAG
  // for "book", so the tag is derived state, not an annotation. Deferred
  // until a review has run (and hidden again when it is dismissed or a
  // new game clears it): the tag explains why theory went unjudged, and
  // before any judgment exists it is clutter.
  const reviewed = useReview((s) => s.points !== null);
  const bookIds = useBookTags(tree, reviewed);
  const annotation = ANNOTATION_CLASS[usePrefs((s) => s.annotationSize)];
  const keep = (ids: NodeId[]): NodeId[] =>
    currentLineOnly ? ids.filter((id) => onPath.has(id)) : ids;

  const out: React.ReactNode[] = [];

  // The root's own comment is the chapter introduction (a game's notes). It
  // hangs off no move — it describes the position before the first ply — and
  // the walk below only ever reads CHILDREN, so it was written, saved to the
  // vault, reloaded and never shown again. It renders once, above the table.
  const rootComment = getNode(tree, tree.rootId).comment;
  if (rootComment) {
    out.push(
      <p
        key="root-comment"
        className={commentRow(annotation.mainline)}
      >
        {rootComment}
      </p>,
    );
  }

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
        <span className="bg-surface-inset/60 border-line/60 text-subtle flex items-center justify-center border-r font-mono text-xs">
          {number}
        </span>
        <MoveCell entry={white} cursorId={cursorId} onSelect={onSelect} bookIds={bookIds} />
        <MoveCell entry={black} cursorId={cursorId} onSelect={onSelect} bookIds={bookIds} />
      </div>,
    );
    row = null;
  };

  let cursor: NodeId | undefined = tree.rootId;
  while (cursor) {
    const node = getNode(tree, cursor);
    // Which child the table follows. Normally the mainline's; in reading
    // mode, the one on the way to the current move — otherwise a cursor
    // standing in a side line still showed the WHOLE mainline after the
    // branch point, and the mode looked like it only worked from the
    // mainline. Past the cursor there is nothing on the path, so the
    // line's own continuation is followed as before.
    const mainChildId = currentLineOnly
      ? (node.children.find((id) => onPath.has(id)) ?? node.children[0])
      : node.children[0];
    if (!mainChildId) break;
    const variationIds = node.children.filter((id) => id !== mainChildId);
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

    // Filtered BEFORE the interrupt test: a branch that is not shown must
    // not break the move pair apart either, or reading mode would leave a
    // trail of "…" rows explaining nothing.
    const shownVariationIds = keep(variationIds);
    const interrupts = Boolean(child.comment) || shownVariationIds.length > 0;
    if (interrupts) {
      // The pair resumes on its own row after the interruption ("2 c4 …" /
      // "2 … e6"), the same convention as PGN and lichess.
      if (isWhite && row) row.black = 'ellipsis';
      flushRow();

      if (child.comment) {
        out.push(
          <p
            key={`${mainChildId}-comment`}
            // Size is Settings > Appearance > Annotation size, and is flat at
            // every width — see prefs for what replaced the `stacked:` lift
            // that used to live on this line.
            className={commentRow(annotation.mainline)}
          >
            {child.comment}
          </p>,
        );
      }
      for (const variationId of shownVariationIds) {
        out.push(
          <div
            key={`var-${variationId}`}
            className="border-line/60 text-muted flex flex-wrap items-baseline gap-x-1 gap-y-0.5 border-b py-1 pl-6 pr-2 text-sm"
          >
            <VariationBranch
              tree={tree}
              startId={variationId}
              cursorId={cursorId}
              onSelect={onSelect}
              keep={keep}
              bookIds={bookIds}
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
  bookIds,
}: {
  entry: { id: NodeId; node: MoveNode } | 'ellipsis' | null;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  /** Mainline nodes the engine review classified as book. */
  bookIds: Set<NodeId>;
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
      {bookIds.has(id) && (
        <span className="self-center" title={t('Book move')}>
          <BookOpen className={cn('size-3', active ? 'text-primary-fg/80' : 'text-nag-book')} />
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
  /** Reading-mode filter, applied to every branch at every depth. */
  keep: (ids: NodeId[]) => NodeId[];
  /** Nodes the opening catalogue classifies as book, at every depth. */
  bookIds: Set<NodeId>;
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
      className="bg-primary/10 text-primary hover:bg-primary/20 border-line flex w-full shrink-0 items-center justify-center gap-1.5 border-t px-3 py-1.5 text-sm font-medium transition-colors duration-100"
    >
      <ArrowUpToLine className="size-3.5" />
      {t('Make mainline')}
    </button>
  );
}

/**
 * Inline rendering for variations, mirroring PGN's own shape: the first
 * child continues inline, and every further child becomes a parenthesised
 * variation rendered as a nested block.
 */
function Line({ tree, fromId, cursorId, onSelect, continued = false, keep, bookIds }: LineProps) {
  const annotation = ANNOTATION_CLASS[usePrefs((s) => s.annotationSize)];
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
        book={bookIds.has(mainChildId)}
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
            'text-subtle border-line my-1 basis-full break-words whitespace-pre-line border-l-2 pl-2 italic',
            annotation.variation,
          )}
        >
          {child.comment}
        </p>,
      );
      flowInterrupted = true;
    }

    for (const variationId of keep(variationIds)) {
      items.push(
        <div
          key={`var-${variationId}`}
          className={cn(
            'my-1 flex basis-full flex-wrap items-baseline gap-x-1 gap-y-0.5',
            'border-line/70 border-l-2 pl-2',
            // Deeper variations dim further so the parent line stays readable.
            'text-subtle text-sm',
          )}
        >
          <VariationBranch
            tree={tree}
            startId={variationId}
            cursorId={cursorId}
            onSelect={onSelect}
            keep={keep}
            bookIds={bookIds}
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
  keep,
  bookIds,
}: {
  tree: MoveTree;
  startId: NodeId;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  keep: (ids: NodeId[]) => NodeId[];
  bookIds: Set<NodeId>;
}) {
  const node = getNode(tree, startId);
  const annotation = ANNOTATION_CLASS[usePrefs((s) => s.annotationSize)];
  return (
    <>
      <MoveChip
        label={node.san ?? '?'}
        number={moveNumberLabel(node.ply, blackToMoveAtRoot(tree))}
        nags={node.nags}
        hasComment={Boolean(node.comment)}
        active={startId === cursorId}
        book={bookIds.has(startId)}
        onClick={() => onSelect(startId)}
      />
      {/* The variation's own first move is rendered here rather than by `Line`,
          so its comment has to be emitted here too or it would be dropped. */}
      {node.comment && (
        <p
          className={cn(
            'text-subtle border-line my-1 basis-full break-words whitespace-pre-line border-l-2 pl-2 italic',
            annotation.variation,
          )}
        >
          {node.comment}
        </p>
      )}
      <Line
        tree={tree}
        fromId={startId}
        cursorId={cursorId}
        onSelect={onSelect}
        continued={!node.comment}
        keep={keep}
        bookIds={bookIds}
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
  book?: boolean;
  onClick: () => void;
}

function MoveChip({ label, number, nags, hasComment, active, book = false, onClick }: MoveChipProps) {
  return (
    <span className="inline-flex items-baseline gap-1">
      {number && <span className="text-subtle font-mono text-xs">{number}</span>}
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
        {book && (
          <span className="ml-1 inline-block align-middle" title={t('Book move')}>
            <BookOpen
              className={cn('size-3', active ? 'text-primary-fg/80' : 'text-nag-book')}
            />
          </span>
        )}
        {hasComment && (
          <span
            className={cn(
              'ml-1 inline-block size-1 rounded-full align-middle',
              active ? 'bg-primary-fg/70' : 'bg-info',
            )}
            title={t('Has a comment')}
          />
        )}
      </button>
    </span>
  );
}
