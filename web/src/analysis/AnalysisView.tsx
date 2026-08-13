import { ChevronLeft, Check, Compass, Copy, Cpu, FolderInput, FolderPlus, ListOrdered, Loader2, Microscope, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getNode, pathTo } from '@shared/tree';
import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { AnalysisMoveEntry } from '@/board/MoveEntry';
import { EngineBlock } from '@/engine/EnginePane';
import { ReviewButton, ReviewStrip } from '@/engine/ReviewStrip';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { cn } from '@/lib/cn';
import { useOpeningName } from '@/lib/opening';
import { copyText } from '@/lib/clipboard';
import { forgetCollection } from '@/games/collection';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { useExplorer } from '@/store/explorer';
import { useReview } from '@/store/review';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { Panel, PanelHeader } from '@/ui/Panel';
import { PaneTabs } from '@/ui/PaneTabs';
import { UndoBar } from '@/ui/UndoBar';
import { useUndoable } from '@/ui/useUndoable';
import { MoveTreePane, SidelinesToggle } from './MoveTreePane';
import { LoadPositionButton } from './PositionLoader';
import { t } from '@/lib/i18n';

type AnalysisPane = 'moves' | 'engine' | 'explorer';

export function AnalysisView({ params = [] }: { params?: string[] }) {
  const openingTree = useAnalysis((s) => s.tree);
  const openingCursor = useAnalysis((s) => s.cursorId);
  const openingName = useOpeningName(
    useMemo(
      () => pathTo(openingTree, openingCursor).map((id) => getNode(openingTree, id).fen),
      [openingTree, openingCursor],
    ),
  );

  // Reached as Tools > Explorer (navigate('analysis', 'explorer')): open
  // straight to the opening explorer instead of the move list.
  const wantExplorer = params[0] === 'explorer';
  // Small screens show ONE pane under the board (lichess-app style); the
  // others stay mounted but hidden so the engine keeps following the board.
  const [pane, setPane] = useState<AnalysisPane>(wantExplorer ? 'explorer' : 'moves');
  // Held here because two things open it: the header's button on a desktop
  // and the ⋯ on a phone, and they must share one dialog.
  const [loadOpen, setLoadOpen] = useState(false);
  const engineOn = useEngine((s) => s.enabled);

  // Stateless page (lanph3re's call): entering analysis always starts a fresh
  // board with the engine off and the explorer at its default — UNLESS a
  // view just handed a position over (editor, games, puzzles), marked by
  // the handoff flag. The ref makes the decision once per real mount:
  // StrictMode runs the effect twice, and the second run must not treat
  // the just-consumed flag as "no handoff" and wipe the board.
  const entered = useRef(false);
  // useLayoutEffect, not useEffect: reset BEFORE the browser paints, so a
  // stale board handed over by a previous page never flashes on screen.
  useLayoutEffect(() => {
    if (entered.current) return;
    entered.current = true;
    const analysis = useAnalysis.getState();
    if (analysis.handoff) {
      useAnalysis.setState({ handoff: false });
      return;
    }
    analysis.reset();
    const engine = useEngine.getState();
    if (engine.enabled) engine.setEnabled(false);
    // Tools > Explorer opens with the explorer already on; otherwise off.
    useExplorer.setState({ enabled: wantExplorer });
    useReview.getState().clear();
  }, []);

  // A game review left running would walk the whole game on background
  // threads with no visible sign anywhere else in the app — abort it on
  // leave (the run loop bails after the in-flight ply and frees its worker).
  useEffect(() => () => {
    if (useReview.getState().status === 'running') useReview.getState().clear();
  }, []);

  return (
    // Stacked layouts scroll the page (full-width board, pane past the fold,
    // like the lichess app); desktop fits the viewport with internal scrolls.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-hidden wide:flex-row wide:gap-4 wide:p-4">
      {/* Stacked layouts lead with a header like every other page; games
          opened here from elite/archives get a way back on phones. */}
      <BoardPageHeader explorer={wantExplorer} />
      <AnalysisBoard editablePlayers />

      {/* Side column. Desktop shows every pane and scrolls the column; on
          phones exactly one pane shows, fills the height left under the
          board, and scrolls INTERNALLY (its move table / list own the
          scroll, with a visible scrollbar) — the page itself never scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto lg:scrollbar-hidden max-lg:overflow-y-auto max-lg:scrollbar-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        {/* The column header band: h-9 + the column's gap-3 equals the
            board's h-10 strip + its gap-2, so the first panel's top edge
            aligns with the board's (lanph3re's call, matching studies/games). */}
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">
          <h1 className="text-fg text-sm font-semibold">
            {wantExplorer ? t('Explorer') : t('Board')}
          </h1>
        </div>
        <PaneTabs
          className="lg:hidden"
          value={pane}
          onChange={setPane}
          tabs={[
            { id: 'moves', label: t('Moves'), icon: ListOrdered },
            { id: 'engine', label: 'Engine', icon: Cpu },
            { id: 'explorer', label: 'Explorer', icon: Compass },
          ]}
        />
        {/* Desktop keeps an explicit floor (the column scrolls when the
            viewport can't fit it); phones drop the floor so the panel
            shrinks into the slot and the move table scrolls inside. */}
        <Panel
          flush
          className={cn(
            'flex-1 max-lg:min-h-0',
            engineOn ? 'lg:min-h-[28rem]' : 'lg:min-h-[22rem]',
            pane !== 'moves' && 'max-lg:hidden',
          )}
        >
          {/* Engine docks in the Moves panel on desktop; on phones it is its
              own tab (below), so hide the docked copy there. */}
          <EngineBlock className="max-lg:hidden" />
          <PanelHeader
            // The line's own name rather than the word "Moves", which every
            // panel in the app could have been called. It updates as you
            // play and is looked up by position, so transpositions arrive
            // at the right name.
            title={openingName ?? 'Starting position'}
            actions={
              <>
                <SidelinesToggle />
                {/* On the header where there is room; under ⋯ on a phone. */}
                <span className="hidden items-center gap-1 md:inline-flex">
                  <ReviewButton />
                  <CollectGameButton />
                </span>
                <LoadPositionButton
                  open={loadOpen}
                  onOpenChange={setLoadOpen}
                  triggerClassName="max-md:hidden"
                />
                <MoveActions />
                <MovesOverflow onLoadPosition={() => setLoadOpen(true)} />
              </>
            }
          />
          <MoveTreePane />
          <ReviewStrip />
          {/* Typed entry: the board is pointer-only, so this is how a
              keyboard plays a move at all (and how notation-thinkers play
              one fastest). Phones use the touch board and have no row to
              spare. */}
          <div className="border-line border-t px-2 py-1.5 max-md:hidden">
            <AnalysisMoveEntry />
          </div>
          {/* Navigation lives at the bottom of the moves panel (lanph3re's
              call), not under the board. */}
          <BoardControls className="border-line border-t max-md:hidden" keyboard={false} />
          <StatusBar />
        </Panel>
        {/* Engine as its own phone tab — desktop shows it docked above, so
            this whole pane is lg:hidden. */}
        <Panel flush className={cn('flex-1 min-h-0 lg:hidden', pane !== 'engine' && 'max-lg:hidden')}>
          <EngineBlock />
        </Panel>
        {/* The caps keep the explorer from squeezing the move list out of
            existence on short desktop viewports. */}
        <ExplorerPane
          resizeKey="analysis-explorer"
          className={cn(
            'max-lg:min-h-0 max-lg:flex-1 lg:min-h-min lg:max-h-[45%]',
            pane !== 'explorer' && 'max-lg:hidden',
          )}
        />
      </div>

      {/* Phones: move navigation lives in the bottom bar, replacing the
          global tabs while the board is open. */}
      <MobileActionBar>
        <BoardControls keyboard={false} className="py-1.5" />
      </MobileActionBar>
    </div>
  );
}

