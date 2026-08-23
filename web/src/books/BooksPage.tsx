import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BookMarked,
  BookOpen,
  BookText,
  Bookmark,
  FileUp,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ActionMenu } from '@/components/action-menu';
import { CreateControl, FabSpacer } from '@/components/fab';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { PromptDialog } from '@/components/prompt-dialog';
import { SkeletonBookCards, useSlowLoad } from '@/components/skeletons';
import { SwipeTrack, useSwipeRow } from '@/components/swipe-row';
import { SearchInput } from '@/components/text-fields';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useUndoable } from '@/hooks/use-undoable';
import { api, apiErrorMessage } from '@/lib/api';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { t } from '@/lib/i18n';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';

import {
  coverUrl,
  libraryMemory,
  loadBooks,
  removeBook,
  renameBook,
  type LibraryBook,
} from './data';
import { UploadBookDialog } from './UploadBookDialog';

/**
 * The library: every PDF that has been uploaded to read. Any chess book —
 * strategy, a games collection, an opening book, a puzzle book whose
 * puzzles were read into the puzzle shelf. Each card is a cover, a title,
 * the file's size and where reading stopped; opening one is the reader.
 *
 * The same shape as the other shelves — the header carries what is about
 * the shelf, the search has its own line, a card's verbs are behind its
 * ⋯ and a swipe removes (undoably). Dropping a PDF anywhere on the page
 * uploads it, as does the button.
 */

/**
 * How the library is ordered. Remembered on the device, like the other
 * shelves' view settings; a new sort starts in its own natural direction.
 */
type LibrarySort = 'title' | 'added' | 'size' | 'read';
type LibraryDir = 'asc' | 'desc';

const LIBRARY_SORTS: { value: LibrarySort; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'added', label: 'Added' },
  { value: 'size', label: 'Size' },
  { value: 'read', label: 'Last read' },
];

const NATURAL: Record<LibrarySort, LibraryDir> = {
  title: 'asc',
  added: 'desc',
  size: 'desc',
  read: 'desc',
};

function useLibrarySort(): {
  sort: LibrarySort;
  setSort: (sort: LibrarySort) => void;
  dir: LibraryDir;
  setDir: (dir: LibraryDir) => void;
} {
  const key = 'chess-vault:shelf-library';
  const [state, setState] = useState<{ sort: LibrarySort; dir: LibraryDir }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<{
        sort: LibrarySort;
        dir: LibraryDir;
      }>;
      const sort = LIBRARY_SORTS.some((s) => s.value === saved.sort) ? saved.sort! : 'added';
      return { sort, dir: saved.dir === 'asc' || saved.dir === 'desc' ? saved.dir : NATURAL[sort] };
    } catch {
      return { sort: 'added', dir: NATURAL.added };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* private mode — the shelf just forgets between visits */
    }
  }, [state]);
  return {
    sort: state.sort,
    setSort: (sort) => setState({ sort, dir: NATURAL[sort] }),
    dir: state.dir,
    setDir: (dir) => setState((prev) => ({ ...prev, dir })),
  };
}

