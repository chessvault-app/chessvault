import { PageShell } from '@/components/page-shell';
import { OutlineCreate, ShelfHeader } from '@/components/shelf-outline';
import { readShelfOrder, type ShelfDir, type ShelfSorts } from '@/components/shelf-toolbar';
import { SkeletonBookCards } from '@/components/skeletons';
import { readShelfShape, shelfHasShape } from '@/components/shelf-reservation';
import { t } from '@/lib/i18n';

/**
 * How the library is ordered. Remembered on the device, like the other
 * shelves' view settings; a new sort starts in its own natural
 * direction.
 *
 * Here rather than in BooksPage because the OUTLINE prints the chosen
 * order in the select before the page's chunk exists, and a second copy
 * of this list would be a second answer to what the shelf can be sorted
 * by. BooksPage imports it from here, as it imports the cards.
 */
export type LibrarySort = 'title' | 'added' | 'size' | 'read';

export const LIBRARY_SORTS: ShelfSorts<LibrarySort> = [
  { value: 'title', label: 'Title' },
  { value: 'added', label: 'Added' },
  { value: 'size', label: 'Size' },
  { value: 'read', label: 'Last read' },
];

export const LIBRARY_NATURAL: Record<LibrarySort, ShelfDir> = {
  title: 'asc',
  added: 'desc',
  size: 'desc',
  read: 'desc',
};

export const LIBRARY_ORDER_KEY = 'chess-vault:shelf-library';

/**
 * The Books section while its chunk is on the wire.
 *
 * One book is the reader, a PDF page beside a board, whose shell is in
 * the reader's own chunk and has no sketch out here; it draws nothing,
 * as it did before. Nothing in the address opens the library.
 */
export default function BooksOutline({ params = [] }: { params?: string[] }) {
  return params[0] ? null : <LibraryOutline />;
}

/**
 * The library: its name, its count line, its search field, and the
 * covers it held last visit.
 *
 * The count line stands whatever the shelf holds: the library prints
 * "n books" from an empty vault too, so BooksPage draws that line
 * unconditionally. The CARDS are the other way — nothing seeds a book,
 * so a device that has never seen the vault reserves none of them
 * (the EMPTY_SHELF floor in components/shelf-reservation).
 */
function LibraryOutline() {
  const groups = readShelfShape('library');
  const view = readShelfOrder(LIBRARY_ORDER_KEY, LIBRARY_SORTS, LIBRARY_NATURAL, 'added');
  return (
    <PageShell width="medium">
      <ShelfHeader
        title={t('Books')}
        search={t('Search books…')}
        subtitle
        sorts={LIBRARY_SORTS}
        sort={view.sort}
        dir={view.dir}
        // No layout switch: a book's card is its cover, so the library
        // has one layout (ShelfToolbar).
        // Import a PDF, New folder.
        create={<OutlineCreate label="Import" actions={2} />}
      />
      {shelfHasShape(groups) && <LibraryCards groups={groups} />}
    </PageShell>
  );
}

/**
 * The covers alone, for the wait AFTER the chunk: BooksPage draws these
 * under its own live toolbar while the listing is out. Same component,
 * same arguments, so the two waits cannot disagree about a card's size.
 *
 * `footer="line"`: the library's card ends on a line of text (a size,
 * and where it is kept) where the puzzle shelf's ends on a progress
 * track (SkeletonBookCards).
 */
export function LibraryCards({ groups }: { groups: { root: number; folders: number[] } }) {
  return <SkeletonBookCards groups={groups} footer="line" />;
}
