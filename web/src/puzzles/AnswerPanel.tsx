import { useEffect, useRef } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { getNode, mainlineFrom } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { MainlineTable, PromoteStrip } from '@/analysis/MoveTreePane';
import { scrollRowIntoPanel } from '@/lib/scroll';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/**
 * The moves panel both puzzle trainers share: the analysis tab's own move
 * table (variations, comments and NAG glyphs included) over a caller-owned
 * tree, plus the standard navigation toolbar walking that tree. The caller
 * decides what selecting a node means.
 */
export function AnswerPanel({
  tree,
  cursorId,
  onSelect,
  onPromote,
  title = t('Moves'),
  emptyText = t('Play a move on the board.'),
  className,
}: {
  tree: MoveTree;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  /** When set, a strip offers promoting the current side line. */
  onPromote?: (id: NodeId) => void;
  title?: string;
  emptyText?: string;
  /** Lets a caller make this the panel that fills the column's spare height. */
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Panel-only: in a mobile browser the first move of a puzzle used to
  // scroll the PAGE, clipping the top of the panel on load.
  useEffect(() => {
    scrollRowIntoPanel(
      scroller.current,
      scroller.current?.querySelector('[data-active="true"]') ?? null,
    );
  }, [cursorId]);

  const node = getNode(tree, cursorId);
  const isEmpty = getNode(tree, tree.rootId).children.length === 0;
  const next = node.children[0];
  const lineEnd = mainlineFrom(tree, cursorId).at(-1);

  return (
    <Panel flush className={cn('min-h-[10rem] shrink-0', className)}>
      <PanelHeader title={title} />
      {isEmpty ? (
        // Shrinkable and scrollable, exactly like the move table it stands
        // in for: this is the panel's middle, and the middle is what has to
        // give when the column is short. At its natural height it pushed
        // the toolbar below the panel's own floor instead.
        //
        // The padding is on the text, not on the flex item: a border-box
        // element cannot be shorter than its own padding, so `py-6` on the
        // item itself was a 48px floor that `min-h-0` could not undo — the
        // shrink stopped 7px early and the toolbar wore it.
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="text-subtle px-3 py-6 text-center text-sm">{emptyText}</p>
        </div>
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto text-base leading-relaxed">
          <MainlineTable tree={tree} cursorId={cursorId} onSelect={onSelect} />
        </div>
      )}
      {onPromote && <PromoteStrip tree={tree} cursorId={cursorId} onPromote={onPromote} />}
      {/* The navigation toolbar — hidden on phones, where the bottom action
          bar owns move navigation (no duplicate). */}
      <div className="border-line flex w-full shrink-0 items-center justify-center gap-1 border-t py-1 max-md:hidden">
        <Button
          variant="ghost"
          size="icon"
          title={t('Start')}
          disabled={cursorId === tree.rootId}
          onClick={() => onSelect(tree.rootId)}
        >
          <ChevronFirst className="size-[1.1rem]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={t('Back')}
          disabled={!node.parentId}
          onClick={() => node.parentId && onSelect(node.parentId)}
        >
          <ChevronLeft className="size-[1.1rem]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={t('Forward')}
          disabled={!next}
          onClick={() => next && onSelect(next)}
        >
          <ChevronRight className="size-[1.1rem]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={t('End of line')}
          disabled={!lineEnd}
          onClick={() => lineEnd && onSelect(lineEnd)}
        >
          <ChevronLast className="size-[1.1rem]" />
        </Button>
      </div>
    </Panel>
  );
}
