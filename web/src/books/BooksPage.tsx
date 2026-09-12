import { BookMarked, ScanSearch, BookOpen, BookText, Bookmark, FileUp, Folder as FolderIcon, FolderInput, Pencil, SearchX, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { BookCoverCard } from '@/components/book-cover-card';
import { EmptyState } from '@/components/empty-state';
import { CreateControl, FabSpacer } from '@/components/fab';
import { MoveToDialog } from '@/components/move-to-dialog';
import { PageShell } from '@/components/page-shell';
import { PromptDialog } from '@/components/prompt-dialog';
import { ShelfFolderHeader } from '@/components/shelf-folder-header';
import { SkeletonBookCards, SkeletonSubtitle, useSlowLoad } from '@/components/skeletons';
import {
  EMPTY_SHELF,
  parseShelfShape,
  shelfHasShape,
  shelfShapeFromCollections,
  storedShelfShape,
} from '@/components/shelf-reservation';
import { ShelfToolbar, useShelfOrder, type ShelfDir, type ShelfSorts } from '@/components/shelf-toolbar';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useBookmarks } from '@/hooks/use-bookmarks';
import { useUndoable } from '@/hooks/use-undoable';
import { apiErrorMessage } from '@/lib/api';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';

import {
  coverUrl,
  createCollection,
  fileSize,
  type LibraryBook,
  libraryMemory,
  loadBooks,
  moveBook,
  removeBook,
  removeCollection,
  renameBook,
  renameCollection,
} from './data';
import { UploadBookDialog } from './UploadBookDialog';
import { useDiagramJob } from './diagramJob';
import { decodeImages } from '@/lib/media';

/**
 * The library: every PDF that has been uploaded to read. Any chess book —
 * strategy, a games collection, an opening book, a puzzle book whose
 * puzzles were read into the puzzle shelf. Each card is a cover, a title,
 * the file's size and where reading stopped; opening one is the reader.
 *
 * The same shape as the other shelves — the header carries what is about
 * the shelf, the search has its own line, a card's verbs are behind its
 * ⋯ and a swipe removes (undoably). Dropping a PDF anywhere on the page
 * uploads it, as does the button. Books file into collections as studies
 * and notes do — a heading per collection, the shelf's own books first —
 * with the same heading menu (rename, delete when empty) and the same
 * "Move to a collection" on the card.
 */

/**
 * How the library is ordered. Remembered on the device, like the other
 * shelves' view settings; a new sort starts in its own natural direction.
 */
type LibrarySort = 'title' | 'added' | 'size' | 'read';

const LIBRARY_SORTS: ShelfSorts<LibrarySort> = [
  { value: 'title', label: 'Title' },
  { value: 'added', label: 'Added' },
  { value: 'size', label: 'Size' },
  { value: 'read', label: 'Last read' },
];

const NATURAL: Record<LibrarySort, ShelfDir> = {
  title: 'asc',
  added: 'desc',
  size: 'desc',
  read: 'desc',
};

/** See `reservedShelf` below: the library's grouped shape, last visit. */
const LIBRARY_SHELF_KEY = 'vault:library-shelf';