/** Bytes as a shelf would say them. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BooksPage() {
  const [books, setBooks] = useState<LibraryBook[] | null>(libraryMemory.books);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const undoable = useUndoable();
  /**
   * The shelf waits for its covers, as the puzzle shelf does: the list is
   * a kilobyte and the covers are separate images, so the cards would
   * appear and then fill with pictures one at a time. Decoding them first
   * costs a moment and arrives whole — bounded, because a cover is a
   * nicety: if the images are slow or missing the shelf draws anyway.
   */
  const [coversReady, setCoversReady] = useState(
    libraryMemory.books !== null && libraryMemory.coversDecoded,
  );
  useEffect(() => {
    if (books === null) return;
    if (books.length === 0) {
      setCoversReady(true);
      return;
    }
    let live = true;
    const covers = books
      .filter((b) => b.cover)
      .map(
        (b) =>
          new Promise<void>((done) => {
            const img = new Image();
            img.onload = () => done();
            img.onerror = () => done();
            img.src = coverUrl(b.id, b.bytes);
          }),
      );
    void Promise.race([Promise.all(covers), new Promise((r) => setTimeout(r, 2000))]).then(() => {
      if (!live) return;
      libraryMemory.coversDecoded = true;
      setCoversReady(true);
    });
    return () => {
      live = false;
    };
  }, [books]);
  // Nothing at all for the first moment: a shelf that arrives in 30 ms
  // should not flash a skeleton on its way in.
  const pending = useSlowLoad(books === null || !coversReady);
  const view = useLibrarySort();

  // Bookmarks, kept in the vault beside the books — the same store and the
  // same reasoning as the other shelves.
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [markedOnly, setMarkedOnly] = useState(false);
  useEffect(() => {
    void api<{ ids: string[] } | undefined>('/api/books/bookmarks')
      .then((body) => setMarked(new Set(body?.ids ?? [])))
      .catch(() => {});
  }, []);
  const toggleMark = async (id: string): Promise<void> => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Optimistic: the set above is already flipped, so a failure here is
    // swallowed rather than allowed to escape as an unhandled rejection.
    await api('/api/books/bookmarks/toggle', { method: 'POST', json: { id } }).catch(() => {});
  };
  // The same switch in both its homes — see ShelfToolbar's bookmark.
  const bookmarkToggle = (className: string): React.ReactNode => (
    <Button
      variant="secondary"
      size="icon-sm"
      active={markedOnly}
      aria-pressed={markedOnly}
      title={markedOnly ? t('Show all') : t('Show bookmarked only')}
      className={cn('shrink-0', className)}
      onClick={() => setMarkedOnly((v) => !v)}
    >
      <Bookmark className={cn('size-3.5', markedOnly && 'fill-warn text-warn')} />
    </Button>
  );

  const load = useCallback(async (force = true): Promise<void> => {
    try {
      setBooks(await loadBooks(force));
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

  return (
    <PageShell width="medium" className="block">
      {/* The drop target is the page's content column: a PDF let go
          anywhere on the shelf is an upload. */}
      <div {...drop.handlers} className="contents">
      {adding && (
        <UploadBookDialog
          initialFile={adding.file}
          onClose={() => setAdding(null)}
          onUploaded={() => {
            setAdding(null);
            void load();
          }}
        />
      )}
      <div className="mb-4 flex flex-col gap-2.5">
        <PageHeader
          title={t('Books')}
          actions={
            <>
              {bookmarkToggle('hidden sm:inline-flex')}
              <Select
                value={view.sort}
                onValueChange={(value) => view.setSort(value as LibrarySort)}
                ariaLabel={t('Sort by')}
                size="sm"
                align="end"
                steady
                className="hidden shrink-0 sm:flex"
                groups={[
                  { options: LIBRARY_SORTS.map(({ value, label }) => ({ value, label: t(label) })) },
                ]}
              />
              <Button
                variant="secondary"
                size="icon-sm"
                title={
                  view.dir === 'asc'
                    ? t('Ascending — press for descending')
                    : t('Descending — press for ascending')
                }
                className="hidden shrink-0 sm:inline-flex"
                onClick={() => view.setDir(view.dir === 'asc' ? 'desc' : 'asc')}
              >
                {view.dir === 'asc' ? (
                  <ArrowUpNarrowWide className="size-3.5" />
                ) : (
                  <ArrowDownWideNarrow className="size-3.5" />
                )}
              </Button>
              <CreateControl
                actions={[
                  { label: 'Upload PDF', icon: Upload, onSelect: () => setAdding({ file: null }) },
                ]}
              />
            </>
          }
        />
        <div className="flex items-center gap-2">
          <SearchInput
            inputSize="sm"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder={t('Search books…')}
            className="min-w-0 flex-1"
          />
          {bookmarkToggle('sm:hidden')}
        </div>
      </div>

      {error && <p className="text-destructive mb-3 text-sm">{error}</p>}

      {books === null || !coversReady ? (
        pending ? <SkeletonBookCards cards={books?.length || 4} /> : null
      ) : visible.length === 0 ? (
        <div
          className={cn(
            'bg-card flex flex-col items-center gap-3 rounded-xl ring-1 ring-foreground/10 p-6 text-center',
            drop.dragging && 'ring-primary ring-2',
          )}
        >
          <BookText className="text-muted-foreground size-6" />
          <p className="text-muted-foreground text-base">
            {books.length === 0
              ? t(
                  'No books yet. Upload a chess book as a PDF and read it here beside a board — any printed diagram can be set up with a tap. A puzzle book imported on the puzzle shelf is filed here too.',
                )
              : t('No book matches that search.')}
          </p>
          {books.length === 0 && (
            <Button variant="default" size="sm" onClick={() => setAdding({ file: null })}>
              <Upload className="mr-1 size-3.5" />
              {t('Upload PDF')}
            </Button>
          )}
        </div>
      ) : (
        <ul
          className={cn(
            'grid grid-cols-1 gap-3 rounded-xl sm:grid-cols-2',
            drop.dragging && 'ring-primary ring-2 ring-offset-4 ring-offset-background',
          )}
        >
          {visible.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              marked={marked.has(b.id)}
              onToggleMark={() => void toggleMark(b.id)}
              onRemove={() => remove(b)}
              onChanged={() => void load()}
              onError={setError}
            />
          ))}
        </ul>
      )}

      <FabSpacer />
      </div>
    </PageShell>
  );
}

