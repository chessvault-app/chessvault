import { PageShell } from '@/components/page-shell';
import { OutlineCreate, ShelfHeader } from '@/components/shelf-outline';
import { readShelfView } from '@/components/shelf-toolbar';
import { SkeletonCards } from '@/components/skeletons';
import { readShelfShape, shelfHasShape } from '@/components/shelf-reservation';
import NoteOutline from '@/notes/NoteView.skeleton';
import { t } from '@/lib/i18n';

/**
 * The Notes section while its chunk is on the wire.
 *
 * Drawn with the route's own params (lib/lazyRoute passes the page's
 * props), so it answers the same question NotesView answers from them:
 * a note's id opens a document, and nothing opens the shelf. Without
 * that the shelf's cards stood in for a page that was about to draw
 * prose.
 */
export default function NotesOutline({ params = [] }: { params?: string[] }) {
  return params[0] ? <NoteOutline /> : <ShelfOutline />;
}

/**
 * The shelf: its name, its count line, its search field and the cards it
 * held last visit.
 *
 * A shelf whose stored shape says nothing draws NO cards, which is the
 * page's own rule — a vault seen empty settles on an EmptyState, and
 * invented cards would be the jump the other way (NotesView).
 *
 * Read per render rather than held in state, as SkeletonBoard reads its
 * stored panel height: the wait this stands through cannot change what
 * the last visit recorded.
 */
function ShelfOutline() {
  const groups = readShelfShape('notes');
  const has = shelfHasShape(groups);
  const view = readShelfView('notes');
  return (
    <PageShell width="wide">
      <ShelfHeader
        title={t('Notes')}
        search={t('Search notes…')}
        subtitle={has}
        sort={view.sort}
        dir={view.dir}
        layout={view.layout}
        // New note, New folder (CreateMenu).
        create={<OutlineCreate actions={2} />}
      />
      {has && <NotesCards layout={view.layout} groups={groups} />}
    </PageShell>
  );
}

/**
 * The cards alone, for the wait AFTER the chunk: NotesView draws these
 * under its own live toolbar while the listing is out. Same component,
 * same arguments, so the two waits cannot disagree about a card's size.
 *
 * `cover={false}`: a note mostly has no board, it has a 16px glyph where
 * one would be, and a board-sized block over a glyph reads as the wrong
 * shelf (SkeletonCards). The grid is the notes shelf's own three
 * columns.
 */
export function NotesCards({
  layout,
  groups,
}: {
  layout: 'grid' | 'list';
  groups: { root: number; folders: number[]; heights?: number[] };
}) {
  return (
    <SkeletonCards
      layout={layout}
      groups={groups}
      cover={false}
    />
  );
}
