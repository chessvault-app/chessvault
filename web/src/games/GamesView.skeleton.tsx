import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import StudyOutline from '@/studies/StudyView.skeleton';
import { decodeSegment } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * The Games section while its chunk is on the wire.
 *
 * A collected game is a study with player bars, drawn from the same
 * module the studies shelf draws one from (studies/StudyView.skeleton),
 * so the two cannot disagree about where the board sits. `elite` is a
 * retired hash that lands on the collection, as GamesView reads it.
 *
 * The collection itself gets its shell and its name and no body. Its
 * outline is a tab strip, a search row, a filter rail and then a table
 * whose columns depend on the window — real controls, in the page's own
 * chunk. Reserving the rows without the rail above them is the promise
 * the page then breaks: drawn that way the rows stood 86px high, and in
 * card shape where the desktop draws one-line table rows. The strip and
 * the rail arrive into empty space instead and push nothing down.
 */
export default function GamesOutline({ params = [] }: { params?: string[] }) {
  const id = params[0] && params[0] !== 'elite' ? decodeSegment(params[0]) : null;
  return id ? (
    <StudyOutline id={id} kind="game" />
  ) : (
    <PageShell
      // xwide and unscrolling, as CollectionView: at lg the page is a
      // data table beside a details column, and its lists scroll
      // themselves so the page never does.
      width="xwide"
      scroll={false}
      className="h-full overflow-hidden pb-3 sm:pb-4 md:pb-6"
    >
      <PageHeader title={t('Games')} />
    </PageShell>
  );
}
