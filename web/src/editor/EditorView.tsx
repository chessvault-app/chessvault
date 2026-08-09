import {
  AlertCircle,
  ChevronLeft,
  Settings2,
  ListPlus,
  CheckCircle2,
  Eraser,
  FlipVertical2,
  SquarePen,
  Microscope,
  MousePointer2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { parseSquare } from 'chessops/util';
import type { Color, Role } from 'chessops/types';
import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';
import { Board, type BoardApi, type BoardPiece } from '@/board/Board';
import { copyText } from '@/lib/clipboard';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Input } from '@/ui/Input';
import { Panel, PanelHeader } from '@/ui/Panel';
import { EDITOR_BOARD_MAX_W } from '@/board/boardSize';
import { cn } from '@/lib/cn';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import {
  defaultEditorState,
  emptyEditorState,
  epCandidates,
  fromFen,
  toFen,
  validate,
  type CastlingFlag,
  type EditorState,
} from './editorFen';

const ROLES: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/**
 * What a click on the board does.
 *
 * `move` is a distinct mode rather than an implicit default because chessground
 * fires `select` on mousedown: with a placement or erase tool armed, merely
 * *starting* a drag would apply the tool and destroy the piece being dragged.
 * Making the modes mutually exclusive removes that race entirely.
 */
type Tool =
  | { kind: 'move' }
  | { kind: 'erase' }
  | { kind: 'piece'; role: Role; color: Color };

