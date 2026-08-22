import { useEffect, useRef } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2 } from 'lucide-react';
import { getNode, mainlineFrom } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { MainlineTable, PromoteStrip } from '@/analysis/MoveTreePane';
import { scrollRowIntoPanel } from '@/lib/scroll';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/panel';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The moves panel both puzzle trainers and the repertoire drill share: the
 * analysis tab's own move table (variations, comments and NAG glyphs
 * included) over a caller-owned tree, plus the standard navigation toolbar
 * walking that tree. The caller decides what selecting a node means.
 */
export function AnswerPanel({
  tree,
  cursorId,
  onSelect,
  onPromote,
  onFlip,
  title = t('Moves'),
  emptyText = t('Play a move on the board.'),
  className,
}: {
  tree: MoveTree;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
  /** When set, a strip offers promoting the current side line. */
  onPromote?: (id: NodeId) => void;
  /**
   * Turn the board round.
   *
   * The desktop toolbar here is the whole of what a trainer offers for
   * moving about — while solving there is no BoardControls on screen,
   * because that one drives the analysis store and these screens hold
   * their own tree. So the flip button was on the phone's action bar and
   * nowhere else: on a desktop the only way to see the position from the
   * other side was to finish the puzzle. Optional because the orientation
   * belongs to the caller, which is the only thing that knows what the
   * board is showing.
   */
  onFlip?: () => void;
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
      <div className="border-border flex w-full shrink-0 items-center justify-center gap-1 border-t py-1 max-md:hidden">
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
        {onFlip && (
          <>
            {/* The divider BoardControls draws in the same place, for the
                same reason: flipping is not a step through the line. */}
            <div className="bg-border mx-1 h-5 w-px" />
            <Button variant="ghost" size="icon" title={t('Flip board')} onClick={onFlip}>
              <FlipVertical2 className="size-[1.1rem]" />
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}
