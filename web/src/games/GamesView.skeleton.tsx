import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { SearchInput, searchRowClass } from '@/components/text-fields';
import { Inert } from '@/components/skeletons';
import { GamesTabStrip } from '@/games/GamesTabStrip';
import StudyOutline from '@/studies/StudyView.skeleton';
import { decodeSegment } from '@/lib/router';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The Games section while its chunk is on the wire.
 *
 * A collected game is a study with player bars, drawn from the same
 * module the studies shelf draws one from (studies/StudyView.skeleton),
 * so the two cannot disagree about where the board sits. `elite` is a
 * retired hash that lands on the collection, as GamesView reads it.
 */
export default function GamesOutline({ params = [] }: { params?: string[] }) {
  const id = params[0] && params[0] !== 'elite' ? decodeSegment(params[0]) : null;
  return id ? <StudyOutline id={id} kind="game" /> : <CollectionOutline />;
}

/**
 * The collection: its name, the strip of places a game comes from, and
 * the search row under it.
 *
 * Everything here is known before anything is fetched, and all of it is
 * the real control held inert (skeletons, `INERT`) rather than a grey
 * box of its size: the strip is the browser's own component
 * (./GamesTabStrip), the field is the same SearchInput on the same
 * `searchRowClass` the toolbar puts it on.
 *
 * NO ROWS, and that is the interesting part. Whether this page draws
 * one-line table rows or three-line cards, and whether the filter
 * controls stand in their own band or fold up into the search row,
 * depends on a width the browser MEASURES from the strip it has just
 * drawn (GamesBrowser, `merged`), on top of a media query and a stored
 * pin. Reserving rows without that is guessing at their height, and the
 * guess is expensive when it is wrong: measured at 1200px, six card
 * placeholders came to 509px against the 204px of table rows that
 * replaced them. So the rows arrive into empty space under a rail that
 * is already in the right place, and push nothing down.
 *
 * Drawing them faithfully means giving the outline the same measurement
 * the browser makes, which is the browser's layout decisions lifted into
 * something both can read — worth doing, and not worth guessing at in
 * the meantime.
 */
function CollectionOutline() {
  return (
    <PageShell
      // xwide and unscrolling, as CollectionView: at lg the page is a
      // data table beside a details column, and its lists scroll
      // themselves so the page never does.
      width="xwide"
      scroll={false}
      className="h-full overflow-hidden pb-3 sm:pb-4 md:pb-6"
    >
      <PageHeader title={t('Games')} />
      {/* The browser's own box on a page: a column with the card
          variable pinned to the ground, which is what Box draws for
          `frame="page"` (GamesBrowser). */}
      <Inert>
        <div className="flex min-h-0 flex-col [--card:var(--background)]">
          <GamesTabStrip value="collection" onValueChange={NOOP} frame="page" />
          <div className={cn('flex w-full items-center gap-1.5 py-2', searchRowClass)}>
            <SearchInput
              type="text"
              inputSize="sm"
              value=""
              readOnly
              placeholder={t('Search collection…')}
              aria-label={t('Search collection…')}
              className="min-w-0 flex-1"
            />
          </div>
        </div>
      </Inert>
    </PageShell>
  );
}

const NOOP = (): void => {};