export function EditorView({
  onUse,
  useLabel = 'Analyse',
  initialFen,
}: {
  /** Embedded mode: hand the legal position back instead of navigating. */
  onUse?: (fen: string) => void;
  useLabel?: string;
  /** Prefill (e.g. a diagram read from a photo); falls back to the start. */
  initialFen?: string;
}) {
  const [state, setState] = useState<EditorState>(
    () => (initialFen ? fromFen(initialFen) : undefined) ?? defaultEditorState(),
  );
  const [tool, setTool] = useState<Tool>({ kind: 'move' });
  const [orientation, setOrientation] = useState<Color>('white');
  const [sheetOpen, setSheetOpen] = useState(false);
  // Image import runs against the app's built-in piece templates, so a
  // screenshot of any lichess/chessground-style board reads with no setup.

  // Shared Load-position handlers: text lands on the editor (PGN loads
  // its final position), image readings likewise.
  const loadText = (value: string): string | null => {
    const looksLikePgn = /^\s*\[/.test(value) || /1\s*\.\s*[A-Za-z]/.test(value);
    let fenToLoad = value;
    if (looksLikePgn) {
      try {
        const first = pgnToChapters(value)[0];
        if (!first) throw new Error('no games');
        const tree = first.tree;
        const lastId = mainlineFrom(tree, tree.rootId).at(-1) ?? tree.rootId;
        fenToLoad = getNode(tree, lastId).fen;
      } catch {
        return 'That PGN could not be read.';
      }
    }
    const next = fromFen(fenToLoad);
    if (!next) return 'That FEN could not be read.';
    setState(next);
    return null;
  };
  const applyImageFen = (fen: string): void => {
    const next = fromFen(fen);
    if (next) setState(next);
  };

  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);

  const fen = useMemo(() => toFen(state), [state]);
  const validity = useMemo(() => validate(state), [state]);
  const epOptions = useMemo(() => epCandidates(state), [state]);

  const patch = (next: Partial<EditorState>): void => setState((s) => ({ ...s, ...next }));

  /** Apply the active tool to a square. No-op in move mode, where drags rule. */
  const applyTool = (squareName: string): void => {
    if (tool.kind === 'move') return;
    const square = parseSquare(squareName);
    if (square === undefined) return;
    setState((s) => {
      const pieces = new Map(s.pieces);
      if (tool.kind === 'erase') pieces.delete(square);
      else pieces.set(square, { role: tool.role, color: tool.color });
      return { ...s, pieces };
    });
  };

  /** A palette piece dragged onto the board (chessground's dragNewPiece). */
  const boardApi = useRef<BoardApi | null>(null);
  const dropNewPiece = (piece: BoardPiece, dest: string): void => {
    const square = parseSquare(dest);
    if (square === undefined) return;
    setState((s) => {
      const pieces = new Map(s.pieces);
      pieces.set(square, { role: piece.role, color: piece.color });
      return { ...s, pieces };
    });
  };

  /** Free drag: relocate whatever is on `orig` to `dest`. */
  const movePiece = (orig: string, dest: string): void => {
    const from = parseSquare(orig);
    const to = parseSquare(dest);
    if (from === undefined || to === undefined) return;
    setState((s) => {
      const piece = s.pieces.get(from);
      if (!piece) return s;
      const pieces = new Map(s.pieces);
      pieces.delete(from);
      pieces.set(to, piece);
      return { ...s, pieces };
    });
  };

  /**
   * FEN loads as-is; a PGN loads the END of its main line — the position
   * the game arrived at is what a position editor can meaningfully edit.
   */

  const copyFen = async (): Promise<void> => {
    setCopied((await copyText(fen)) ? 'ok' : 'failed');
    setTimeout(() => setCopied(null), 1400);
  };

  /** Hand the position to the analysis board — or to the embedder. */
  const analyse = (): void => {
    if (!validity.legal) return;
    if (onUse) {
      onUse(fen);
      return;
    }
    if (!useAnalysis.getState().loadFen(fen)) return;
    useAnalysis.setState({ handoff: true });
    navigate('analysis');
  };

  const positionPanels = (
    <>
        <Panel flush>
          <PanelHeader title="Position" />
          <div className="grid gap-3 p-3">
            <Field label="Side to move">
              <div className="flex gap-1">
                {(['white', 'black'] as Color[]).map((color) => (
                  <Button
                    key={color}
                    size="sm"
                    variant={state.turn === color ? 'primary' : 'secondary'}
                    onClick={() => patch({ turn: color })}
                    className="flex-1 capitalize"
                  >
                    {color}
                  </Button>
                ))}
              </div>
            </Field>

            <Field label="Castling rights">
              <div className="flex gap-1">
                {(
                  [
                    ['K', 'White O-O'],
                    ['Q', 'White O-O-O'],
                    ['k', 'Black O-O'],
                    ['q', 'Black O-O-O'],
                  ] as [CastlingFlag, string][]
                ).map(([flag, title]) => (
                  <Button
                    key={flag}
                    size="sm"
                    variant={state.castling.has(flag) ? 'primary' : 'secondary'}
                    title={title}
                    onClick={() => {
                      const castling = new Set(state.castling);
                      if (castling.has(flag)) castling.delete(flag);
                      else castling.add(flag);
                      patch({ castling });
                    }}
                    className="flex-1 font-mono"
                  >
                    {flag}
                  </Button>
                ))}
              </div>
            </Field>

            <Field label="En passant target">
              <Select
                value={state.epSquare ?? ''}
                onChange={(v) => patch({ epSquare: v || null })}
                ariaLabel="En passant target"
                inset
                mono
                className="w-full"
                groups={[
                  {
                    options: [
                      { value: '', label: 'none' },
                      ...epOptions.map((square) => ({ value: square, label: square })),
                    ],
                  },
                ]}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Halfmove clock">
                <NumberInput
                  value={state.halfmoves}
                  min={0}
                  onChange={(halfmoves) => patch({ halfmoves })}
                />
              </Field>
              <Field label="Move number">
                <NumberInput
                  value={state.fullmoves}
                  min={1}
                  onChange={(fullmoves) => patch({ fullmoves })}
                />
              </Field>
            </div>
          </div>

          {/* FEN lives in a status footer, not its own panel — reading it
              back or loading a new one is occasional, editing is constant
              (lanph3re's call, same as the analysis Load panel). */}
          {!validity.legal && (
            <p className="text-warn flex items-start gap-1.5 px-3 pb-1.5 text-xs">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {validity.reason}
            </p>
          )}
          <div className="border-line flex shrink-0 items-center gap-1.5 border-t py-1.5 pl-3 pr-2">
            {validity.legal && (
              <CheckCircle2 className="text-good size-3.5 shrink-0" aria-label="Legal position" />
            )}
            <code
              className="text-subtle min-w-0 flex-1 truncate font-mono text-[0.6875rem]"
              title={fen}
            >
              {fen}
            </code>
            <Button variant="ghost" size="sm" onClick={() => void copyFen()}>
              {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Failed' : 'Copy'}
            </Button>
            {/* Same Load-position dialog as the Board tab (lanph3re: one
                dialog everywhere); here it lands on the editor state. */}
            <LoadPositionButton loadText={loadText} applyImageFen={applyImageFen} />
          </div>
        </Panel>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:overflow-y-auto stacked:[scrollbar-gutter:stable_both-edges] wide:flex-row wide:gap-4 wide:p-4">
      {/* Phones lead with a header like every other page (the Editor title
          otherwise lives only in the wide-only side column). Suppressed when
          embedded (onUse) — the host page carries its own header. */}
      {!onUse && (
        <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            title="Back"
            onClick={() => window.history.back()}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <SquarePen className="text-subtle size-4" aria-hidden />
          <h1 className="text-fg text-sm font-semibold">Editor</h1>
        </div>
      )}

      {/* Board + palette. One combined palette row keeps the vertical chrome
          small, which is what lets every view share a large board budget.
          Top-anchored like AnalysisBoard: same board y in every view. */}
      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 stacked:my-auto wide:flex-1 wide:justify-start">
        {/* Desktop: one fixed-height combined row above the board (board
            alignment across views). Phones: the opponent's pieces above the
            board and the player's below, lichess-editor style. */}
        <div className={cn('flex w-full items-end justify-center wide:h-10', EDITOR_BOARD_MAX_W)}>
          <div className="hidden w-full wide:block">
            <PiecePalette
              colors={orientation === 'white' ? ['black', 'white'] : ['white', 'black']}
              tool={tool}
              onPick={setTool}
              onDragStart={(color, role, e) => boardApi.current?.dragNewPiece({ role, color }, e, true)}
            />
          </div>
          <div className="w-full wide:hidden">
            <PiecePalette
              colors={[orientation === 'white' ? 'black' : 'white']}
              tool={tool}
              onPick={setTool}
              onDragStart={(color, role, e) => boardApi.current?.dragNewPiece({ role, color }, e, true)}
            />
          </div>
        </div>

        <div className={cn('w-full', EDITOR_BOARD_MAX_W)}>
          <Board
            fen={fen}
            orientation={orientation}
            // Dragging is only enabled in move mode, so a drag can never race
            // with the tool being applied on mousedown.
            free={tool.kind === 'move'}
            onSelect={applyTool}
            onMove={movePiece}
            onDropNewPiece={dropNewPiece}
            apiRef={boardApi}
          />
        </div>

        <div className={cn('w-full wide:hidden', EDITOR_BOARD_MAX_W)}>
          <PiecePalette
            colors={[orientation === 'white' ? 'white' : 'black']}
            tool={tool}
            onPick={setTool}
            onDragStart={(color, role, e) => boardApi.current?.dragNewPiece({ role, color }, e, true)}
          />
        </div>

        {/* Phones (< sm): the row follows the board width but sits inset
            from its edges — the pill flexes and spaces its six square tools
            evenly, Analyse squares up at the end — without stretching any
            button. Wider screens keep content-sized, centred buttons with
            labels. */}
        <div className={cn('flex w-full items-center justify-center gap-2', EDITOR_BOARD_MAX_W)}>
          {/* Nested-radius rule: the pill's radius ≈ button radius + padding,
              so the active tool's highlight sits concentric in its corner. */}
          <div className="bg-surface-2/60 border-line flex items-center gap-0.5 rounded-[calc(0.375rem+3px)] border p-0.5 max-sm:flex-1 max-sm:justify-between">
          <Button
            variant={tool.kind === 'move' ? 'primary' : 'ghost'}
            size="sm"
            className="h-8 max-sm:w-10 max-sm:px-0"
            onClick={() => setTool({ kind: 'move' })}
            title="Move: drag pieces around the board"
          >
            <MousePointer2 className="size-3.5" />
            <span className="hidden sm:inline">Move</span>
          </Button>
          <Button
            variant={tool.kind === 'erase' ? 'primary' : 'ghost'}
            size="sm"
            className="h-8 max-sm:w-10 max-sm:px-0"
            onClick={() => setTool({ kind: 'erase' })}
            title="Erase: click a square to remove its piece"
          >
            <Eraser className="size-3.5" />
            <span className="hidden sm:inline">Erase</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-8"
            onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
            title="Flip board"
          >
            <FlipVertical2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-8"
            onClick={() => setState(defaultEditorState())}
            title="Reset to the starting position"
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-8"
            onClick={() => setState(emptyEditorState())}
            title="Clear the board"
          >
            <Trash2 className="size-3.5" />
          </Button>
          </div>
          {/* Position details (side to move, castling, FEN) — a LABELLED
              button on phones, where the side column is hidden, so the FEN
              is never buried behind an anonymous gear. */}
          <Button
            variant="secondary"
            size="sm"
            active={sheetOpen}
            className="h-8 wide:hidden"
            onClick={() => setSheetOpen((v) => !v)}
            title="Position details (side to move, castling, FEN)"
          >
            <Settings2 className="size-3.5" />
            <span>Position</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-8 max-sm:w-10 max-sm:px-0"
            disabled={!validity.legal}
            onClick={analyse}
            title={validity.legal ? (onUse ? useLabel : 'Analyse this position') : validity.reason}
          >
            {/* Analysis = the game-review microscope; embedded mode records
                a move list, so the glyph says "list", not "go". */}
            {onUse ? <ListPlus className="size-3.5" /> : <Microscope className="size-3.5" />}
            <span className="hidden sm:inline">{onUse ? useLabel : 'Analyse'}</span>
          </Button>
        </div>
      </div>

      {/* Position metadata: a side column when there is width for it, and a
          bottom sheet behind the toolbar's Position button when stacked. */}
      <div className="hidden min-h-0 flex-col gap-3 overflow-y-auto [&>section]:shrink-0 wide:flex wide:w-[min(27rem,38%)] wide:flex-none">
        {/* The column header band: h-9 + the column's gap-3 equals the
            board's h-10 strip + its gap-2, so the first panel's top edge
            aligns with the board's (lanph3re's call, matching studies/games). */}
        <div className="flex h-9 shrink-0 items-center gap-2">
          <SquarePen className="text-subtle size-4" aria-hidden />
          <h1 className="text-fg text-sm font-semibold">Editor</h1>
        </div>
        {positionPanels}
      </div>

      {sheetOpen && (
        // display: contents — the wrapper must not become an in-flow flex
        // child (its children are all fixed), or mounting the sheet adds a
        // gap slot to the column and nudges the centred board.
        <div className="contents wide:hidden">
          <div className="bg-scrim fixed inset-0 z-40" onClick={() => setSheetOpen(false)} />
          <div className="bg-app border-line fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] space-y-3 overflow-y-auto rounded-t-2xl border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {positionPanels}
          </div>
        </div>
      )}

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-subtle text-[0.6875rem] font-semibold uppercase tracking-[0.06em]">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  min,
  onChange,
}: {
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      type="number"
      min={min}
      value={value}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      className="w-full font-mono"
    />
  );
}

/** The placement palette: both colours in one row, opponent side first. */
function PiecePalette({
  colors,
  tool,
  onPick,
  onDragStart,
}: {
  colors: Color[];
  tool: Tool;
  onPick: (tool: Tool) => void;
  /** Press-and-drag hands the piece to chessground as a spare-piece drag. */
  onDragStart?: (color: Color, role: Role, event: MouseEvent | TouchEvent) => void;
}) {
  return (
    // Phones: one comfortable touch-sized row per colour. Desktop: a single
    // combined row whose buttons shrink to fit, so the fixed-height strip
    // above the board never clips.
    <div className="cg-wrap promo-host flex w-full flex-wrap items-center justify-center gap-1 wide:flex-nowrap">
      {colors.map((color, groupIndex) => (
        <div key={color} className="flex w-full justify-center gap-1 wide:w-auto wide:min-w-0 wide:flex-1">
          {groupIndex > 0 && <span className="bg-line mx-1.5 hidden h-6 w-px shrink-0 wide:block" />}
          {ROLES.map((role) => {
            const active = tool.kind === 'piece' && tool.role === role && tool.color === color;
            return (
              <button
                key={role}
                type="button"
                aria-label={`Place ${color} ${role}`}
                title={`Place ${color} ${role}`}
                onClick={() => onPick({ kind: 'piece', role, color })}
                // A drag is chessground's from the first pixel; a clean
                // click (no movement, so no drop) still arms the tool.
                onMouseDown={(e) => onDragStart?.(color, role, e.nativeEvent)}
                onTouchStart={(e) => onDragStart?.(color, role, e.nativeEvent)}
                className={cn(
                  // A board-square backdrop: --board-light is tuned per theme
                  // to keep BOTH piece colours legible, which the page
                  // background is not (black pieces vanish on dark).
                  // touch-none: a touch on a palette piece starts a drag,
                  // never a page scroll.
                  'touch-none aspect-square w-11 rounded-lg bg-(--board-light) p-0.5 transition-all duration-100 sm:w-14 sm:p-1',
                  'wide:w-full wide:min-w-0 wide:max-w-10 wide:flex-1',
                  active ? 'ring-primary ring-2' : 'opacity-75 hover:opacity-100',
                )}
              >
                {/* Same sprite-reuse trick as the promotion picker. */}
                <span
                  className="block size-full"
                  dangerouslySetInnerHTML={{ __html: `<piece class="${role} ${color}"></piece>` }}
                />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
