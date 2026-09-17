import { PageShell } from '@/components/page-shell';
import { OutlineCreate, ShelfHeader } from '@/components/shelf-outline';
import { readShelfView } from '@/components/shelf-toolbar';
import { SkeletonCards } from '@/components/skeletons';
import StudyOutline from '@/studies/StudyView.skeleton';
import { decodeSegment } from '@/lib/router';
import { readShelfShape, shelfHasShape } from '@/components/shelf-reservation';
import { t } from '@/lib/i18n';

/**
 * The Studies section while its chunk is on the wire.
 *
 * Drawn with the route's own params (lib/lazyRoute passes the page's
 * props): an id opens a study, which is a board beside its moves, and
 * nothing opens the shelf.
 *
 * An open study draws the shared document outline, the same module
 * StudyView draws while the document itself is in flight
 * (./StudyView.skeleton), so the board cannot land in two places.
 */
export default function StudiesOutline({ params = [] }: { params?: string[] }) {
  return params[0] ? <StudyOutline id={decodeSegment(params[0])} /> : <ShelfOutline />;
}

/**
 * The shelf: its name, its count line, its search field and the cards it
 * held last visit.
 *
 * A shelf whose stored shape says nothing draws NO cards, which is the
 * page's own rule — a vault seen empty settles on an EmptyState, and
 * invented cards would be the jump the other way (StudiesView).
 *
 * Read per render rather than held in state, as SkeletonBoard reads its
 * stored panel height: the wait this stands through cannot change what
 * the last visit recorded.
 */
function ShelfOutline() {
  const groups = readShelfShape('studies');
  const has = shelfHasShape(groups);
  const view = readShelfView('studies');
  return (
    <PageShell width="wide">
      <ShelfHeader
        title={t('Studies')}
        search={t('Search studies…')}
        subtitle={has}
        sort={view.sort}
        dir={view.dir}
        layout={view.layout}
        // New study, New folder, Import PGN, From Lichess (CreateMenu).
        create={<OutlineCreate actions={4} />}
      />
      {has && <StudiesCards layout={view.layout} groups={groups} />}
    </PageShell>
  );
}

/**
 * The cards alone, for the wait AFTER the chunk: StudiesView draws these
 * under its own live toolbar while the listing is out. Same component,
 * same arguments, so the two waits cannot disagree about a card's size.
 *
 * A study's card always opens on a 64px board, which is what `cover`
 * defaults to (SkeletonCards).
 */
export function StudiesCards({
  layout,
  groups,
}: {
  layout: 'grid' | 'list';
  groups: { root: number; folders: number[]; heights?: number[] };
}) {
  return <SkeletonCards layout={layout} groups={groups} />;
}
