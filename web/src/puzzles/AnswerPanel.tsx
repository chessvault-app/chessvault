import { useEffect, useRef } from 'react';
import { ArrowUpToLine, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { getNode, isOnMainline, mainlineFrom } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { MainlineTable } from '@/analysis/MoveTreePane';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';

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
  title = 'Moves',
  emptyText = 'Play a move on the board.',
}: {
  tree: MoveTree;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  /** When set, a header action promotes an off-mainline cursor's line. */
  onPromote?: (id: NodeId) => void;
  title?: string;
  emptyText?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursorId]);

  const node = getNode(tree, cursorId);
  const isEmpty = getNode(tree, tree.rootId).children.length === 0;
  const next = node.children[0];
  const lineEnd = mainlineFrom(tree, cursorId).at(-1);

  return (
    <Panel flush className="min-h-[10rem] shrink-0">
      <PanelHeader
        title={title}
        actions={
          onPromote &&
          !isOnMainline(tree, cursorId) && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Make this line the mainline"
              onClick={() => onPromote(cursorId)}
            >
              <ArrowUpToLine className="size-3.5" />
            </Button>
          )
        }
      />
      {isEmpty ? (
        <p className="text-subtle px-3 py-4 text-center text-xs">{emptyText}</p>
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed">
          <MainlineTable tree={tree} cursorId={cursorId} onSelect={onSelect} />
        </div>
      )}
      {/* The same navigation toolbar every board in the app has. */}
      <div className="border-line flex w-full shrink-0 items-center justify-center gap-1 border-t py-1">
        <Button
          variant="ghost"
          size="icon"
          title="Start"
          disabled={cursorId === tree.rootId}
          onClick={() => onSelect(tree.rootId)}
        >
          <ChevronFirst className="size-[1.1rem]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Back"
          disabled={!node.parentId}
          onClick={() => node.parentId && onSelect(node.parentId)}
        >
          <ChevronLeft className="size-[1.1rem]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Forward"
          disabled={!next}
          onClick={() => next && onSelect(next)}
        >
          <ChevronRight className="size-[1.1rem]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="End of line"
          disabled={!lineEnd}
          onClick={() => lineEnd && onSelect(lineEnd)}
        >
          <ChevronLast className="size-[1.1rem]" />
        </Button>
      </div>
    </Panel>
  );
}
