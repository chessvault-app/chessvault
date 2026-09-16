import { PageShell } from '@/components/page-shell';
import { ShelfHeader } from '@/components/shelf-outline';
import { SkeletonBoard, SkeletonCards } from '@/components/skeletons';
import { readShelfLayout, readShelfShape, shelfHasShape } from '@/components/shelf-reservation';
import { t } from '@/lib/i18n';

/**
 * The Studies section while its chunk is on the wire.
 *
 * Drawn with the route's own params (lib/lazyRoute passes the page's
 * props): an id opens a study, which is a board beside its moves, and
 * nothing opens the shelf.
 *
 * The open study's picture is SkeletonBoard alone here, where StudyView
 * draws it with the player bars this document wore last visit and with
 * the phone's bottom bar claimed. Both of those are keyed on the
 * document or reach into the board's own chunk; they join this outline
 * when the board family is converted.
 */
export default function StudiesOutline({ params }: { params: string[] }) {
  return params[0] ? <SkeletonBoard chapters explorer /> : <ShelfOutline />;
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
  return (
    <PageShell width="wide">
      <ShelfHeader title={t('Studies')} search={t('Search studies…')} subtitle={has} />
      {has && <StudiesCards layout={readShelfLayout('studies')} groups={groups} />}
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
