import { LayoutDashboard } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getNode, pathTo } from '@shared/tree';
import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { EngineBlock } from '@/engine/EnginePane';
import { ReviewButton, ReviewStrip } from '@/engine/ReviewStrip';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { CollectGameButton, MoveActions, MovesOverflow } from '@/analysis/AnalysisView';
import { MoveTreePane, SidelinesToggle } from '@/analysis/MoveTreePane';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import { handOffPositionHunt } from '@/games/DatabaseGames';
import { GamesBrowser } from '@/games/GamesBrowser';
import { type DetailsSelection } from '@/games/GameDetails';
import { useAnalysis } from '@/store/analysis';
import { useExplorer } from '@/store/explorer';
import { useReview } from '@/store/review';
import { useOpeningName } from '@/lib/opening';
import { useWorkspaceViewport } from '@/lib/media';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/panel';
import { Switch } from '@/components/ui/switch';
import { WORKSPACE_SHELL } from '@/components/layout';
import { useElementHeight } from '@/hooks/use-element-height';
import { useElementWidth } from '@/hooks/use-element-width';

/**
 * The workspace: every analysis surface at once — board, moves + engine,
 * explorer, and the games browser as a band underneath — so browsing,
 * looking something up and analysing stop being page changes. It owns no
 * capability of its own: every pane here is the same component some other
 * page shows one at a time, driven by the same stores, which is what keeps
 * a phone user whole (the panes ARE the Board and Games pages there) and
 * keeps this page from becoming a second implementation that drifts.
 *
 * Unlike the Board page it is NOT stateless on entry: the analysis store
 * is global, so whatever was on the board follows you in, and that
 * continuity is the point of a hub. Leaving does the one cleanup entering
 * elsewhere would want anyway — aborting a running review.
 */
export function WorkspaceView() {
  const roomy = useWorkspaceViewport();
  return roomy ? <Workspace /> : <WorkspaceGate />;
}

/**
 * Below the viewport gate the premise — several contexts at once — is
 * void, so the page says so instead of squeezing: the same panes exist one
 * per page, and the card points at them. State is not lost by shrinking;
 * everything lives in the global stores, so widening the window back
 * restores the workspace as it was.
 */
