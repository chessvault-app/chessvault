import { PanelsTopLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getNode, pathTo } from '@shared/tree';
import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { EngineBlock } from '@/engine/EnginePane';
import { ReviewButton, ReviewStrip } from '@/engine/ReviewStrip';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { CollectGameButton, MoveActions, MovesOverflow } from '@/analysis/AnalysisView';
import { MoveTreePane, SidelinesToggle } from '@/analysis/MoveTreePane';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import { ArchiveBrowser } from '@/games/ArchiveBrowser';
import { DatabaseGames, handOffPositionHunt } from '@/games/DatabaseGames';
import { GamePreview, type Preview } from '@/games/shared';
import { type DetailsSelection } from '@/games/GameDetails';
import { loadCollection } from '@/games/collection';
import { useAnalysis } from '@/store/analysis';
import { useExplorer } from '@/store/explorer';
import { useReview } from '@/store/review';
import { useOpeningName } from '@/lib/opening';
import { useWorkspaceViewport } from '@/lib/media';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/panel';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WORKSPACE_SHELL } from '@/components/layout';
import { useElementHeight } from '@/hooks/use-element-height';

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
          <PanelsTopLeft className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t('Workspace')}</h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t(
            'The workspace shows the board, the moves, the explorer and the games browser side by side, and needs a window wide enough to hold them all. On this screen its panes are pages of their own.',
          )}
        </p>
        <div className="mt-1 flex gap-2">
          <Button variant="secondary" onClick={() => navigate('board')}>
            {t('Board')}
          </Button>
          <Button variant="ghost" onClick={() => navigate('games')}>
            {t('Games')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The games band's tabs: the reference databases lead for the same
    reason they lead on the Games page, and each archive is its own tab.
    The collection is deliberately absent for now — its games are
    DOCUMENTS (annotatable, opened in the game viewer), and a band whose
    rows load onto a throwaway analysis board would quietly offer to
    treat them as less than they are. */
type BandTab = 'databases' | 'chesscom' | 'lichess';
const BAND_TABS: { id: BandTab; label: string }[] = [
  { id: 'databases', label: 'Databases' },
  // Site names, untranslated on purpose — same rule as the Games page.
  { id: 'chesscom', label: 'Chess.com' },
  { id: 'lichess', label: 'Lichess' },
];

/** Which band tab is showing, held outside the component so leaving the
    workspace and coming back lands on the tab that was left — the same
    mailbox shape (and reason) as CollectionView's heldTab. */
let heldBandTab: BandTab | null = null;

/**
 * What the board wrapper stacks around the board at `wide`, in px: the
 * player strip (h-10) + gap-2 over the board, the bottom player bar
 * (~h-9) + gap-2 under it. Subtracted from the measured region height to
 * make the --board-budget the board square itself can spend — the
 * workspace's stand-in for the 10rem the full-viewport pages reserve.
 */
const BOARD_STRIPS_PX = 92;

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

  // The board region measures itself and publishes the height budget the
  // board may spend (see boardSize.ts): the viewport formula every other
  // board page uses assumes the board owns the window, and here the games
  // band owns the bottom of it.
  const [regionRef, regionH] = useElementHeight();
  const regionStyle =
    regionH > 0
      ? ({ '--board-budget': `${Math.max(0, regionH - BOARD_STRIPS_PX)}px` } as CSSProperties)
      : undefined;

  // --- the games band -------------------------------------------------
  const [tab, setTabState] = useState<BandTab>(() => heldBandTab ?? 'databases');
  const [sel, setSel] = useState<DetailsSelection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const setTab = (next: BandTab): void => {
    heldBandTab = next;
    setTabState(next);
    // The old tab's rows are gone; the highlight must not survive them.
    // The board keeps what it holds — a selection paints the board, but
    // the board is not a details panel to be emptied.
    setSel(null);
  };

  // The explorer's hunt button, pointed at the band instead of #/games:
  // same mailbox the cross-page handoff uses, consumed the same way (on
  // the browser's mount) — the key bump is what makes an already-mounted
  // Databases tab remount and consume it.
  const [huntSeq, setHuntSeq] = useState(0);
  const huntInBand = useCallback((fen: string, db: string): void => {
    handOffPositionHunt(fen, db);
    heldBandTab = 'databases';
    setTabState('databases');
    setSel(null);
    setHuntSeq((n) => n + 1);
  }, []);

  /** What the archive tabs need to mark already-kept games. */
  const [collectionKeys, setCollectionKeys] = useState<Set<string>>(new Set());
  const reloadCollectionKeys = useCallback((): void => {
    void loadCollection()
      .then((games) =>
        setCollectionKeys(new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`))),
      )
      .catch(() => {});
  }, []);
  useEffect(reloadCollectionKeys, [reloadCollectionKeys]);

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
    <div className={WORKSPACE_SHELL}>
      <h1 className="sr-only">{t('Workspace')}</h1>

      {/* The top row: board, moves + engine, explorer — three columns,
          none of them centred (see WORKSPACE_SHELL). min-h keeps the row
          a row on short windows; past it the shell scrolls. */}
      <div ref={regionRef} style={regionStyle} className="flex min-h-[22rem] flex-1 gap-3">
        <AnalysisBoard editablePlayers nav={false} />

        {/* The Board page's moves panel, rearranged: engine docked on
            top, the opening's own name as the title, the board's
            navigation at the foot. Same parts, same order, no copies. */}
        <Panel className="flex w-[min(27rem,30%)] shrink-0 flex-col">
          <EngineBlock />
          <PanelHeader
            title={openingName ?? 'Starting position'}
            actions={
              <>
                <SidelinesToggle />
                <ReviewButton />
                <CollectGameButton />
                <LoadPositionButton open={loadOpen} onOpenChange={setLoadOpen} />
                <MoveActions allowClear />
                <MovesOverflow allowClear onLoadPosition={() => setLoadOpen(true)} />
              </>
            }
          />
          <MoveTreePane />
          <ReviewStrip />
          <BoardControls
            className="border-border -mb-(--card-spacing) border-t"
            keyboard={false}
          />
        </Panel>

        {/* The explorer as a full-height column of its own — on the Board
            page it shares the side column and is capped for it; here it
            has the height the region has. No resizeKey: the grip resizes
            a panel in a stack, and this panel is alone in its column. */}
        <ExplorerPane className="min-w-0 flex-1" onPositionHunt={huntInBand} />
      </div>

      {/* The games band: the Games page's browser as a full-width strip —
          game rows are tables and want width, not a column's sliver. */}
      <Panel className="h-80 shrink-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as BandTab)} className="contents">
          <div className="border-border scrollbar-hidden box-content flex h-10 shrink-0 items-center overflow-x-auto overflow-y-hidden border-b">
            <TabsList
              variant="line"
              aria-label={t('What the pane is showing')}
              className="flex w-max min-w-full items-center justify-start gap-1 rounded-none border-0 bg-transparent p-0 px-2"
            >
              {BAND_TABS.map(({ id, label }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="h-10 min-w-0 flex-none rounded-none px-1.5 font-semibold group-data-horizontal/tabs:after:bottom-0"
                >
                  <span className="truncate">{t(label)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        {tab === 'databases' ? (
          <DatabaseGames
            key={huntSeq}
            shape="panel"
            table
            inPlace
            onSelect={setSel}
            selectedKey={sel?.key ?? null}
          />
        ) : (
          <ArchiveBrowser
            table
            inPlace
            site={tab}
            collectionKeys={collectionKeys}
            onCollected={reloadCollectionKeys}
            onPreview={setPreview}
            onSelect={setSel}
            selectedKey={sel?.key ?? null}
          />
        )}
      </Panel>

      <GamePreview preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
