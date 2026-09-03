import type { ReactNode } from 'react';
import { blackToMoveAtRoot, getNode, mainlineFrom, moveNumberLabel } from '@shared/tree';
import type { MoveNode, NodeId } from '@shared/types';
import { useAnalysis } from '@/store/analysis';
import { cn } from '@/lib/utils';
import { figurine } from './notation';

/**
 * The line up to the cursor, as one wrapped strip of SAN.
 *
 * Deliberately one LINE and not the tree: this answers "what am I looking
 * at", which the Moves panel answers with columns, numbering, variations,
 * comments and NAGs. Repeating any of that here would be building a second
 * moves panel beside whatever holds this one — the point is a sentence
 * you can read without leaving where you are. Two places read it: the
 * engine tab on a phone, under the lines, and the book reader's board on
 * a desktop, where it is the only moves the page shows.
 *
 * The whole line, though, and not just what leads up to the cursor: a
 * strip that shortened every time you stepped back would answer "how did
 * I get here" when the question is "where am I". So it runs from the root
 * through the cursor and on down the mainline, and moving about changes
 * which move is lit rather than how many there are.
 *
 * Clickable all the same, because a strip of moves that cannot be stepped
 * through is a picture of a list.
 */
export function CurrentLine({ className }: { className?: string }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const setCursor = useAnalysis((s) => s.setCursor);
  const blackFirst = blackToMoveAtRoot(tree);

  // `forced` is for a move that follows a bracket, or opens one: a Black
  // move normally carries no number, and after "(2.d4 exd4 3.♘f3)" a bare
  // ♘c6 has lost the thread of where it belongs. PGN writes 2...♘c6 there
  // for exactly this reason.
  const chip = (id: NodeId, node: MoveNode, forced = false): ReactNode => {
    const numbered = forced || (node.ply + (blackFirst ? 1 : 0)) % 2 === 1;
    const on = id === cursorId;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setCursor(id)}
        className={cn(
          'font-moves rounded-sm px-1 py-0.5 text-sm transition-colors duration-100',
          // The one you are on carries the accent, the same way a hovered
          // ply in a variation above does — one grammar for "this move" in
          // the whole panel.
          on ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        )}
      >
        {numbered && (
          <span className="text-muted-foreground mr-0.5 font-mono">
            {moveNumberLabel(node.ply, blackFirst)}
          </span>
        )}
        {figurine(node.san ?? '')}
      </button>
    );
  };

  /**
   * A sideline, flat: its own moves and nothing else.
   *
   * One level deep on purpose. A bracket inside a bracket is a tree, and a
   * tree is what the Moves tab is for — this is a sentence you read at a
   * glance, and nesting is the first thing that stops it being one.
   *
   * Appended to a shared array rather than returned, because a bracket and
   * the moves inside it have to be one flat run of inline content: the
   * strip wraps, and a nested flex box would refuse to break in the middle
   * of a long variation.
   */
  const emit = (out: ReactNode[], firstId: NodeId): void => {
    let cur: NodeId | undefined = firstId;
    let first = true;
    while (cur) {
      const id: NodeId = cur;
      const node = getNode(tree, id);
      out.push(chip(id, node, first));
      first = false;
      cur = node.children[0];
    }
  };

  /**
   * The document's own line: the mainline from the root, with what was
   * played instead beside each move, in brackets — PGN's shape.
   *
   * It used to be walked THROUGH the cursor, root to cursor and on down
   * from there. That made the sentence depend on where you were standing:
   * step into a variation and the variation became the line while the
   * mainline was bracketed beside it, as though the tree had been
   * rearranged around the cursor. Which contradicted the promise right
   * above — that moving about changes which move is LIT, not how many
   * there are, or which ones.
   *
   * Reading it from the root fixes the order and leaves the cursor to do
   * one job: mark where you are. The move you are on is still on the
   * strip, since a sideline one level down is drawn in full.
   *
   * The cost is a cursor deeper than that — a variation of a variation —
   * which has nothing on the strip to light. The alternative was a
   * sentence that rewrites itself as you read it, and the Moves tab is
   * where a tree is meant to be read.
   */
  const chain = mainlineFrom(tree, tree.rootId);
  if (chain.length === 0) return null;
  const out: ReactNode[] = [];
  let forced = false;
  for (const id of chain) {
    const node = getNode(tree, id);
    out.push(chip(id, node, forced));
    forced = false;
    const parent = node.parentId === null ? null : getNode(tree, node.parentId);
    for (const alt of parent ? parent.children.filter((c) => c !== id) : []) {
      // Negative margins because the chips carry their own padding: the
      // bracket has to sit against the move, not a gap away from it.
      out.push(
        <span key={`${alt}-(`} className="text-muted-foreground -mr-1 text-sm">
          (
        </span>,
      );
      emit(out, alt);
      out.push(
        <span key={`${alt}-)`} className="text-muted-foreground -ml-1 text-sm">
          )
        </span>,
      );
      forced = true;
    }
  }

  return (
    // Capped and scrollable: a game with sidelines at every move would
    // otherwise grow this box until it had eaten whatever stands above it.
    // The border and insets are the caller's: docked under the engine's
    // lines it is a section of that pane, under the reader's board it is
    // a caption with nothing to separate itself from.
    <div className={cn('max-h-24 shrink-0 overflow-y-auto', className)}>
      <div className="flex flex-wrap items-baseline gap-x-0.5 gap-y-1">{out}</div>
    </div>
  );
}