function WorkspaceGate() {
  return (
    <div className="optical-center h-full p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-2xl">
          <LayoutDashboard className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t('Workspace')}</h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t(
            'The workspace shows the board, the moves, the explorer and the games browser side by side, and needs a window wide enough to hold them all. On this screen its panes are pages of their own.',
          )}
        </p>
        {/* Both secondary: the error card this borrowed from RECOMMENDS
            Reload over Go home, but Board and Games are equal
            destinations here, and an emphasized first button claimed a
            preference nobody argued (lanph3re's question). */}
        <div className="mt-1 flex gap-2">
          <Button variant="secondary" onClick={() => navigate('board')}>
            {t('Board')}
          </Button>
          <Button variant="secondary" onClick={() => navigate('games')}>
            {t('Games')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Where the Analysis panel's fold is remembered across sessions. */
const ANALYSIS_FOLD = 'vault:workspace-analysis';

/**
 * What the board wrapper stacks around the board at `wide`, in px: a
 * player bar (~h-9) + gap-2 on each side of the board — the top strip
 * sits at natural height here (alignPlayersTo="panels"), not the board
 * pages' h-10 reserve. Part of the --board-budget arithmetic — the
 * workspace's stand-in for the 10rem the full-viewport pages reserve.
 */
const BOARD_STRIPS_PX = 88;

/** The shell's own chrome around the top row, in px: p-4 above and below
    (32) plus the gap-3 between the row and the games band (12). */
const SHELL_CHROME_PX = 44;

/**
 * The games band's floor, in px (matches its min-h-72 class). The band is
 * flex-1 — everything the board cannot spend is its to show rows in — and
 * this floor is what the board's budget is computed AROUND, so the board
 * only ever grows into height the band keeps anyway. 18rem, down from
 * 20: with the band's chrome folded to one row the floor still holds
 * ~5 table rows, and the two reclaimed rems are the board's
 * (lanph3re asked for a bit more board).
 */
const BAND_MIN_PX = 288;

/** The board column's width bounds: the 18rem usability floor every board
    page keeps, and the 64rem ceiling lg imposes so panes keep room. */
const clampBoardWidth = (px: number): number => Math.min(Math.max(px, 288), 1024);

/** The moves and explorer columns' caps, in px — the max-w-[30rem] and
    max-w-[32rem] on their classes below, written down once more so the
    page's own width cap (board + both columns + gaps) can be computed:
    past ~30rem a move list or an explorer table is blank space between a
    name and its number. */
const MOVES_MAX_PX = 480;
const EXPLORER_MAX_PX = 512;

/** And their floors (the min-w classes below), which the BOARD answers
    to: the board column takes its height budget as an explicit width,
    and on a tall window that budget plus these floors outgrew the row —
    the explorer stood flush against the viewport's edge with the
    shell's padding overflowed past it (lanph3re's report). The board
    yields first: its width is capped at what the row holds after the
    floors, measured on the width-cap wrapper. */
const MOVES_MIN_PX = 272;
const EXPLORER_MIN_PX = 304;
const REGION_GAPS_PX = 24;

function Workspace() {
  // The explorer is a dedicated column here, so it opens open: a page
  // whose third column is a folded header reads as broken, not as a
  // remembered preference. The switch in its header still works.
  useEffect(() => {
    if (!useExplorer.getState().enabled) useExplorer.setState({ enabled: true });
  }, []);

  // Same rule as the Board page: a review left running would walk the
  // whole game on background threads with no visible sign elsewhere.
  useEffect(
    () => () => {
      if (useReview.getState().status === 'running') useReview.getState().clear();
    },
    [],
  );

  const openingTree = useAnalysis((s) => s.tree);
  const openingCursor = useAnalysis((s) => s.cursorId);
  const openingName = useOpeningName(
    useMemo(
      () => pathTo(openingTree, openingCursor).map((id) => getNode(openingTree, id).fen),
      [openingTree, openingCursor],
    ),
  );
  const [loadOpen, setLoadOpen] = useState(false);

  // For the Analysis panel's hint: shown only where ReviewStrip itself
  // has nothing to draw — no game and no moves means no offer, no
  // progress, no summary.
  const hasGame = useAnalysis((s) => s.gameHeaders) !== null;
  const hasMoves = useAnalysis((s) => getNode(s.tree, s.tree.rootId).children.length > 0);
  const reviewIdle = useReview((s) => s.status) === 'idle';

  // The Analysis panel's fold, remembered the way the strip remembers its
  // graph fold: someone who wants the explorer's rows more than the
  // review wants that tomorrow too.
  const [analysisOpen, setAnalysisOpen] = useState(
    () => localStorage.getItem(ANALYSIS_FOLD) !== 'closed',
  );
  const toggleAnalysis = (): void => {
    setAnalysisOpen((open) => {
      localStorage.setItem(ANALYSIS_FOLD, open ? 'closed' : 'open');
      return !open;
    });
  };

  // Two measurements, no cycle between them. The SHELL's height fixes the
  // board's budget (shell minus its chrome, the band's floor and the
  // strips around the board — see boardSize.ts for who reads the
  // variable): the viewport formula every other board page uses assumes
  // the board owns the window, and here the games band owns the bottom of
  // it. The BOARD COLUMN's resulting height then sizes the top row
  // exactly, so the panels beside the board end where the board block
  // ends — bottom player bar included — instead of running past it, and
  // everything the board cannot spend (its 64rem cap on tall windows)
  // falls through to the band as rows rather than sitting under the board
  // as air. The column is measured, not computed: its height is the end
  // of the min/max chain in boardSize.ts, the same reason
  // publishBoardHeight measures on the board pages.
  const [shellRef, shellH] = useElementHeight();
  const budget = Math.max(0, shellH - SHELL_CHROME_PX - BAND_MIN_PX - BOARD_STRIPS_PX);

  // The board column's height, measured two ways on one element: a
  // ResizeObserver for content-driven changes, and a layout effect keyed
  // on the budget for the change the observer only reports a frame late —
  // the shell's first measurement lands as state, the wrapper's width
  // changes in the SAME commit, and the row's height must not spend a
  // paint holding the stale answer.
  const boardColEl = useRef<HTMLDivElement | null>(null);
  const [boardColH, setBoardColH] = useState(0);
  const boardColRO = useRef<ResizeObserver | null>(null);
  const boardColRef = useCallback((el: HTMLDivElement | null) => {
    boardColRO.current?.disconnect();
    boardColRO.current = null;
    boardColEl.current = el;
    if (!el) return;
    const observer = new ResizeObserver(() => setBoardColH(el.clientHeight));
    observer.observe(el);
    setBoardColH(el.clientHeight);
    boardColRO.current = observer;
  }, []);
  useLayoutEffect(() => {
    if (boardColEl.current) setBoardColH(boardColEl.current.clientHeight);
  }, [budget]);
  const regionStyle =
    shellH > 0
      ? ({
          '--board-budget': `${budget}px`,
          ...(boardColH > 0 ? { height: boardColH } : null),
        } as CSSProperties)
      : undefined;

  // The board column's width: its height budget, capped by what the row
  // actually holds once the other columns keep their floors — see
  // MOVES_MIN_PX. Measured on the width-cap wrapper below.
  const [capRef, capW] = useElementWidth();
  const boardColW =
    capW > 0
      ? Math.max(
          288,
          Math.min(clampBoardWidth(budget), capW - MOVES_MIN_PX - EXPLORER_MIN_PX - REGION_GAPS_PX),
        )
      : clampBoardWidth(budget);

  // --- the games band -------------------------------------------------
  // The band is the GamesBrowser — the Games page's own tabbed pane,
  // collection included — and this is just the selection it emits.
  const [sel, setSel] = useState<DetailsSelection | null>(null);

  // The explorer's hunt button, pointed at the band instead of #/games:
  // same mailbox the cross-page handoff uses, consumed the same way (on
  // the browser's mount — a pending hunt makes it open on Databases) —
  // the key bump is what makes an already-mounted browser remount and
  // consume it.
  const [huntSeq, setHuntSeq] = useState(0);
  const huntInBand = useCallback((fen: string, db: string): void => {
    handOffPositionHunt(fen, db);
    setSel(null);
    setHuntSeq((n) => n + 1);
  }, []);

  // Selecting a row loads the game onto the board, in place — the whole
  // reason this page exists, and why there is no details column: the
  // board IS the details panel. Sequenced like GameDetailsContent, so
  // arrowing down a list cannot let a slow fetch land on top of a later
  // pick. Keyed on the selection's identity; the packaged loadPgn is a
  // fresh closure every render and must not re-fetch per render.
  const seq = useRef(0);
  useEffect(() => {
    if (!sel?.loadPgn) return;
    const mine = ++seq.current;
    void sel
      .loadPgn()
      .then((pgn) => {
        if (!pgn || seq.current !== mine) return;
        // A review belongs to the game it judged; a new game clears it
        // the way entering the Board page fresh does.
        useReview.getState().clear();
        if (useAnalysis.getState().loadPgn(pgn) && sel.summary.userSide) {
          // Archive rows are the user's own games: seen from their side,
          // exactly as the archive's own open does.
          useAnalysis.setState({ orientation: sel.summary.userSide });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the selection's identity
  }, [sel?.key]);

  return (
    <div ref={shellRef} className={WORKSPACE_SHELL}>
      <h1 className="sr-only">{t('Workspace')}</h1>

      {/* The page's one width cap, over the row AND the games band: what
          the board and the two capped columns can spend together. Capping
          only the row left the band running the full window under a
          centred trio, so its columns started nowhere in particular —
          mx-auto centres both as one block, the board-row-cap judgment
          applied to the whole page. */}
      <div
        ref={capRef}
        style={
          budget > 0
            ? { maxWidth: boardColW + MOVES_MAX_PX + EXPLORER_MAX_PX + REGION_GAPS_PX }
            : undefined
        }
        className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-3"
      >
      {/* The top row: board, moves + engine, explorer. Its height is the
          board column's own (see the measurement note above), so the
          panels stretch to end exactly where the board block does. The
          moves and explorer columns carry caps — a move list and an
          explorer table past ~30rem are blank space between a name and
          its number. min-h keeps the row a row before the first
          measurement and on short windows; past it the shell scrolls. */}
      <div style={regionStyle} className="flex min-h-[22rem] shrink-0 gap-3">
        {/* self-start, so the wrapper's height is the column's content
            height and not the row's — this is the element the region's
            own height is measured FROM. Width is the budget, stated on
            the wrapper rather than left to flex: a flex-grown column
            collects the row's surplus and centres the board in it, which
            put the surplus BETWEEN the columns (layout.ts tells this
            story twice). */}
        <div
          ref={boardColRef}
          style={budget > 0 ? { width: boardColW } : undefined}
          className="flex flex-none self-start"
        >
          {/* verticalKeys off: ↑/↓ browse the games band's rows here
              (useTableNav), and both listeners answering at once stepped
              the list AND threw the board to an end. Home/End still jump
              the board. */}
          <AnalysisBoard
            editablePlayers
            nav={false}
            verticalKeys={false}
            alignPlayersTo="panels"
          />
        </div>

        {/* The Board page's moves panel, rearranged: engine docked on
            top, the opening's own name as the title, the board's
            navigation at the foot. Same parts, same order, no copies. */}
        <Panel className="flex min-w-[17rem] max-w-[30rem] flex-1 flex-col">
          <EngineBlock />
          <PanelHeader
            title={openingName ?? 'Starting position'}
            actions={
              <>
                <SidelinesToggle />
                <CollectGameButton />
                <LoadPositionButton open={loadOpen} onOpenChange={setLoadOpen} />
                <MoveActions allowClear />
                {/* ownReview: the Analysis panel's header carries the
                    review button on this page. */}
                <MovesOverflow allowClear ownReview onLoadPosition={() => setLoadOpen(true)} />
              </>
            }
          />
          <MoveTreePane />
          <BoardControls
            className="border-border -mb-(--card-spacing) border-t"
           
          />
        </Panel>

        {/* The third column: the explorer over the Analysis panel. On the
            Board page both dock in the one side column; here the review's
            summary earns a panel of its own (lanph3re's ask), so the
            moves panel keeps its full height for moves and the explorer
            gives up only what the review actually draws. No resizeKey on
            the explorer: the grip resizes a panel in a stack against a
            stored height, and this stack sizes itself. */}
        <div className="flex min-w-[19rem] max-w-[32rem] flex-1 flex-col gap-3">
          <ExplorerPane className="min-h-0 flex-1" onPositionHunt={huntInBand} />
          {/* The same ReviewStrip the Board page docks under its move
              list, hosted as a panel: every state it draws (the offer,
              progress, the graph and summary) is this panel's content,
              and the header's button is the trigger. panel mode takes the
              strip's own fold and dismiss away — the header's chevron is
              the one fold here, and folding is this panel's close. The
              hint stands in only where the strip has nothing to say, and
              both take back the card's floor the way BoardControls does:
              a band is the panel's bottom edge. */}
          <Panel fit className={cn('shrink-0', !analysisOpen && 'pb-0')}>
            <PanelHeader
              title="Analysis"
              actions={
                <>
                  {/* Hidden while the offer row below shows its own
                      labelled Review game button — two triggers for one
                      act, an icon directly above its labelled twin, was
                      one too many. The icon returns once a review is
                      done and re-running is the header's quiet verb. */}
                  {!(reviewIdle && hasGame && hasMoves) && <ReviewButton />}
                  {/* The same switch the explorer's header wears — one
                      folding grammar for the workspace's foldable panels
                      (lanph3re's call, replacing a chevron). */}
                  <Switch
                    checked={analysisOpen}
                    onCheckedChange={toggleAnalysis}
                    aria-label={t('Analysis on/off')}
                    title={analysisOpen ? t('Hide the analysis') : t('Show the analysis')}
                  />
                </>
              }
            />
            {analysisOpen && (
              <>
                <ReviewStrip panel className="-mb-(--card-spacing)" />
                {reviewIdle && !(hasGame && hasMoves) && (
                  <p className="text-muted-foreground border-border -mb-(--card-spacing) border-t px-3 py-2 text-sm">
                    {t('Play moves or load a game, then run an engine review.')}
                  </p>
                )}
              </>
            )}
          </Panel>
        </div>
      </div>

      {/* The games band: the Games page's own tabbed browser — the
          collection included — as a full-width strip; game rows are
          tables and want width, not a column's sliver. flex-1 with a
          floor (BAND_MIN_PX is this min-h in px): the row above is
          exactly the board's height, so every line the board leaves is
          a game row here. Selecting any row previews it on the board
          (the load effect above); opening a collection game goes to its
          document page, because annotating is a document's work. */}
      <GamesBrowser
        key={huntSeq}
        table
        inPlace
        onSelect={setSel}
        className="min-h-72 flex-1"
      />
      </div>
    </div>
  );
}