export function BooksPage() {
  const [books, setBooks] = useState<LibraryBook[] | null>(libraryMemory.books);
  const [folders, setFolders] = useState<string[]>(libraryMemory.folders);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const undoable = useUndoable();
  // Nothing at all for the first moment: a shelf that arrives in 30 ms
  // should not flash a skeleton on its way in.
  const pending = useSlowLoad(books === null);
  const view = useShelfOrder('chess-vault:shelf-library', LIBRARY_SORTS, NATURAL, 'added');
  // The grouped shape this shelf had last visit, per device
  // (components/shelf-reservation). The floor is EMPTY_SHELF, not the
  // welcome one: nothing seeds a book, so a device that has never seen
  // the vault reserves nothing here.
  const [reservedShelf] = useState(() =>
    parseShelfShape(localStorage.getItem(LIBRARY_SHELF_KEY), EMPTY_SHELF),
  );
  // Remembered for the NEXT visit's reservation — the settled answer
  // only, never an error's empty list.
  useEffect(() => {
    if (books === null || error !== null) return;
    localStorage.setItem(
      LIBRARY_SHELF_KEY,
      storedShelfShape(shelfShapeFromCollections(books.map((b) => b.collection), folders)),
    );
  }, [books, folders, error]);

  // Bookmarks, kept in the vault beside the books — the same store and the
  // same reasoning as the other shelves.
  const { marked, toggle: toggleMark } = useBookmarks('/api/books');
  const [markedOnly, setMarkedOnly] = useState(false);

  const load = useCallback(async (force = true): Promise<void> => {
    try {
      const next = await loadBooks(force);
      // The covers are decoded BEFORE the list swaps in, so the shelf's
      // thumbnails always arrive together — as the puzzle shelf's do.
      // Cold, that is what the skeleton covers; hot, the cards on screen
      // simply stay until the fresh set is whole, which is what used to
      // break: a reload after an upload or a replaced PDF swapped the
      // list at once and the new or re-versioned cover popped in later.
      // Bounded, because a cover is a nicety: if the images are slow or
      // missing the shelf draws anyway.
      await decodeImages(next.filter((b) => b.cover).map((b) => coverUrl(b.id, b.bytes)));
      libraryMemory.coversDecoded = true;
      setBooks(next);
      setFolders(libraryMemory.folders);
      setError(null);
    } catch (e) {
      setBooks((prev) => prev ?? []);
      setError(apiErrorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The upload window: open empty from the button, or already holding
  // the PDF that was dropped on the shelf. One book at a time — the
  // window shows the book back and asks before anything goes up.
  const [adding, setAdding] = useState<{ file: File | null } | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const drop = useFileDrop({
    accept: byExtension('.pdf'),
    onFiles: ([first]) => setAdding({ file: first ?? null }),
    onReject: () => setError(t('Drop a PDF here.')),
  });

  const remove = (book: LibraryBook): void => {
    const unhide = (): void =>
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(book.id);
        return next;
      });
    setHidden((prev) => new Set(prev).add(book.id));
    undoable.remove(
      book.title,
      () =>
        void removeBook(book.id)
          .catch(() => {})
          .then(() => load())
          .then(unhide),
      unhide,
    );
  };

  const needle = query.trim().toLowerCase();
  const flip = view.dir === 'desc' ? -1 : 1;
  const visible = (books ?? [])
    .filter(
      (b) =>
        !hidden.has(b.id) &&
        (!markedOnly || marked.has(b.id)) &&
        (!needle || b.title.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      // Ascending comparisons; `flip` turns the whole order over.
      if (view.sort === 'added') return flip * (a.addedAt ?? '').localeCompare(b.addedAt ?? '');
      if (view.sort === 'size') return flip * (a.bytes - b.bytes);
      if (view.sort === 'read') return flip * ((a.lastPage ?? 0) - (b.lastPage ?? 0));
      return flip * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
  // Grouped by collection, the shelf's own books first, then the
  // collections by name — every collection listed, so an empty one shows
  // (except under a search or the bookmark filter, which list only what
  // they found). The order inside a group is the chosen one.
  const groups = new Map<string, LibraryBook[]>();
  groups.set('', []);
  if (!needle && !markedOnly) for (const f of folders) groups.set(f, []);
  for (const b of visible) {
    const key = b.collection ?? '';
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }
  const groupNames = [...groups.keys()].sort((a, b) =>
    a === '' ? -1 : b === '' ? 1 : a.localeCompare(b),
  );
  const shownGroups = groupNames.filter((g) => g === '' ? groups.get('')!.length > 0 || groupNames.length === 1 : true);
  const cardsOf = (list: LibraryBook[]) =>
    list.map((b) => (
      <BookCard
        key={b.id}
        book={b}
        folders={folders}
        marked={marked.has(b.id)}
        onToggleMark={() => void toggleMark(b.id)}
        onRemove={() => remove(b)}
        onChanged={() => void load()}
        onError={setError}
      />
    ));

  return (
    <PageShell width="medium">
      {/* The drop target is the page's content column: a PDF let go
          anywhere on the shelf is an upload. */}
      <div {...drop.handlers} className="contents">
      {newFolder && (
        <PromptDialog
          label={t('New folder')}
          initial=""
          submitLabel="Create"
          onSubmit={(value) => {
            setNewFolder(false);
            if (value.trim()) {
              void createCollection(value.trim()).then((err) => {
                if (err) setError(t(err));
                else void load();
              });
            }
          }}
          onClose={() => setNewFolder(false)}
        />
      )}
      {adding && (
        <UploadBookDialog
          initialFile={adding.file}
          folders={folders}
          onClose={() => setAdding(null)}
          onUploaded={(id) => {
            setAdding(null);
            void load();
            // The book's diagrams are read now, once, in the background —
            // not page by page under the reader's scroll.
            void useDiagramJob.getState().start(id);
          }}
        />
      )}
      <ShelfToolbar
        title={t('Books')}
        subtitle={
          books === null ? <SkeletonSubtitle /> : books.length === 1 ? t('1 book') : t('{n} books', { n: books.length })
        }
        query={query}
        onQuery={setQuery}
        placeholder={t('Search books…')}
        markedOnly={markedOnly}
        onMarkedOnly={setMarkedOnly}
        sorts={LIBRARY_SORTS}
        sort={view.sort}
        onSort={view.setSort}
        dir={view.dir}
        onDir={view.setDir}
        create={
          <CreateControl
            // Import, not Create: a book is brought in, never made
            // here, and the empty state beside this already said so.
            label="Import"
            actions={[
              { label: 'Import a PDF', icon: Upload, onSelect: () => setAdding({ file: null }) },
              { label: 'New folder', icon: FolderIcon, onSelect: () => setNewFolder(true) },
            ]}
          />
        }
      />

      {error && <p className="text-destructive text-sm">{error}</p>}

      {books === null ? (
        // A vault seen without books (or never seen — nothing seeds one)
        // reserves nothing: its settle is the EmptyState.
        pending && shelfHasShape(reservedShelf) ? (
          <SkeletonBookCards groups={reservedShelf} footer="line" />
        ) : null
      ) : visible.length === 0 && (folders.length === 0 || needle || markedOnly) ? (
        books.length === 0 ? (
          <EmptyState
            className={cn(drop.dragging && 'ring-primary ring-2')}
            icon={BookText}
            title="No books yet"
            body="Import a chess book as a PDF and read it beside a board. Any printed diagram can be set up with a tap. Puzzle books imported on the puzzle shelf are filed here too."
            action={
              <Button variant="default" size="sm" onClick={() => setAdding({ file: null })}>
                <Upload className="size-3.5" data-icon="inline-start" />
                {t('Import a PDF')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            className={cn(drop.dragging && 'ring-primary ring-2')}
            icon={SearchX}
            title="Nothing matches that search"
            body={
              markedOnly
                ? 'No bookmarked book matches it. Clearing the search shows every bookmark again.'
                : 'No book matches it. Clearing the search shows the whole shelf again.'
            }
            action={
              needle ? (
                <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                  <X className="size-3.5" data-icon="inline-start" />
                  {t('Clear search')}
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div
          className={cn(
            'flex flex-col gap-4 rounded-xl',
            drop.dragging && 'ring-primary ring-2 ring-offset-4 ring-offset-background',
          )}
        >
          {shownGroups.map((folder) => (
            <section key={folder || '(root)'} className="flex flex-col gap-2">
              {folder && (
                <ShelfFolderHeader
                  folder={folder}
                  empty={groups.get(folder)!.length === 0}
                  onRename={(next) =>
                    renameCollection(folder, next).then((e) => {
                      if (!e) void load();
                      return e && t(e);
                    })
                  }
                  onDelete={() =>
                    removeCollection(folder).then((e) => {
                      if (!e) void load();
                      return e && t(e);
                    })
                  }
                />
              )}
              {groups.get(folder)!.length === 0 ? (
                <p className="text-muted-foreground px-1 text-sm">{t('Empty folder.')}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">{cardsOf(groups.get(folder)!)}</ul>
              )}
            </section>
          ))}
        </div>
      )}

      <FabSpacer />
      </div>
    </PageShell>
  );
}

function BookCard({
  book,
  folders,
  marked,
  onToggleMark,
  onRemove,
  onChanged,
  onError,
}: {
  book: LibraryBook;
  /** Every collection, for "Move to a collection". */
  folders: string[];
  marked: boolean;
  onToggleMark: () => void;
  onRemove: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const job = useDiagramJob();
  const reading = job.bookId === book.id && job.status === 'running';
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const open = (): void => navigate('books', book.id);

  const rename = async (value: string): Promise<void> => {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === book.title) return;
    try {
      await renameBook(book.id, next);
      onChanged();
    } catch (e) {
      onError(apiErrorMessage(e));
    }
  };

  const where =
    book.lastPage && book.pages
      ? t('Page {page} of {pages}', { page: book.lastPage, pages: book.pages })
      : book.pages
        ? t('{n} pages', { n: book.pages })
        : null;

  return (
    <BookCoverCard
      title={book.title}
      cover={book.cover ? coverUrl(book.id, book.bytes) : null}
      icon={BookText}
      marked={marked}
      onOpen={open}
      onSwipeAway={onRemove}
      onToggleMark={onToggleMark}
      meta={
        <>
          {fileSize(book.bytes)}
          {where ? ` · ${where}` : ''}
        </>
      }
      footer={
        <span className={cn('flex items-center gap-1.5 text-sm', reading ? 'text-primary' : 'text-muted-foreground')}>
          {reading ? (
            <Spinner className="size-3 shrink-0" />
          ) : (
            <BookOpen className="size-3 shrink-0" />
          )}
          {reading
            ? t('Reading diagrams, page {page} of {pages}', { page: job.page, pages: job.pages })
            : book.lastPage
              ? t('Carry on reading')
              : t('Read')}
          {book.puzzleBook && !reading && (
            // Read into the puzzle shelf: the same mark that shelf wears,
            // so the two halves of one book recognise each other. The
            // mark says THAT there is one; the tip says which.
            <TitleTip title={t('Puzzle book: {title}', { title: book.puzzleBook.title })}>
              <span className="text-foreground/80 ml-auto inline-flex items-center gap-1">
                <BookMarked className="size-3 shrink-0" />
                {t('Puzzle book')}
              </span>
            </TitleTip>
          )}
        </span>
      }
      actions={[
        { label: 'Read', icon: BookOpen, onSelect: open },
        ...(book.puzzleBook
          ? [
              {
                label: 'Open the puzzle book',
                icon: BookMarked,
                onSelect: () => navigate('puzzles', 'books', book.puzzleBook!.slug),
              },
            ]
          : []),
        {
          label: marked ? 'Remove bookmark' : 'Bookmark',
          icon: Bookmark,
          onSelect: onToggleMark,
        },
        { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
        { label: 'Move to a folder', icon: FolderInput, onSelect: () => setMoving(true) },
        ...(job.status !== 'running'
          ? [
              {
                label: 'Read diagrams',
                icon: ScanSearch,
                onSelect: () => void useDiagramJob.getState().start(book.id),
              },
            ]
          : []),
        { label: 'Replace PDF…', icon: FileUp, onSelect: () => setReplacing(true) },
        { label: 'Remove from the shelf', icon: Trash2, danger: true, onSelect: onRemove },
      ]}
    >
      {renaming && (
        <PromptDialog
          label={t('Rename this book')}
          initial={book.title}
          onSubmit={(value) => void rename(value)}
          onClose={() => setRenaming(false)}
        />
      )}
      {moving && (
        <MoveToDialog
          currentFolder={book.collection ?? ''}
          folders={folders}
          onPick={(target) => {
            setMoving(false);
            void moveBook(book.id, target || null)
              .then(onChanged)
              .catch((e) => onError(apiErrorMessage(e)));
          }}
          onClose={() => setMoving(false)}
        />
      )}
      {replacing && (
        <UploadBookDialog
          replace={{ id: book.id, title: book.title }}
          onClose={() => setReplacing(false)}
          onUploaded={(id) => {
            setReplacing(false);
            onChanged();
            void useDiagramJob.getState().start(id);
          }}
        />
      )}
    </BookCoverCard>
  );
}