/**
 * Keep the loaded game: its PGN (headers included) becomes a collection
 * document, same endpoint the elite/archive Add buttons use. Only shown
 * when an actual game is on the board.
 */
function CollectGameButton() {
  const hasGame = useAnalysis((s) => s.gameHeaders) !== null;
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  if (!hasGame) return null;
  const collect = async (): Promise<void> => {
    setState('busy');
    const res = await fetch('/api/games/collect-pgn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pgn: useAnalysis.getState().exportPgn() }),
    });
    // 409 = already collected; that is still a success for the user.
    if (res.ok) forgetCollection(); // the Games list is now a game short
    setState(res.ok || res.status === 409 ? 'done' : 'failed');
    setTimeout(() => setState('idle'), 2000);
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={state === 'busy'}
      title={
        state === 'done'
          ? 'In the collection'
          : state === 'failed'
            ? 'Could not add this game'
            : 'Add this game to the collection'
      }
      className={state === 'failed' ? 'text-bad' : state === 'done' ? 'text-good' : undefined}
      onClick={() => void collect()}
    >
      {state === 'busy' ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : state === 'done' ? (
        <Check className="size-3.5" />
      ) : (
        <FolderPlus className="size-3.5" />
      )}
    </Button>
  );
}

function BoardPageHeader({ explorer = false }: { explorer?: boolean }) {
  const headers = useAnalysis((s) => s.gameHeaders);
  const title =
    headers && (headers['White'] ?? '?') !== '?'
      ? `${headers['White']} – ${headers['Black'] ?? '?'}`
      : explorer
        ? t('Explorer')
        : t('Board');
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        title={t('Back')}
        onClick={() => window.history.back()}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <h1 className="text-fg min-w-0 truncate text-sm font-semibold">{title}</h1>
    </div>
  );
}

