import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  FlipVertical2,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSquare, squareRank } from 'chessops/util';
import type { Color, Role } from 'chessops/types';
import { pgnToChapters, treeToPgn } from '@shared/pgn';
import {
  addMove,
  blackToMoveAtRoot,
  createTree,
  getNode,
  legalDests,
  mainlineFrom,
  moveNumberLabel,
  pathTo,
  positionAt,
} from '@shared/tree';
import type { Headers, MoveTree, NodeId } from '@shared/types';
import { Board } from '@/board/Board';
import { PromotionPicker } from '@/board/PromotionPicker';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { TextArea } from '@/ui/Input';
import { t } from '@/lib/i18n';

interface BlockState {
  tree: MoveTree;
  headers: Headers;
}

function parseBlock(pgn: string): BlockState {
  try {
    const chapter = pgnToChapters(pgn)[0];
    if (chapter) return { tree: chapter.tree, headers: chapter.headers };
  } catch {
    // fall through to an empty board
  }
  return { tree: createTree(), headers: {} };
}

/**
 * makePgn emits the Seven Tag Roster with "?" placeholders — pure noise in a
 * note. Keep only headers that say something (FEN, SetUp, real names…).
 */
function cleanBlockPgn(pgn: string): string {
  return pgn
    .split('\n')
    .filter((line) => !/^\[\w+ "(\?+|\?{4}\.\?\?\.\?\?|\*)"\]$/.test(line))
    .join('\n')
    .replace(/^\n+/, '')
    .trim();
}

/**
 * The interactive board inside a note. Each block owns its own little move
 * tree (NOT the global analysis store): a note can hold many boards at once.
 * Every change is written back to the node's `pgn` attribute, which is what
 * the autosave serialises into the ```chess fence.
 */