function BookCard({
  book,
  marked,
  onToggleMark,
  onRemove,
  onChanged,
  onError,
}: {
  book: LibraryBook;
  marked: boolean;
  onToggleMark: () => void;
  onRemove: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const swipe = useSwipeRow({ onRemove, onBookmark: onToggleMark });
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
    <li className="h-full">
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter') open();
        }}
        {...swipe.handlers}
        className={cn(
          'bg-card border-border group relative flex h-full cursor-pointer items-stretch gap-3',
          'overflow-hidden rounded-xl border p-3 text-left transition-colors duration-100',
          'hover:border-border hover:bg-accent',
          // The whole indicator that a book is kept, and it costs no width
          // — see the shelves and the games rows.
          marked && 'border-l-warn hover:border-l-warn border-l-2',
        )}
      >
        <SwipeTrack dx={swipe.dx} bookmarked={marked} />
        <div className="flex min-w-0 flex-1 items-stretch gap-3" style={swipe.style}>
          {book.cover ? (
            <img
              src={coverUrl(book.id, book.bytes)}
              alt=""
              loading="lazy"
              decoding="async"
              className="border-border h-24 w-[4.5rem] shrink-0 rounded-md border object-cover object-top"
            />
          ) : (
            <span className="bg-muted/50 border-border grid h-24 w-[4.5rem] shrink-0 place-items-center rounded-md border">
              <BookText className="text-muted-foreground group-hover:text-primary size-5 transition-colors" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
            <span className="min-w-0 pr-7">
              <span className="text-foreground block truncate text-base font-medium">{book.title}</span>
              <span className="text-muted-foreground block text-sm">
                {fileSize(book.bytes)}
                {where ? ` · ${where}` : ''}
              </span>
            </span>
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <BookOpen className="size-3 shrink-0" />
              {book.lastPage ? t('Carry on reading') : t('Read')}
              {book.puzzleBook && (
                // Read into the puzzle shelf: the same mark that shelf wears,
                // so the two halves of one book recognise each other.
                <span
                  className="text-foreground/80 ml-auto inline-flex items-center gap-1"
                  title={t('Puzzle book: {title}', { title: book.puzzleBook.title })}
                >
                  <BookMarked className="size-3 shrink-0" />
                  {t('Puzzle book')}
                </span>
              )}
            </span>
          </span>
        </div>

        <ActionMenu
          title={book.title}
          open={menuOpen}
          onOpenChange={setMenuOpen}
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
            { label: 'Replace PDF…', icon: FileUp, onSelect: () => setReplacing(true) },
            { label: 'Remove from library', icon: Trash2, danger: true, onSelect: onRemove },
          ]}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('More')}
            active={menuOpen}
            style={swipe.style}
            className={cn(
              'absolute right-2 top-2 opacity-0 transition-opacity',
              'group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
              menuOpen && 'opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </ActionMenu>

        {renaming && (
          <PromptDialog
            label={t('Rename this book')}
            initial={book.title}
            onSubmit={(value) => void rename(value)}
            onClose={() => setRenaming(false)}
          />
        )}
        {replacing && (
          <UploadBookDialog
            replace={{ id: book.id, title: book.title }}
            onClose={() => setReplacing(false)}
            onUploaded={() => {
              setReplacing(false);
              onChanged();
            }}
          />
        )}
      </div>
    </li>
  );
}
