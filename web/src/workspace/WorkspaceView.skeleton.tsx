import { Bookmark, LayoutDashboard } from 'lucide-react';
import { PageGate } from '@/components/page-gate';
import { Panel, PanelHeader } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { SearchInput, searchRowClass } from '@/components/text-fields';
import { Inert, Skeleton } from '@/components/skeletons';
import { WORKSPACE_SHELL } from '@/components/layout';
import { GameListShell } from '@/games/GameListShell';
import { GamesTabStrip } from '@/games/GamesTabStrip';
import { GameTableHeader, gameTableColumns } from '@/games/GameTable';
import { useWorkspaceViewport } from '@/lib/media';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
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
 * full-width games band, at the proportions the page's own flex rules
 * give them BEFORE it measures anything. That is not an approximation of
 * the settled page — it is the page's own first frame. The workspace
 * measures its board column and publishes a budget (boardSize), and
 * until that measurement lands the real page lays this row out exactly
 * this way; the outline simply cannot make the measurement, because the
 * thing being measured is the board it does not have.
 *
 * So the three regions land where they land and the board block inside
 * the first one is a square of its column's width. The panels' own
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
  return (
    <div className={WORKSPACE_SHELL} role="status" aria-label={t('Loading')} aria-live="polite">
      <Inert>
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-3">
        <div className="flex min-h-[22rem] shrink-0 gap-3">
          {/* The board's column: `flex-none self-start` as the page has
              it, with no width until the page measures one — so the
              square takes the room the two capped columns leave, which
              is what the page's first frame does too. */}
          <div className="flex min-w-[20rem] flex-1 self-start">
            <Skeleton className="aspect-square w-full rounded-xl" />
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
              <p className="text-muted-foreground px-3 pb-3 text-sm">
                {t('Play moves or load a game, then run an engine review.')}
              </p>
            </Panel>
          </div>
        </div>
        {/* The games band: the Games page's own browser as a full-width
            strip, in its panel frame. Drawn from the browser's own
            pieces — its tab strip, and the shell that owns every band's
            padding and rule — so this is the band's geometry and not an
            impression of it. The band is `flex-1` under a row whose
            height is the board's, so it takes whatever the row leaves;
            without its contents that was the page's largest empty
            rectangle, on its longest download. */}
        <Panel className="min-h-72 flex-1">
          <GamesTabStrip value="collection" onValueChange={NOOP} frame="panel" />
          <GameListShell
            shape="panel"
            dense
            denseColumns={gameTableColumns(false, true)}
            rowBookmark
            rowLink
            listLoading
            filtersLoading
            listHeader={<GameTableHeader />}
            toolbar={
              <div className={cn('flex w-full items-center gap-1.5', searchRowClass)}>
                <SearchInput
                  type="text"
                  inputSize="sm"
                  value=""
                  readOnly
                  placeholder={t('Search collection…')}
                  aria-label={t('Search collection…')}
                  className="min-w-0 flex-1"
                />
                <Button variant="secondary" size="icon-sm" className="shrink-0">
                  <Bookmark className="glyph" />
                </Button>
              </div>
            }
          />
        </Panel>
      </div>
      </Inert>
    </div>
  );
}

const NOOP = (): void => {};