export function ChessBlockView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const initial = useMemo(() => parseBlock(String(node.attrs.pgn ?? '*')), []);
  // Reading mode follows the note's Edit toggle: replay stays live, but the
  // position can't be changed and the board can't be deleted or reloaded.
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = (): void => setEditable(editor.isEditable);
    editor.on('update', sync);
    return () => {
      editor.off('update', sync);
    };
  }, [editor]);
  const [tree, setTree] = useState<MoveTree>(initial.tree);
  // A note board opens at the END of its line — the position the note is
  // talking about — not at the start; step back to replay.
  const [cursorId, setCursorId] = useState<NodeId>(
    mainlineFrom(initial.tree, initial.tree.rootId).at(-1) ?? initial.tree.rootId,
  );
  const headers = useRef<Headers>(initial.headers);
  const [orientation, setOrientation] = useState<Color>('white');
  const [pendingPromotion, setPendingPromotion] = useState<{
    orig: string;
    dest: string;
    color: Color;
  } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const current = getNode(tree, cursorId);
  const pos = useMemo(() => positionAt(tree, cursorId), [tree, cursorId]);
  const dests = useMemo(() => legalDests(tree, cursorId), [tree, cursorId]);
  const lastMove = current.uci
    ? ([current.uci.slice(0, 2), current.uci.slice(2, 4)] as [string, string])
    : undefined;

  const commit = (nextTree: MoveTree, nextCursor: NodeId): void => {
    setTree(nextTree);
    setCursorId(nextCursor);
    updateAttributes({ pgn: cleanBlockPgn(treeToPgn(nextTree, headers.current)) });
  };

  const playMove = (orig: string, dest: string): void => {
    const from = parseSquare(orig);
    const to = parseSquare(dest);
    if (from === undefined || to === undefined) return;
    const piece = pos.board.get(from);
    if (!piece) return;
    const lastRank = piece.color === 'white' ? 7 : 0;
    if (piece.role === 'pawn' && squareRank(to) === lastRank) {
      setPendingPromotion({ orig, dest, color: piece.color });
      return;
    }
    const result = addMove(tree, cursorId, { from, to });
    commit(result.tree, result.nodeId);
  };

  const completePromotion = (role: Role): void => {
    if (!pendingPromotion) return;
    const from = parseSquare(pendingPromotion.orig)!;
    const to = parseSquare(pendingPromotion.dest)!;
    const result = addMove(tree, cursorId, { from, to, promotion: role });
    setPendingPromotion(null);
    commit(result.tree, result.nodeId);
  };

  const loadPasted = (): void => {
    const text = pasteText.trim();
    if (!text) return;
    // A FEN has no move text; wrap it in PGN headers so one parser serves both.
    const looksLikeFen = !text.includes('\n') && text.split(' ').length >= 4 && !text.includes('.');
    const pgn = looksLikeFen ? `[FEN "${text}"]\n[SetUp "1"]\n\n*` : text;
    const parsed = parseBlock(pgn);
    headers.current = parsed.headers;
    setPasteOpen(false);
    setPasteText('');
    commit(parsed.tree, parsed.tree.rootId);
  };

  const goBack = (): void => {
    if (current.parentId) setCursorId(current.parentId);
  };
  const goForward = (): void => {
    if (current.children[0]) setCursorId(current.children[0]);
  };

  return (
    <NodeViewWrapper
      className={cn(
        'border-line bg-surface-inset my-3 flex flex-col gap-2 rounded-xl border p-2 sm:flex-row',
        // The box wraps the board, not the page: on a phone the block is a
        // board with its moves under it, and a border stretched to the
        // note's full width around a much narrower board read as an empty
        // frame. From sm up the board and moves sit side by side and the
        // box takes whatever that needs.
        'mx-auto w-3/4 max-w-full sm:mx-0 sm:w-auto',
        selected && 'ring-primary/60 ring-2',
      )}
      data-chess-block
    >
      {/* Narrow: the board sits above the moves rather than beside them,
          but not at the note's full width — a board illustrating a
          sentence should not be the whole screen. Capped and centred on a
          phone; the side-by-side split takes over from sm up. */}
      <div
        className="relative w-full shrink-0 sm:max-w-[19rem]"
        contentEditable={false}
      >
        <Board
          fen={current.fen}
          orientation={orientation}
          dests={editable ? dests : new Map()}
          lastMove={lastMove}
          check={pos.isCheck()}
          coordinates={false}
          onMove={playMove}
        />
        {pendingPromotion && (
          <PromotionPicker
            color={pendingPromotion.color}
            dest={pendingPromotion.dest}
            orientation={orientation}
            onSelect={completePromotion}
            onCancel={() => setPendingPromotion(null)}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1" contentEditable={false}>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" title={t('Back')} onClick={goBack}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('Forward')} onClick={goForward}>
            <ChevronRight className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('Flip board')} onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <FlipVertical2 className="size-3.5" />
          </Button>
          {editable && (
            <Button
              variant="ghost"
              size="icon-sm"
              active={pasteOpen}
              title={t('Load a FEN or PGN into this board')}
              onClick={() => setPasteOpen((v) => !v)}
            >
              <ClipboardPaste className="size-3.5" />
            </Button>
          )}
          <span className="flex-1" />
          {editable && (
            <Button variant="ghost" size="icon-sm" title={t('Remove this board')} onClick={deleteNode}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>

        {pasteOpen && editable && (
          <div className="flex flex-col gap-1.5">
            <TextArea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={t('Paste a FEN or PGN…')}
              rows={3}
              className="w-full resize-none font-mono"
            />
            <div className="flex justify-end">
              <Button variant="primary" size="sm" disabled={!pasteText.trim()} onClick={loadPasted}>
                {t('Load')}
              </Button>
            </div>
          </div>
        )}

        <MoveStrip tree={tree} cursorId={cursorId} onSelect={setCursorId} />
      </div>
    </NodeViewWrapper>
  );
}

/** Compact clickable move list: mainline flat, variations in parentheses. */
function MoveStrip({
  tree,
  cursorId,
  onSelect,
}: {
  tree: MoveTree;
  cursorId: NodeId;
  onSelect: (id: NodeId) => void;
}) {
  const chips: React.ReactNode[] = [];
  const path = new Set(pathTo(tree, cursorId));
  const blackFirst = blackToMoveAtRoot(tree);

  const renderLine = (startId: NodeId): void => {
    let nodeId: NodeId | undefined = startId;
    let needNumber = true;
    while (nodeId) {
      const node = getNode(tree, nodeId);
      const id: NodeId = nodeId;
      chips.push(
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className={cn(
            'rounded px-1 py-0.5 font-mono text-xs transition-colors duration-100',
            id === cursorId
              ? 'bg-primary text-primary-fg'
              : path.has(id)
                ? 'text-fg hover:bg-surface-2'
                : 'text-muted hover:bg-surface-2',
          )}
        >
          {(needNumber || (node.ply + (blackFirst ? 1 : 0)) % 2 === 1) && (
            <span className="text-subtle">{moveNumberLabel(node.ply, blackFirst)}</span>
          )}
          {node.san}
        </button>,
      );
      needNumber = false;
      const [main, ...variations] = node.children;
      for (const variation of variations) {
        chips.push(
          <span key={`${variation}-open`} className="text-subtle text-xs">
            (
          </span>,
        );
        renderLine(variation);
        chips.push(
          <span key={`${variation}-close`} className="text-subtle text-xs">
            )
          </span>,
        );
        needNumber = true;
      }
      nodeId = main;
    }
  };

  const root = getNode(tree, tree.rootId);
  if (root.children.length === 0) {
    return <p className="text-subtle px-1 text-xs">{t('Play moves on the board, or paste a FEN/PGN.')}</p>;
  }
  renderLine(root.children[0]!);
  // Variations off the root come after the mainline rendering handles them —
  // the loop above only follows children[0], so emit root alternatives too.
  const rootAlternatives = root.children.slice(1);
  for (const alt of rootAlternatives) {
    chips.push(
      <span key={`${alt}-open`} className="text-subtle text-xs">
        (
      </span>,
    );
    renderLine(alt);
    chips.push(
      <span key={`${alt}-close`} className="text-subtle text-xs">
        )
      </span>,
    );
  }

  return <div className="flex min-h-0 flex-wrap content-start items-start gap-x-0.5 gap-y-1 overflow-y-auto">{chips}</div>;
}
