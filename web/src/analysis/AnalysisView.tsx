import { ChevronLeft, Check, Compass, Cpu, FolderPlus, Grid3x3, ListOrdered, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getNode } from '@shared/tree';
import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { EngineBlock } from '@/engine/EnginePane';
import { ReviewButton, ReviewStrip } from '@/engine/ReviewStrip';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/clipboard';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { useExplorer } from '@/store/explorer';
import { useReview } from '@/store/review';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { Panel, PanelHeader } from '@/ui/Panel';
import { PaneTabs } from '@/ui/PaneTabs';
import { MoveTreePane } from './MoveTreePane';
import { LoadPositionButton } from './PositionLoader';

type AnalysisPane = 'moves' | 'engine' | 'explorer';

export function AnalysisView({ params = [] }: { params?: string[] }) {
  // Reached as Tools > Explorer (navigate('analysis', 'explorer')): open
  // straight to the opening explorer instead of the move list.
  const wantExplorer = params[0] === 'explorer';
  // Small screens show ONE pane under the board (lichess-app style); the
  // others stay mounted but hidden so the engine keeps following the board.
  const [pane, setPane] = useState<AnalysisPane>(wantExplorer ? 'explorer' : 'moves');
  const engineOn = useEngine((s) => s.enabled);

  // Stateless page (lanph3re's call): entering analysis always starts a fresh
  // board with the engine off and the explorer at its default — UNLESS a
  // view just handed a position over (editor, games, puzzles), marked by
  // the handoff flag. The ref makes the decision once per real mount:
  // StrictMode runs the effect twice, and the second run must not treat
  // the just-consumed flag as "no handoff" and wipe the board.
  const entered = useRef(false);
  useEffect(() => {
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto lg:scrollbar-hidden max-lg:overflow-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        {/* The column header band: h-9 + the column's gap-3 equals the
            board's h-10 strip + its gap-2, so the first panel's top edge
            aligns with the board's (lanph3re's call, matching studies/games). */}
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">
          {wantExplorer ? (
            <Compass className="text-subtle size-4" aria-hidden />
          ) : (
            <Grid3x3 className="text-subtle size-4" aria-hidden />
          )}
          <h1 className="text-fg text-sm font-semibold">{wantExplorer ? 'Explorer' : 'Board'}</h1>
        </div>
        <PaneTabs
          className="lg:hidden"
          value={pane}
          onChange={setPane}
          tabs={[
            { id: 'moves', label: 'Moves', icon: ListOrdered },
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
            // Explorer landing: on desktop the explorer is the star, so the
            // Moves panel steps down to a secondary, capped block below it.
            wantExplorer
              ? 'lg:flex-none lg:max-h-[32%]'
              : engineOn
                ? 'lg:min-h-[28rem]'
                : 'lg:min-h-[22rem]',
            pane !== 'moves' && 'max-lg:hidden',
          )}
        >
          {/* Engine docks in the Moves panel on desktop; on phones it is its
              own tab (below), so hide the docked copy there. */}
          <EngineBlock className="max-lg:hidden" />
          <PanelHeader
            title="Moves"
            actions={
              <>
                <ReviewButton />
                <CollectGameButton />
                <LoadPositionButton />
                <MoveActions />
              </>
            }
          />
          <MoveTreePane />
          <ReviewStrip />
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
            'max-lg:min-h-0 max-lg:flex-1',
            // Prominent and first on the Explorer landing; a capped panel
            // beneath the move list otherwise.
            wantExplorer ? 'lg:order-first lg:flex-1' : 'lg:min-h-min lg:max-h-[45%]',
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
        ? 'Explorer'
        : 'Board';
  const Icon = explorer ? Compass : Grid3x3;
  return (
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
      <Icon className="text-subtle size-4" aria-hidden />
      <h1 className="text-fg min-w-0 truncate text-sm font-semibold">{title}</h1>
    </div>
  );
}

export function MoveActions({ allowReset = true }: { allowReset?: boolean }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const deleteNode = useAnalysis((s) => s.deleteNode);
  const reset = useAnalysis((s) => s.reset);

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
        onClick={() => deleteNode(cursorId)}
        title="Delete this move and everything after it"
      >
        <Trash2 className="size-3.5" />
      </Button>
      {allowReset && (
        <Button variant="ghost" size="icon-sm" onClick={() => reset()} title="Clear the board">
          <RotateCcw className="size-3.5" />
        </Button>
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
    <div className="border-line flex shrink-0 items-center gap-2 border-t px-2 py-1.5">
      <code
        className="text-subtle min-w-0 flex-1 truncate font-mono text-[0.6875rem]"
        title={node.fen}
      >
        {node.fen}
      </code>
      <Button variant="ghost" size="sm" onClick={() => void copy('fen', node.fen)}>
        {copied === 'fen' ? 'Copied' : copied === 'failed' ? 'Failed' : 'FEN'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void copy('pgn', exportPgn())}>
        {copied === 'pgn' ? 'Copied' : copied === 'failed' ? 'Failed' : 'PGN'}
      </Button>
    </div>
  );
}
