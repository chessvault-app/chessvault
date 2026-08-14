import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Bookmark,
  BookMarked,
  ChevronLeft,
  FileUp,
  MoreHorizontal,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

import { SkeletonBookCards, useSlowLoad } from '@/ui/Skeleton';
import { navigate } from '@/lib/router';

import { ActionSheet } from '@/ui/ActionSheet';

import { Button } from '@/ui/Button';

import { SearchInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { PromptSheet } from '@/ui/PromptSheet';
import { SwipeTrack, useSwipeRow } from '@/ui/SwipeRow';

import { CreateControl, FabSpacer } from '@/ui/Fab';
import { UndoBar } from '@/ui/UndoBar';
import { useUndoable } from '@/ui/useUndoable';

import { useImportJob } from '../importJob';
import { listCheckpoints, type CheckpointSummary } from '../importCheckpoint';

import { ProgressBar } from '@/ui/ProgressBar';

import { t } from '@/lib/i18n';
import {
  type BookSummary,
  diagramUrl,
  forgetBook,
  shelfMemory,
} from './data';

// ---------------------------------------------------------------------------
// Shelf

/**
 * How the book shelf is ordered. Not sortDocs: a book has no mtime or
 * byte size worth ordering by — what it has is a count and a score.
 */
type BookSort = 'title' | 'puzzles' | 'progress';
type BookDir = 'asc' | 'desc';

const BOOK_SORTS: { value: BookSort; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'puzzles', label: 'Puzzles' },
  { value: 'progress', label: 'Progress' },
];

/** The direction each sort starts in — the one its name means. */
const NATURAL: Record<BookSort, BookDir> = { title: 'asc', puzzles: 'desc', progress: 'desc' };

/** Remembered on the device, like the other shelves' view settings. */
function useBookSort(): {
  sort: BookSort;
  setSort: (sort: BookSort) => void;
  dir: BookDir;
  setDir: (dir: BookDir) => void;
} {
  const key = 'chess-vault:shelf-books';
  const [state, setState] = useState<{ sort: BookSort; dir: BookDir }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<{
        sort: BookSort;
        dir: BookDir;
      }>;
      const sort = BOOK_SORTS.some((s) => s.value === saved.sort) ? saved.sort! : 'title';
      return { sort, dir: saved.dir === 'asc' || saved.dir === 'desc' ? saved.dir : NATURAL[sort] };
    } catch {
      return { sort: 'title', dir: NATURAL.title };
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
    // A new sort starts in its own natural direction — see ShelfToolbar.
    setSort: (sort) => setState({ sort, dir: NATURAL[sort] }),
    dir: state.dir,
    setDir: (dir) => setState((prev) => ({ ...prev, dir })),
  };
}

