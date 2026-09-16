import { PageShell } from '@/components/page-shell';
import { ShelfHeader } from '@/components/shelf-outline';
import { SkeletonBookCards } from '@/components/skeletons';
import { readShelfShape, shelfHasShape } from '@/components/shelf-reservation';
import { t } from '@/lib/i18n';

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
  return (
    <PageShell width="medium">
      <ShelfHeader title={t('Books')} search={t('Search books…')} subtitle />
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
