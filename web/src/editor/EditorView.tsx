import {
  AlertCircle,
  Settings2,
  ArrowRight,
  CheckCircle2,
  Eraser,
  FlipVertical2,
  MousePointer2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseSquare } from 'chessops/util';
import type { Color, Role } from 'chessops/types';
import { Board } from '@/board/Board';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { EDITOR_BOARD_MAX_W } from '@/board/boardSize';
import { cn } from '@/lib/cn';
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

export function EditorView() {
  const [state, setState] = useState<EditorState>(defaultEditorState);
  const [tool, setTool] = useState<Tool>({ kind: 'move' });
  const [orientation, setOrientation] = useState<Color>('white');
  const [fenInput, setFenInput] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fenError, setFenError] = useState<string | null>(null);

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

  const loadFen = (): void => {
    const next = fromFen(fenInput);
    if (!next) {
      setFenError('That FEN could not be read.');
      return;
    }
    setFenError(null);
    setState(next);
    setFenInput('');
  };

  /** Hand the position to the analysis board. */
  const analyse = (): void => {
    if (!validity.legal) return;
    useAnalysis.getState().loadFen(fen);
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
              <select
                value={state.epSquare ?? ''}
                onChange={(e) => patch({ epSquare: e.target.value || null })}
                className={cn(
                  'bg-surface-inset border-line h-8 w-full rounded-md border px-2',
                  'font-mono text-xs outline-none focus:border-primary/50',
                )}
              >
                <option value="">none</option>
                {epOptions.map((square) => (
                  <option key={square} value={square}>
                    {square}
                  </option>
                ))}
              </select>
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
        </Panel>

        <Panel flush>
          <PanelHeader title="FEN" />
          <div className="grid gap-2 p-3">
            <code className="bg-surface-inset border-line block break-all rounded-md border px-2 py-1.5 font-mono text-[0.6875rem] leading-relaxed">
              {fen}
            </code>

            <div
              className={cn(
                'flex items-start gap-1.5 text-xs',
                validity.legal ? 'text-good' : 'text-warn',
              )}
            >
              {validity.legal ? (
                <>
                  <CheckCircle2 className="mt-px size-3.5 shrink-0" />
                  Legal position.
                </>
              ) : (
                <>
                  <AlertCircle className="mt-px size-3.5 shrink-0" />
                  {validity.reason}
                </>
              )}
            </div>

            <Button variant="primary" size="md" disabled={!validity.legal} onClick={analyse}>
              Analyse this position
              <ArrowRight className="size-4" />
            </Button>

            <div className="border-line mt-1 grid gap-2 border-t pt-3">
              <input
                value={fenInput}
                onChange={(e) => setFenInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadFen();
                }}
                spellCheck={false}
                placeholder="Paste a FEN to edit"
                className={cn(
                  'bg-surface-inset border-line h-8 w-full rounded-md border px-2',
                  'font-mono text-xs outline-none placeholder:font-sans focus:border-primary/50',
                )}
              />
              {fenError && <p className="text-bad text-xs">{fenError}</p>}
              <Button size="sm" onClick={loadFen} disabled={!fenInput.trim()}>
                Load FEN
              </Button>
            </div>
          </div>
        </Panel>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
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
            />
          </div>
          <div className="w-full wide:hidden">
            <PiecePalette
              colors={[orientation === 'white' ? 'black' : 'white']}
              tool={tool}
              onPick={setTool}
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
          />
        </div>

        <div className={cn('w-full wide:hidden', EDITOR_BOARD_MAX_W)}>
          <PiecePalette
            colors={[orientation === 'white' ? 'white' : 'black']}
            tool={tool}
            onPick={setTool}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1 px-2">
          <Button
            variant={tool.kind === 'move' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setTool({ kind: 'move' })}
            title="Move: drag pieces around the board"
          >
            <MousePointer2 className="size-3.5" />
            Move
          </Button>
          <Button
            variant={tool.kind === 'erase' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setTool({ kind: 'erase' })}
            title="Erase: click a square to remove its piece"
          >
            <Eraser className="size-3.5" />
            Erase
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
            title="Flip board"
          >
            <FlipVertical2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setState(defaultEditorState())}
            title="Reset to the starting position"
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setState(emptyEditorState())}
            title="Clear the board"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            active={sheetOpen}
            className="wide:hidden"
            onClick={() => setSheetOpen((v) => !v)}
            title="Position details (side to move, castling, FEN)"
          >
            <Settings2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Position metadata: a side column when there is width for it, and a
          bottom sheet behind the toolbar's Position button when stacked. */}
      <div className="hidden min-h-0 flex-col gap-3 overflow-y-auto wide:flex wide:w-[min(27rem,38%)] wide:flex-none">
        {positionPanels}
      </div>

      {sheetOpen && (
        <div className="wide:hidden">
          <div className="bg-scrim fixed inset-0 z-40" onClick={() => setSheetOpen(false)} />
          <div className="bg-app border-line fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-2xl border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
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
    <input
      type="number"
      min={min}
      value={value}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      className={cn(
        'bg-surface-inset border-line h-8 w-full rounded-md border px-2',
        'font-mono text-xs outline-none focus:border-primary/50',
      )}
    />
  );
}

/** The placement palette: both colours in one row, opponent side first. */
function PiecePalette({
  colors,
  tool,
  onPick,
}: {
  colors: Color[];
  tool: Tool;
  onPick: (tool: Tool) => void;
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
                className={cn(
                  // A board-square backdrop: --board-light is tuned per theme
                  // to keep BOTH piece colours legible, which the page
                  // background is not (black pieces vanish on dark).
                  'aspect-square w-11 rounded-lg bg-(--board-light) p-0.5 transition-all duration-100 sm:w-14 sm:p-1',
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