export function Shelf() {
  // Seeded from the last visit, so coming back from a book shows the shelf
  // as you left it. Without this the component remounts empty, flashes its
  // skeleton and redraws every cover — which reads as a blink, not as
  // loading, because the content was already on screen a moment ago.
  const [books, setBooks] = useState<BookSummary[] | null>(shelfMemory.books);
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  /**
   * The shelf waits for its covers.
   *
   * The list is a kilobyte and the covers are five separate images, so
   * the cards used to appear immediately and then fill with pictures one
   * at a time — a page assembling itself in front of you. Decoding them
   * first costs a moment and arrives whole.
   *
   * Bounded, because a cover is a nicety: if the images are slow or
   * missing the shelf draws anyway rather than waiting on them.
   */
  const [coversReady, setCoversReady] = useState(shelfMemory.books !== null && shelfMemory.coversDecoded);
  useEffect(() => {
    if (books === null) return;
    // An empty shelf has no covers to wait for, and waiting for none of
    // them left it skeletal forever.
    if (books.length === 0) {
      setCoversReady(true);
      return;
    }
    let live = true;
    const covers = books.map(
      (b) =>
        new Promise<void>((done) => {
          const img = new Image();
          img.onload = () => done();
          img.onerror = () => done();
          img.src = `/api/puzzlebooks/${encodeURIComponent(b.slug)}/diagrams/cover.jpg`;
        }),
    );
    void Promise.race([
      Promise.all(covers),
      new Promise((r) => setTimeout(r, 2000)),
    ]).then(() => {
      if (!live) return;
      shelfMemory.coversDecoded = true;
      setCoversReady(true);
    });
    return () => {
      live = false;
    };
  }, [books]);
  // Nothing at all for the first moment: a shelf that arrives in 30 ms
  // should not flash a skeleton on its way in.
  const shelfPending = useSlowLoad(books === null || !coversReady);

  // Shown from cache immediately, refreshed underneath: a book's counts
  // change as you solve, so the list is never trusted to stay right — only
  // to be right ENOUGH to draw while the real answer is on its way.
  const load = useCallback(async () => {
    try {
      const fresh = (await api<{ books: BookSummary[] }>('/api/puzzlebooks')).books;
      shelfMemory.books = fresh;
      setBooks(fresh);
      setError(null);
    } catch (e) {
      // The skeleton must not spin forever on a blip: show the cached
      // shelf (or an empty one) under a line that says what happened.
      setBooks((prev) => prev ?? shelfMemory.books ?? []);
      setError(apiErrorMessage(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const removeBook = async (slug: string): Promise<void> => {
    await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    forgetBook(slug);
    void load();
  };

  // A book holds a lot of work, so removal is undoable rather than
  // confirmed: it leaves the shelf at once and the DELETE waits.
  // Bookmarks, kept in the vault beside the books — the same store and the
  // same reasoning as the other two shelves.
  const [markedSlugs, setMarked] = useState<Set<string>>(new Set());
  const [markedOnly, setMarkedOnly] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void fetch('/api/puzzlebooks/bookmarks')
      .then((r) => (r.ok ? (r.json() as Promise<{ slugs: string[] }>) : null))
      .then((body) => setMarked(new Set(body?.slugs ?? [])))
      .catch(() => {});
  }, []);
  const toggleMark = async (slug: string): Promise<void> => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    await fetch('/api/puzzlebooks/bookmarks/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
  };

  const dropBook = (slug: string, title: string): void => {
    const unhide = (): void =>
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    setHidden((prev) => new Set(prev).add(slug));
    undoable.remove(title, () => void removeBook(slug).then(unhide), unhide);
  };

  /**
   * A book is made and opened, with a name its own header can change. What
   * a book is called is on its cover, and you are about to go and look.
   */
  const needle = query.trim().toLowerCase();
  /**
   * Books with a scan that never finished.
   *
   * Read once when the shelf opens, and again whenever a scan stops
   * running — that is the moment one either disappears (it finished) or
   * appears (it was interrupted). The live job is watched separately so
   * a scan in progress shows its page as it moves.
   */
  const job = useImportJob();
  const [interrupted, setInterrupted] = useState<CheckpointSummary[]>([]);
  const jobStatus = job.status;
  useEffect(() => {
    void listCheckpoints().then(setInterrupted);
  }, [jobStatus]);
  const scanOf = (slug: string): { page: number; pages: number; live: boolean } | undefined => {
    if (job.slug === slug && (jobStatus === 'scanning' || jobStatus === 'reading')) {
      return { page: job.page, pages: job.pages, live: true };
    }
    const saved = interrupted.find((c) => c.slug === slug);
    return saved ? { page: saved.page, pages: saved.pages, live: false } : undefined;
  };

  const view = useBookSort();
  const frac = (b: BookSummary): number => (b.puzzles ? b.solved / b.puzzles : 0);
  const flip = view.dir === 'desc' ? -1 : 1;
  const visibleBooks = (books ?? [])
    .filter(
      (b) =>
        !hidden.has(b.slug) &&
        (!markedOnly || markedSlugs.has(b.slug)) &&
        (!needle || b.title.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      // Ascending comparisons; `flip` turns the whole order over.
      if (view.sort === 'puzzles') return flip * (a.puzzles - b.puzzles);
      if (view.sort === 'progress') return flip * (frac(a) - frac(b));
      return flip * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });

  const create = async (): Promise<void> => {
    const base = t('Untitled book');
    const taken = new Set((books ?? []).map((b) => b.title));
    let title = base;
    for (let n = 2; taken.has(title); n += 1) title = `${base} ${n}`;
    try {
      const body = await api<{ slug?: string }>('/api/puzzlebooks', {
        method: 'POST',
        json: { title },
      });
      if (!body.slug) {
        setError(t('could not create the book'));
        return;
      }
      navigate('puzzles', 'books', body.slug);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
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

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {undoable.pending && (
        <UndoBar
          label={undoable.pending.label}
          leaving={undoable.pending.leaving}
          onUndo={undoable.undo}
          onHold={undoable.hold}
          onRelease={undoable.release}
        />
      )}
      <div className="mx-auto max-w-3xl p-4 pb-8">
        {/* The other shelves' two-row shape: the heading row carries what
            is ABOUT the shelf — filter, order, create — and the search
            gets a full-width line of its own underneath. The bookmark
            switch rides beside the search below sm, exactly as in
            ShelfToolbar. */}
        <div className="mb-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              title={t('Back to the dashboard')}
              onClick={() => navigate('puzzles', 'dashboard')}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <h1 className="text-fg text-base font-semibold">{t('Puzzle books')}</h1>
            <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
              {bookmarkToggle('hidden sm:inline-flex')}
              <Select
                value={view.sort}
                onChange={(value) => view.setSort(value as BookSort)}
                ariaLabel={t('Sort by')}
                size="sm"
                align="end"
                steady
                className="hidden shrink-0 sm:flex"
                groups={[
                  { options: BOOK_SORTS.map(({ value, label }) => ({ value, label: t(label) })) },
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
                actions={[{ label: 'New book', icon: BookMarked, onSelect: () => void create() }]}
              />
            </div>
          </div>
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

        {error && <p className="text-bad mb-3 text-xs">{error}</p>}

        {books === null || !coversReady ? (
          shelfPending ? <SkeletonBookCards cards={books?.length || 4} /> : null
        ) : visibleBooks.length === 0 ? (
          <div className="bg-surface border-line rounded-xl border p-6 text-center">
            <BookMarked className="text-subtle mx-auto mb-2 size-6" />
            <p className="text-muted text-sm">
              No puzzle books yet. Create one per paper book, then enter its
              puzzles from the board — solutions and progress live here, not
              in the back of the book.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleBooks.map((b) => (
              <BookCard
                key={b.slug}
                book={b}
                marked={markedSlugs.has(b.slug)}
                onToggleMark={() => void toggleMark(b.slug)}
                onRemove={() => dropBook(b.slug, b.title)}
                onChanged={() => void load()}
                scan={scanOf(b.slug)}
              />
            ))}
          </ul>
        )}

        <FabSpacer />
      </div>
    </div>
  );
}

/**
 * One book on the shelf: a cover, a title, a count and a progress bar —
 * and the same three gestures every other shelf card has.
 *
 * It used to wear a bin in its corner, permanently visible under a thumb:
 * one press from throwing away a book's whole history, sitting on top of
 * its title. The row's verbs are behind the ⋯ now, a swipe left removes
 * (undoably) and a swipe right marks, which is what a study, a note and a
 * game already do.
 */
function BookCard({
  book,
  marked,
  onToggleMark,
  onRemove,
  onChanged,
  scan,
}: {
  book: BookSummary;
  marked: boolean;
  onToggleMark: () => void;
  onRemove: () => void;
  /** The shelf reloads — a rename changed what this card says. */
  onChanged: () => void;
  /** An unfinished import of this book: live if it is running now, or
      the checkpoint it stopped at. */
  scan?: { page: number; pages: number; live: boolean };
}) {
  const swipe = useSwipeRow({ onRemove, onBookmark: onToggleMark });
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  // The same PATCH the book's own header uses: the title changes, the
  // slug (the folder, the URL, the progress key) stays put.
  const rename = async (value: string): Promise<void> => {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === book.title) return;
    const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(book.slug)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: next }),
    });
    if (res.ok) {
      forgetBook(book.slug);
      onChanged();
    }
  };

  return (
    <li className="h-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate('puzzles', 'books', book.slug)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigate('puzzles', 'books', book.slug);
        }}
        {...swipe.handlers}
        className={cn(
          'bg-surface border-line group relative flex h-full cursor-pointer items-stretch gap-3',
          'overflow-hidden rounded-xl border p-3 text-left transition-colors duration-100',
          'hover:border-line-strong hover:bg-surface-2',
          // The whole indicator that a book is kept, and it costs no width
          // — see the shelves and the games rows.
          marked && 'border-l-warn hover:border-l-warn border-l-2',
        )}
      >
        <SwipeTrack dx={swipe.dx} bookmarked={marked} />

        <div className="flex min-w-0 flex-1 items-stretch gap-3" style={swipe.style}>
          {book.cover ? (
            <img
              src={diagramUrl(book.slug, 'cover.jpg')}
              alt=""
              loading="lazy"
              decoding="async"
              className="border-line h-24 w-[4.5rem] shrink-0 rounded-md border object-cover object-top"
            />
          ) : (
            <span className="bg-surface-inset border-line grid h-24 w-[4.5rem] shrink-0 place-items-center rounded-md border">
              <BookMarked className="text-subtle group-hover:text-primary size-5 transition-colors" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
            {/* pr keeps a long title clear of the corner control */}
            <span className="min-w-0 pr-7">
              <span className="text-fg block truncate text-sm font-medium">{book.title}</span>
              <span className="text-subtle block text-xs">
                {t('{n} puzzles', { n: book.puzzles })}
              </span>
            </span>
            {scan ? (
              /*
                A book being read is not a book you can train from, so the
                shelf says so instead of showing a progress bar over
                puzzles that are still arriving. Opening the book is the
                way back to the import — the card already does that on
                click, so this is a line, not another control competing
                with it.
              */
              <span className="flex items-center gap-1.5">
                {scan.live ? (
                  <Loader2 className="text-primary size-3 shrink-0 animate-spin" />
                ) : (
                  <FileUp className="text-warn size-3 shrink-0" />
                )}
                <span className={cn('truncate text-xs', scan.live ? 'text-primary' : 'text-warn')}>
                  {scan.live
                    ? t('reading — page {page} of {pages}', { page: scan.page, pages: scan.pages })
                    : t('unfinished — {page} of {pages} pages, tap to carry on', {
                        page: scan.page,
                        pages: scan.pages,
                      })}
                </span>
              </span>
            ) : (
              <ProgressBar total={book.puzzles} solved={book.solved} failed={book.failed} />
            )}
          </span>
        </div>

        <Button
          ref={menuTrigger}
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
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(true);
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>

        {menuOpen && (
          <ActionSheet
            title={book.title}
            anchor={menuTrigger}
            onClose={() => setMenuOpen(false)}
            actions={[
              {
                label: marked ? 'Remove bookmark' : 'Bookmark',
                icon: Bookmark,
                onSelect: onToggleMark,
              },
              { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
              {
                label: 'Remove this book and its progress',
                icon: Trash2,
                danger: true,
                onSelect: onRemove,
              },
            ]}
          />
        )}

        {renaming && (
          <PromptSheet
            label={t('Rename this book')}
            initial={book.title}
            onSubmit={(value) => void rename(value)}
            onClose={() => setRenaming(false)}
          />
        )}
      </div>
    </li>
  );
}
