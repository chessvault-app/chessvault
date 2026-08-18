import {
  AlertCircle,
  ChevronLeft,
  Settings2,
  ListPlus,
  CheckCircle2,
  Eraser,
  FlipVertical2,
  FolderInput,
  Microscope,
  MousePointer2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { parseBoardFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';
import type { Color, Piece, Role, Square } from 'chessops/types';
import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';
import { Board, type BoardApi, type BoardPiece } from '@/board/Board';
import { copyText } from '@/lib/clipboard';
import { navigate, up } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { Panel, PanelHeader } from '@/ui/Panel';
import { BOARD_SCROLL_SHELL, BOARD_WIDE_SIDE } from '@/ui/layout';
import { EDITOR_BOARD_MAX_W } from '@/board/boardSize';
import { cn } from '@/lib/cn';
import { LoadPositionButton, LoadPositionForm } from '@/analysis/PositionLoader';
import { builtinTemplates } from '@/puzzles/ocr/builtin';
import type { Template } from '@/puzzles/ocr/classify';
import { Suspense, lazy } from 'react';

const PhotoImport = lazy(() =>
  import('@/puzzles/PhotoImport').then((m) => ({ default: m.PhotoImport })),
);
import { t } from '@/lib/i18n';
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
 * "Place white knight", in whatever language.
 *
 * Built from two translated halves rather than twelve sentences: the
 * dictionary keeps six piece names and two colours instead of every
 * combination, and the sentence itself is one key so word order stays the
 * target language's business — Korean puts the colour and piece before the
 * verb, which a concatenation could never do.
 */
const ROLE_NAMES: Record<Role, string> = {
  pawn: 'pawn',
  knight: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  queen: 'queen',
  king: 'king',
};
const placeLabel = (color: Color, role: Role): string =>
  t('Place {color} {piece}', {
    color: color === 'white' ? t('white') : t('black'),
    piece: t(ROLE_NAMES[role]),
  });

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
  useLabel = t('Analyse'),
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
  /**
   * Whether the sheet is showing its Load page.
   *
   * A Modal written inside another Modal IS that window's second page —
   * the parent parks, the child grows the back chevron, and the child
   * opens as tall as the window it replaced. This used to be a swapped
   * body with a page floor measured here, which held the BODY and not the
   * title row: the row gained the back chevron on the load page and the
   * sheet grew by the difference — 4px under a mouse, 12 on a thumb,
   * where icon buttons are bigger. Modal's floor is on the card, so it
   * covers the row too.
   */
  const [loadPage, setLoadPage] = useState(false);
  const [photoTemplates, setPhotoTemplates] = useState<Template[] | null>(null);
  const [photoFile, setPhotoFile] = useState<Blob | null>(null);
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
  // Reuses the fen memo above — validate would otherwise serialize again.
  const validity = useMemo(() => validate(state, fen), [state, fen]);
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

  /** Dragging a piece off the board deletes it INSIDE chessground — no
      per-piece callback reports which one. Mirror the board's own state
      back into ours whenever it changes; for ordinary moves and drops this
      is an idempotent second write of what their handlers already set. */
  const syncFromBoard = (): void => {
    const boardFen = boardApi.current?.getFen();
    if (!boardFen) return;
    const parsed = parseBoardFen(boardFen);
    if (parsed.isErr) return;
    const board = parsed.unwrap();
    setState((s) => {
      const pieces = new Map<Square, Piece>();
      for (const square of board.occupied) {
        const piece = board.get(square);
        if (piece) pieces.set(square, piece);
      }
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
    navigate('board');
  };

  /**
   * Where the panel is being shown, which decides its chrome — named
   * places rather than two booleans, the same fix as ArchiveBrowser's
   * `place`: `positionPanels(false, true)` said nothing at the call site.
   *
   * - `column` — the wide layout's side column: carries its own Position
   *              header, with the Load button beside it.
   * - `sheet`  — the phone's Position window: the Modal already says
   *              Position, so no header (the same word twice, three lines
   *              apart), and the loader is a page turn from the FEN
   *              footer, having no header to live in.
   */
  const positionPanels = (place: 'column' | 'sheet') => (
    <>
        <Panel flush>
          {/* The Load button lives up here with the panel's name, not
              buried at the end of the FEN footer (lanph3re's call) — the
              sheet keeps its page-turn button in the footer, having no
              header to carry it. */}
          {place === 'column' && (
            <PanelHeader
              title={t('Position')}
              actions={<LoadPositionButton loadText={loadText} applyImageFen={applyImageFen} />}
            />
          )}
          <div className="grid gap-3 p-3">
            <Field label={t('Side to move')}>
              <div className="flex gap-1">
                {(['white', 'black'] as Color[]).map((color) => (
                  <Button
                    key={color}
                    size="sm"
                    variant={state.turn === color ? 'primary' : 'secondary'}
                    onClick={() => patch({ turn: color })}
                    className="flex-1"
                  >
                    {color === 'white' ? t('White') : t('Black')}
                  </Button>
                ))}
              </div>
            </Field>

            <Field label={t('Castling rights')}>
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
                    title={t(title)}
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

            <Field label={t('En passant target')}>
              <Select
                value={state.epSquare ?? ''}
                onChange={(v) => patch({ epSquare: v || null })}
                ariaLabel={t('En passant target')}
                inset
                mono
                className="w-full"
                groups={[
                  {
                    options: [
                      { value: '', label: t('none') },
                      ...epOptions.map((square) => ({ value: square, label: square })),
                    ],
                  },
                ]}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label={t('Halfmove clock')}>
                <NumberInput
                  value={state.halfmoves}
                  min={0}
                  onChange={(halfmoves) => patch({ halfmoves })}
                />
              </Field>
              <Field label={t('Move number')}>
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
            <p className="text-warn flex items-start gap-1.5 px-3 pb-1.5 text-sm">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {validity.reason}
            </p>
          )}
          <div className="border-line flex shrink-0 items-center gap-1.5 border-t py-1.5 pl-3 pr-2">
            {validity.legal && (
              <CheckCircle2 className="text-good size-3.5 shrink-0" aria-label={t('Legal position')} />
            )}
            <code
              className="text-subtle min-w-0 flex-1 truncate font-mono text-xs"
              title={fen}
            >
              {fen}
            </code>
            <Button variant="ghost" size="sm" onClick={() => void copyFen()}>
              {copied === 'ok' ? t('Copied') : copied === 'failed' ? t('Failed') : t('Copy')}
            </Button>
            {/* Opened from the sheet, the loader REPLACES the sheet rather
                than stacking a second one on it: the sheet closes as the
                loader opens, and the loader's back chevron brings it
                straight back. Two scrims deep on a phone is a window you
                have to dismiss twice to get out of. */}
            {place === 'sheet' && (
              // Inside the sheet this is a page turn, not a new window.
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Load a position — FEN, PGN, or image')}
                onClick={() => setLoadPage(true)}
              >
                <FolderInput className="size-3.5" />
              </Button>
            )}
          </div>
        </Panel>
    </>
  );

  return (
    <div className={BOARD_SCROLL_SHELL}>
      {/* Phones lead with a header like every other page (the Editor title
          otherwise lives only in the wide-only side column). Suppressed when
          embedded (onUse) — the host page carries its own header. */}
      {!onUse && (
        <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            title={t('Back')}
            onClick={() => up('home')}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg text-base font-semibold">{t('Editor')}</h1>
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
            deleteOnDropOff
            onSelect={applyTool}
            onMove={movePiece}
            onDropNewPiece={dropNewPiece}
            onBoardChange={syncFromBoard}
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
        {/* One height for the row, and everything in it fills that. The
            tool pill wraps its buttons in a border and padding, so buttons
            of the same class inside and outside it came out six pixels
            apart — the pill's chrome. Sizing to the row instead of to the
            buttons makes the difference the pill's problem, not the eye's. */}
        <div className={cn('flex h-9 w-full items-center justify-center gap-2', EDITOR_BOARD_MAX_W)}>
          {/* Nested-radius rule: the pill's radius ≈ button radius + padding,
              so the active tool's highlight sits concentric in its corner. */}
          <div className="bg-surface-2/60 border-line flex h-full items-center gap-0.5 rounded-[calc(0.375rem+3px)] border p-0.5 max-sm:flex-1 max-sm:justify-between">
          <Button
            variant={tool.kind === 'move' ? 'primary' : 'ghost'}
            size="sm"
            className="h-full max-sm:w-10 max-sm:px-0"
            onClick={() => setTool({ kind: 'move' })}
            title={t('Move: drag pieces around the board')}
          >
            <MousePointer2 className="size-3.5" />
            <span className="hidden sm:inline">{t('Move')}</span>
          </Button>
          <Button
            variant={tool.kind === 'erase' ? 'primary' : 'ghost'}
            size="sm"
            className="h-full max-sm:w-10 max-sm:px-0"
            onClick={() => setTool({ kind: 'erase' })}
            title={t('Erase: click a square to remove its piece')}
          >
            <Eraser className="size-3.5" />
            <span className="hidden sm:inline">{t('Erase')}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-full w-8"
            onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
            title={t('Flip board')}
          >
            <FlipVertical2 className="size-3.5" />
          </Button>
          {/* Both of these destroy the position on the board, and as two
              adjacent anonymous icons they were a coin-flip. Named where
              there is room, like Move and Erase beside them. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-full max-sm:w-10 max-sm:px-0"
            onClick={() => setState(defaultEditorState())}
            title={t('Reset to the starting position')}
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">{t('Reset')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-full max-sm:w-10 max-sm:px-0"
            onClick={() => setState(emptyEditorState())}
            title={t('Clear the board')}
          >
            <Trash2 className="size-3.5" />
            <span className="hidden sm:inline">{t('Clear')}</span>
          </Button>
          </div>
          {/* Position details (side to move, castling, FEN) — a LABELLED
              button on phones, where the side column is hidden, so the FEN
              is never buried behind an anonymous gear. */}
          <Button
            variant="secondary"
            size="sm"
            active={sheetOpen}
            className="h-full wide:hidden"
            onClick={() => setSheetOpen((v) => !v)}
            title={t('Position details (side to move, castling, FEN)')}
          >
            <Settings2 className="size-3.5" />
            <span>{t('Position')}</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="h-full max-sm:w-10 max-sm:px-0"
            disabled={!validity.legal}
            onClick={analyse}
            title={validity.legal ? (onUse ? useLabel : t('Analyse this position')) : validity.reason}
          >
            {/* Analysis = the game-review microscope; embedded mode records
                a move list, so the glyph says "list", not "go". */}
            {onUse ? <ListPlus className="size-3.5" /> : <Microscope className="size-3.5" />}
            <span className="hidden sm:inline">{onUse ? useLabel : t('Analyse')}</span>
          </Button>
        </div>
      </div>

      {/* Position metadata: a side column when there is width for it, and a
          bottom sheet behind the toolbar's Position button when stacked. */}
      <div className={`hidden min-h-0 flex-col gap-3 overflow-y-auto [&>section]:shrink-0 wide:flex ${BOARD_WIDE_SIDE}`}>
        {/* The column header band: h-9 + the column's gap-3 equals the
            board's h-10 strip + its gap-2, so the first panel's top edge
            aligns with the board's (lanph3re's call, matching studies/games). */}
        <div className="flex h-9 shrink-0 items-center gap-2">
          <h1 className="text-fg text-base font-semibold">{t('Editor')}</h1>
        </div>
        {positionPanels('column')}
      </div>

      {/* The app's own window, not a second one hand-rolled here. This was
          a scrim and a rounded box built in place, from before there was a
          shared sheet — so it had no grab handle, no drag, no keyboard
          band and its own idea of the safe area. Modal is a bottom sheet
          on a phone and this only ever opens on one (`wide:hidden` on the
          button that opens it). */}
      {sheetOpen && (
        <Modal
          title="Position"
          onClose={() => {
            setSheetOpen(false);
            setLoadPage(false);
          }}
        >
          {positionPanels('sheet')}
          {/* The second page, written inside the first: Modal parks this
              sheet behind it, wires the back chevron to onClose and holds
              the height. Nothing here says any of that. */}
          {loadPage && (
            <Modal title="Load position" onClose={() => setLoadPage(false)}>
              <LoadPositionForm
                loadText={loadText}
                onDone={() => {
                  setLoadPage(false);
                  setSheetOpen(false);
                }}
                onCancel={() => setLoadPage(false)}
                onImage={(file) => {
                  setPhotoFile(file);
                  void builtinTemplates()
                    .then(setPhotoTemplates)
                    .catch(() => setPhotoTemplates([]));
                }}
              />
              {/* And the THIRD page, inside the second. It was a sibling
                  window with `hidden` wired by hand at both levels; as a
                  page it parks the load form itself, and its back chevron
                  lands on the form you left rather than two pages back at
                  Position. */}
              {photoTemplates !== null && (
                <Suspense fallback={null}>
                  <PhotoImport
                    templates={photoTemplates}
                    initialFile={photoFile ?? undefined}
                    onApply={(reading) => {
                      if (reading.fen) applyImageFen(reading.fen);
                      setPhotoTemplates(null);
                      setSheetOpen(false);
                      setLoadPage(false);
                    }}
                    onClose={() => setPhotoTemplates(null)}
                  />
                </Suspense>
              )}
            </Modal>
          )}
        </Modal>
      )}

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-subtle text-xs font-semibold uppercase tracking-[0.06em]">
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
                aria-label={placeLabel(color, role)}
                title={placeLabel(color, role)}
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
