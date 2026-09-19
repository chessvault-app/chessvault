import { LayoutDashboard } from 'lucide-react';
import { PageGate } from '@/components/page-gate';
import { Panel, PanelHeader } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { Inert, Skeleton, SkeletonPlayerBar } from '@/components/skeletons';
import { WORKSPACE_SHELL } from '@/components/layout';
import { useWorkspaceBudget } from './board-budget';
import { CollectionPaneOutline } from '@/games/GamesView.skeleton';
import { useWorkspaceViewport } from '@/lib/media';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * The workspace while its chunk is on the wire.
 *
 * It drew nothing, with the editor, the repertoire trainer and the
 * opening map. That was the worst of the four: the workspace's chunk is
 * the heaviest in the app — a board, an engine, an explorer, a move tree
 * and the whole games browser — so the reader with the longest wait was
 * the one shown the least.
 *
 * What it draws is the page's own family (WORKSPACE_SHELL, one of the
 * four in components/layout): the top row of three regions over the
 * full-width games band, sized by the page's own arithmetic
 * (workspace/board-budget). It used to stop at the proportions the flex
 * rules give BEFORE the page measures anything, on the argument that
 * this is the page's first frame. It is, and the second frame is the one
 * the reader is left with: the band stood 88px high of it at 1280x800.
 * The measurement needs the shell's height and the row's width and no
 * board, so the outline makes it too.
 *
 * So the three regions land where the page puts them and the board block
 * is a square of the budget's width between its two player bars. The panels' own
 * headers are the real words, since none of them waits on anything: the
 * moves panel opens on the position's name, which the page prints as
 * "Starting position" until a game is loaded, and the explorer and
 * Analysis panels are named outright.
 *
 * Below the page's own viewport gate there is no workspace at all, just
 * a card saying so and two ways out (WorkspaceGate) — so the outline asks
 * the same media query and draws the same card. It is three fixed
 * sentences and two buttons: nothing in it waits on anything, and an
 * outline of a three-pane workspace on a phone would be a picture of a
 * page that is not coming.
 */
export default function WorkspaceOutline() {
  const roomy = useWorkspaceViewport();
  if (!roomy)
    return (
      <PageGate
        icon={LayoutDashboard}
        title={t('Workspace')}
        body={t(
          'The workspace needs a window wide enough for the board, the moves, the explorer and the games browser side by side. On this screen each pane is a page of its own.',
        )}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('board')}>
              {t('Board')}
            </Button>
            <Button variant="secondary" onClick={() => navigate('games')}>
              {t('Games')}
            </Button>
          </>
        }
      />
    );
  return <Regions />;
}

/**
 * The regions, sized by the page's own arithmetic (workspace/board-budget):
 * the shell's height gives the board its budget, the board's column is
 * that wide, and the row is as tall as the column, which is the board
 * between its two player bars. A component of its own because the gate
 * above returns before any of this is measured.
 */
function Regions() {
  // No eval lane: the engine opens off, and a lane is added only while a
  // bar is drawn.
  const { shellRef, capRef, budget, boardColW, capMaxWidth } = useWorkspaceBudget(0);
  return (
    <div ref={shellRef} className={WORKSPACE_SHELL} role="status" aria-label={t('Loading')} aria-live="polite">
      <Inert>
      <div
        ref={capRef}
        style={budget > 0 ? { maxWidth: capMaxWidth } : undefined}
        className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-3"
      >
        <div className="flex min-h-[22rem] shrink-0 gap-3">
          {/* The board's column: `flex-none self-start` at the budget's
              width, as the page states it, holding what the page stacks
              there: a player bar, the board, a player bar. The bars
              stand at their natural 22px here and not the 24px line the
              board pages reserve (alignPlayersTo="panels"), measured on
              the page: a 380px board in a 440px column. The budget sets
              aside more than that and the band takes what is not spent. */}
          <div
            style={budget > 0 ? { width: boardColW } : undefined}
            className="flex flex-none flex-col gap-2 self-start"
          >
            <SkeletonPlayerBar className="h-[22px]" />
            <Skeleton className="aspect-square w-full rounded-lg" />
            <SkeletonPlayerBar className="h-[22px]" />
          </div>
          {/* The moves column, engine docked on top of it. */}
          <Panel className="flex min-w-[17rem] max-w-[30rem] flex-1 flex-col">
            <PanelHeader title={t('Engine')} />
            <PanelHeader title={t('Starting position')} />
            <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className={`h-2.5 shrink-0 ${i % 2 ? 'w-3/5' : 'w-4/5'}`} />
              ))}
            </div>
          </Panel>
          {/* The third column: the explorer over the Analysis panel. */}
          <div className="flex min-w-[19rem] max-w-[32rem] flex-1 flex-col gap-3">
            <Panel className="min-h-0 flex-1">
              <PanelHeader title={t('Explorer')} />
              <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-3 shrink-0" />
                ))}
              </div>
            </Panel>
            <Panel fit className="shrink-0">
              <PanelHeader title={t('Analysis')} />
              <AnalysisHint />
            </Panel>
          </div>
        </div>
        {/* The games band: the Games page's own browser as a full-width
            strip, in its panel frame. It is the Games outline's own pane
            (CollectionPaneOutline), in the other of its two boxes, so
            this is the band's geometry and not an impression of it. The band is `flex-1` under a row whose
            height is the board's, so it takes whatever the row leaves;
            without its contents that was the page's largest empty
            rectangle, on its longest download. */}
        <Panel className="min-h-72 flex-1">
          <CollectionPaneOutline frame="panel" />
        </Panel>
      </div>
      </Inert>
    </div>
  );
}

/**
 * What the Analysis panel says before there is anything to review: the
 * page's own line, under its rule and on the card's floor, drawn by the
 * page and by this outline. The outline had its own paragraph, padded as
 * a body rather than as the band the page draws, and its card stood 11px
 * taller than the one that landed (check:skeletons).
 */
export function AnalysisHint() {
  return (
    <p className="text-muted-foreground border-border -mb-[var(--card-floor,var(--card-spacing))] border-t px-3 py-2 text-sm">
      {t('Play moves or load a game, then run an engine review.')}
    </p>
  );
}
