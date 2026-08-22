import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  FlipVertical2,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSquare } from 'chessops/util';
import type { Color } from 'chessops/types';
import { pgnToChapters, treeToPgn } from '@shared/pgn';
import {
  addMove,
  blackToMoveAtRoot,
  createTree,
  getNode,
  legalDests,
  mainlineFrom,
  moveNumberLabel,
  moveSquares,
  pathTo,
  positionAt,
} from '@shared/tree';
import type { Headers, MoveTree, NodeId } from '@shared/types';
import { Board } from '@/board/Board';
import { PromotionPicker } from '@/board/PromotionPicker';
import { usePromotion } from '@/board/usePromotion';
import { cn } from '@/lib/utils';
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
  // Parsed ONCE, on purpose: this block owns its tree from here on and
  // writes every change back to node.attrs.pgn, so re-parsing when that
  // attribute changes would feed the board its own output and clobber
  // whatever the user was in the middle of.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => parseBlock(String(node.attrs.pgn ?? '*')), []);
  /**
   * Whether the note is being EDITED, which is what decides whether this
   * board can be changed at all: its own tools (paste a position in,
   * remove it) and, with them, the pieces.
   *
   * The pieces used to move either way, on the reasoning that a move
   * tried while reading is just another pending change. But a note is a
   * document, and a reader is reading it — a board that quietly rewrites
   * itself under a finger is the diagram editing the page. Reading gives
   * back the line the note's author wrote; the strip and the arrows walk
   * it, and Edit is one press away for anyone who meant to change it.
   *
   * `setEditable` on the editor emits `update`, which is the same event
   * an ordinary edit fires, so one listener notices both.
   */
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
  /**
   * Whether this board is listening for touches yet.
   *
   * Chessground swallows any touch that lands on or near a piece — it has
   * to, or a piece could never be dragged (`drag.ts`: preventDefault
   * unless the touch is on empty board, far from any piece). In a note
   * that is fatal: the board is the width of the column, so a finger
   * placed almost anywhere in it scrolls nothing and the note appears
   * stuck. Which is why it only happened sometimes — it depended on where
   * the finger landed.
   *
   * So on a touch device the board starts inert, binds no listeners, and
   * lets the page scroll under it until it is tapped once. A mouse has no
   * such problem (the wheel is never captured), so it never waits.
   *
   * Only ever asked while EDITING now (see `live` below): a reader's board
   * is view-only, and chessground binds no touch listeners at all on one
   * of those — so the tap that used to be the price of scrolling past a
   * diagram is not charged for reading any more.
   */
  const [awake, setAwake] = useState(() => !window.matchMedia('(pointer: coarse)').matches);
  // The shared gate (board/usePromotion); the chosen piece rides the same
  // addMove → commit path an ordinary move takes, so it autosaves too.
  const promotion = usePromotion((orig, dest, role) => {
    const result = addMove(tree, cursorId, {
      from: parseSquare(orig)!,
      to: parseSquare(dest)!,
      promotion: role,
    });
    commit(result.tree, result.nodeId);
  });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const current = getNode(tree, cursorId);
  const pos = useMemo(() => positionAt(tree, cursorId), [tree, cursorId]);
  const dests = useMemo(() => legalDests(tree, cursorId), [tree, cursorId]);
  const lastMove = moveSquares(current);
  /** Whether the pieces can be moved: the note is open for editing, and on
      a touch device this board has had its one waking tap. */
  const live = editable && awake;

  const commit = (nextTree: MoveTree, nextCursor: NodeId): void => {
    setTree(nextTree);
    setCursorId(nextCursor);
    updateAttributes({ pgn: cleanBlockPgn(treeToPgn(nextTree, headers.current)) });
  };

  const playMove = (orig: string, dest: string): void => {
    const from = parseSquare(orig);
    const to = parseSquare(dest);
    if (from === undefined || to === undefined) return;
    if (!pos.board.get(from)) return;
    if (promotion.maybeStart(current.fen, pos.turn, orig, dest)) return;
    const result = addMove(tree, cursorId, { from, to });
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
        'border-border bg-surface-inset my-3 flex flex-col gap-2 rounded-xl border p-2 sm:flex-row',
        // The box wraps the board, not the page: on a phone the block is a
        // board with its moves under it, and a border stretched to the
        // note's full width around a much narrower board read as an empty
        // frame. It was 3/4 of the column for that reason and is 95% now
        // (lanph3re's call) — the frame still stops short of the text's
        // own edge, and the board is worth reading at. From sm up the
        // board and moves sit side by side and the box takes what it needs.
        'mx-auto w-[95%] max-w-full sm:mx-0 sm:w-auto',
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
        // One tap wakes the board on a phone; see `awake` above. A tap is
        // not a scroll, so this costs the reader nothing. Nothing to wake
        // while reading — the board is a picture then.
        onPointerDown={editable ? () => setAwake(true) : undefined}
      >
        <Board
          // Remounted when it wakes, because chessground binds its touch
          // listeners once at construction and its own API refuses
          // viewOnly in set(). Leaving Edit remounts it the same way, back
          // to the picture.
          key={live ? 'live' : 'inert'}
          viewOnly={!live}
          fen={current.fen}
          orientation={orientation}
          // A read-only board has no destinations to offer, and chessground
          // ignores them under viewOnly anyway — say so rather than rely on it.
          dests={live ? dests : undefined}
          lastMove={lastMove}
          check={pos.isCheck()}
          coordinates={false}
          onMove={playMove}
        />
        {promotion.pending && (
          <PromotionPicker
            color={promotion.pending.color}
            dest={promotion.pending.dest}
            orientation={orientation}
            onSelect={promotion.complete}
            onCancel={promotion.cancel}
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
            'rounded-sm px-1 py-0.5 font-mono text-sm transition-colors duration-100',
            id === cursorId
              ? 'bg-primary text-primary-foreground'
              : path.has(id)
                ? 'text-foreground hover:bg-accent'
                : 'text-muted-foreground hover:bg-accent',
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
          <span key={`${variation}-open`} className="text-subtle text-sm">
            (
          </span>,
        );
        renderLine(variation);
        chips.push(
          <span key={`${variation}-close`} className="text-subtle text-sm">
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
    return <p className="text-subtle px-1 text-sm">{t('Play moves on the board, or paste a FEN/PGN.')}</p>;
  }
  renderLine(root.children[0]!);
  // Variations off the root come after the mainline rendering handles them —
  // the loop above only follows children[0], so emit root alternatives too.
  const rootAlternatives = root.children.slice(1);
  for (const alt of rootAlternatives) {
    chips.push(
      <span key={`${alt}-open`} className="text-subtle text-sm">
        (
      </span>,
    );
    renderLine(alt);
    chips.push(
      <span key={`${alt}-close`} className="text-subtle text-sm">
        )
      </span>,
    );
  }

  return <div className="flex min-h-0 flex-wrap content-start items-start gap-x-0.5 gap-y-1 overflow-y-auto">{chips}</div>;
}
