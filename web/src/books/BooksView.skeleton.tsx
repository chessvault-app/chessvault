import { BookText, ChevronLeft, Grid3x3, SquarePen } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { BOARD_HELD_SHELL } from '@/components/layout';
import { Inert, Skeleton } from '@/components/skeletons';
import { PaneTabs } from '@/components/pane-tabs';
import { readPageShape, readReaderBoardShown, readReaderPaneWidth } from '@/books/reservation';
import { decodeSegment } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useWideLayout } from '@/lib/media';
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
 * One book is the reader; nothing in the address opens the library.
 * The reader drew NOTHING out here, on the argument that its shell is in
 * its own chunk — and it is the longest download in the section, because
 * that chunk carries pdf.js. What it waits for is knowable all the same:
 * the reader is a board-family page whose first pane is the book, and
 * the page's own size is what this device measured last time the book
 * was open (./reservation).
 */
export default function BooksOutline({ params = [] }: { params?: string[] }) {
  return params[0] ? <ReaderOutline id={decodeSegment(params[0])} /> : <LibraryOutline />;
}

/**
 * A book being opened: its title row, and the page-shaped placeholder the
 * reader itself draws until the first page has rastered.
 *
 * The same treatment, in the same words — "Opening the book…" over a
 * page-sized box at that book's own aspect — so the one message stands
 * from the first frame of the download to the first rendered page,
 * rather than nothing, then the message, then the page.
 *
 * The title is a bar: a book's name is data, and the slug in the address
 * is an id. The reader holds the same place for it.
 */
function ReaderOutline({ id }: { id: string }) {
  const page = readPageShape(id);
  const wide = useWideLayout();
  // Both device choices, which decide the wide row (./reservation): the
  // board folds away, and the page's column keeps whatever width it was
  // dragged to.
  const boardShown = readReaderBoardShown();
  const paneW = readReaderPaneWidth();
  const header = (
    <Inert>
      {/* The reader's own header row: the way back, the book's name, and
          the two verbs over it, all at their settled heights. */}
      <div className="flex shrink-0 items-center px-4 pt-4 md:px-6 md:pt-6 max-md:hidden">
        <PageHeader
          className="min-w-0 flex-1"
          title=" "
          back={NOOP}
          backVisible="always"
          truncate
          // No verbs: both act on the book, so the reader itself draws
          // them only once it has one. They sit in the header's own
          // `ml-auto` group, where arriving moves nothing.
        />
      </div>
      {/* A phone's row is the reader's own compact one: a chevron, the
          name, the verbs. In the reader's own frame, which states no
          height: the chevron sets it, 36px under a thumb. This said h-8,
          and the pane strip under it stood 4px high of where it landed
          (check:skeletons). */}
      <div className={cn(READER_FLUSH_ROW, 'md:hidden')} data-chrome="">
        <Button variant="ghost" size="icon-sm">
          <ChevronLeft className="glyph" />
        </Button>
        <Skeleton className="h-3.5 min-w-0 flex-1" />
      </div>
    </Inert>
  );
  const pageBox = <PagePlaceholder aspect={page?.aspect ?? null} />;
  // The band of page controls over the page (the reader's own row, at
  // its own height and inset), so the page starts where it settles: the
  // outline without it drew the first page 52px high of where it lands.
  // Empty, because every control in it reads the document.
  const band = <div className="flex h-9 shrink-0 items-center justify-center gap-0.5 px-4 md:px-6 wide:mt-4 wide:mb-3" />;

  // Wide: the page's column at its dragged width, the board beside it -
  // or the page alone, centred, where the board has been folded away.
  if (wide)
    return (
      <div
        className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col"
        role="status"
        aria-label={t('Loading')}
        aria-live="polite"
      >
        {header}
        {boardShown ? (
          <div className="flex min-h-0 flex-1">
            <div style={{ width: paneW }} className="flex min-h-0 shrink-0 flex-col">
              {band}
              {pageBox}
            </div>
            {/* The board's own column, with its square where the board
                lands. The strip of controls under it is the board page's
                and arrives with the board. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {band}
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-3 md:px-6">
                <Skeleton className="aspect-square w-full max-w-[26rem] rounded-xl" />
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex min-h-0 w-full max-w-[75rem] flex-1 flex-col">
            {band}
            {pageBox}
          </div>
        )}
      </div>
    );

  // Stacked: one thing at a time, the switcher under the header.
  return (
    <div className={BOARD_HELD_SHELL} role="status" aria-label={t('Loading')} aria-live="polite">
      {header}
      <Inert>
        <PaneTabs
          value="book"
          onChange={NOOP}
          tabs={[
            { id: 'book', label: t('Book'), icon: BookText },
            { id: 'board', label: t('Board'), icon: Grid3x3 },
            { id: 'editor', label: t('Edit'), icon: SquarePen },
          ]}
        />
      </Inert>
      {pageBox}
    </div>
  );
}

/**
 * The page itself, at this book's own shape, under the reader's own words
 * for this wait.
 *
 * `min-h-full` because the ratio is the page's FLOOR and not its ceiling:
 * the scroller starts the next page where the first ends, so the
 * placeholder covers the column the way the pages will. `animate-none`
 * for the reason the reader gives — a layer this size pulsing its opacity
 * is composited in tiles that do not all repaint on one frame, and on a
 * phone the seams showed as dark rectangles wandering over it.
 */
function PagePlaceholder({ aspect }: { aspect: number | null }) {
  return (
    <div className="bg-muted/40 min-h-0 flex-1 overflow-hidden">
      <div className="relative flex h-full items-start justify-center">
        <Skeleton
          className="min-h-full w-full animate-none rounded-md"
          style={{ aspectRatio: `1 / ${aspect ?? 4 / 3}` }}
        />
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
          <Spinner />
          {t('Opening the book…')}
        </div>
      </div>
    </div>
  );
}

const NOOP = (): void => {};

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

/** The reader's compact header row on a phone, which the reader and this outline both draw. */
export const READER_FLUSH_ROW = 'flex shrink-0 items-center gap-2';