/**
 * Undo for the tree's destructive verbs.
 *
 * Deleting a move (and everything after it) was the only one-tap,
 * no-confirm, no-undo destruction in the app — while every shelf row got
 * an UndoBar. The tree is in memory, so undo is a snapshot: capture
 * before the act, put it back if asked. Same treatment as the shelves,
 * same toast.
 */
function useTreeUndo(): {
  undoable: ReturnType<typeof useUndoable>;
  capture: (label: string) => void;
} {
  const undoable = useUndoable();
  const capture = (label: string): void => {
    const { tree, cursorId, gameHeaders, orientation } = useAnalysis.getState();
    undoable.remove(
      label,
      () => {},
      () => useAnalysis.setState({ tree, cursorId, gameHeaders, orientation }),
    );
  };
  return { undoable, capture };
}

export function MoveActions({ allowReset = true }: { allowReset?: boolean }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const deleteNode = useAnalysis((s) => s.deleteNode);
  const reset = useAnalysis((s) => s.reset);
  const { undoable, capture } = useTreeUndo();

  const node = getNode(tree, cursorId);
  const atRoot = node.parentId === null;

  // Promotion lives on the variation rows themselves (see MoveTreePane),
  // the same control in every moves table.
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={atRoot}
        onClick={() => {
          capture(node.san ?? '');
          deleteNode(cursorId);
        }}
        title={t('Delete this move and everything after it')}
      >
        <Trash2 className="size-3.5" />
      </Button>
      {allowReset && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="max-md:hidden"
          onClick={() => {
            capture(t('all moves'));
            reset();
          }}
          title={t('Clear the board')}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      )}
      {undoable.pending && (
        <UndoBar
          label={undoable.pending.label}
          leaving={undoable.pending.leaving}
          onUndo={undoable.undo}
          onHold={undoable.hold}
          onRelease={undoable.release}
        />
      )}
    </>
  );
}

/**
 * The moves header's ⋯ — phones only.
 *
 * That header had grown to six controls: the side-line toggle, review,
 * collect, load position, delete, reset. On a 390px panel whose title is
 * a full opening name, six 28px buttons leave the name about a word.
 *
 * So the ones that are not about the move you are standing on fold into
 * a menu, and the two that are — the side-line toggle and delete —
 * stay out where a thumb can reach them. Copying the FEN and the PGN
 * moves in here too, which is what lets the status bar underneath the
 * list go away on a phone: it was a row of chrome spending a line of
 * height on a string nobody reads on a phone.
 *
 * A desktop keeps every icon on the header and its status bar, so this
 * renders nothing there.
 */
export function MovesOverflow({
  allowReset = true,
  onLoadPosition,
}: {
  allowReset?: boolean;
  /** Opens the caller's Load position dialog; omitted where there is none. */
  onLoadPosition?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const reset = useAnalysis((s) => s.reset);
  const { undoable, capture } = useTreeUndo();
  const exportPgn = useAnalysis((s) => s.exportPgn);
  const runReview = useReview((s) => s.run);
  const reviewing = useReview((s) => s.status) === 'running';
  // Review needs something to review; the root having children is that.
  const hasMoves = useAnalysis((s) => getNode(s.tree, s.tree.rootId).children.length > 0);

  const actions: SheetAction[] = [
    ...(onLoadPosition
      ? [{ label: 'Load a position', icon: FolderInput, onSelect: onLoadPosition }]
      : []),
    // Offered only when there is a game to judge, and not while it is
    // already judging one.
    ...(hasMoves && !reviewing
      ? [{ label: 'Engine review', icon: Microscope, onSelect: () => void runReview() }]
      : []),
    {
      label: 'Copy FEN',
      icon: Copy,
      onSelect: () => void copyText(getNode(tree, cursorId).fen),
    },
    { label: 'Copy PGN', icon: Copy, onSelect: () => void copyText(exportPgn()) },
    // Last and tinted: it throws the board away. Never offered in a
    // study or a game, where the board IS the document — the same reason
    // MoveActions takes allowReset.
    ...(allowReset
      ? [
          {
            label: 'Clear the board',
            icon: RotateCcw,
            danger: true,
            onSelect: () => {
              capture(t('all moves'));
              reset();
            },
          } as SheetAction,
        ]
      : []),
  ];

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        title={t('More')}
        active={open}
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      {open && (
        <ActionSheet
          title={t('Moves')}
          anchor={trigger}
          actions={actions}
          onClose={() => setOpen(false)}
        />
      )}
      {undoable.pending && (
        <UndoBar
          label={undoable.pending.label}
          leaving={undoable.pending.leaving}
          onUndo={undoable.undo}
          onHold={undoable.hold}
          onRelease={undoable.release}
        />
      )}
    </>
  );
}

export function StatusBar() {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const exportPgn = useAnalysis((s) => s.exportPgn);
  const [copied, setCopied] = useState<'fen' | 'pgn' | 'failed' | null>(null);

  const node = getNode(tree, cursorId);

  const copy = useCallback(async (kind: 'fen' | 'pgn', value: string) => {
    setCopied((await copyText(value)) ? kind : 'failed');
    setTimeout(() => setCopied(null), 1400);
  }, []);

  return (
    <div className="border-line flex shrink-0 items-center gap-2 border-t px-2 py-1.5 max-md:hidden">
      <code
        className="text-subtle min-w-0 flex-1 truncate font-mono text-[0.6875rem]"
        title={node.fen}
      >
        {node.fen}
      </code>
      <Button variant="ghost" size="sm" onClick={() => void copy('fen', node.fen)}>
        {copied === 'fen' ? t('Copied') : copied === 'failed' ? t('Failed') : 'FEN'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void copy('pgn', exportPgn())}>
        {copied === 'pgn' ? t('Copied') : copied === 'failed' ? t('Failed') : 'PGN'}
      </Button>
    </div>
  );
}
