import { ArrowDownWideNarrow, ArrowUpNarrowWide, Bookmark, BookMarked, FileUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { useCallback, useEffect, useState } from 'react';

import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

import { SkeletonBookCards, useSlowLoad } from '@/components/skeletons';
import {
  EMPTY_SHELF,
  parseShelfShape,
  storedShelfShape,
} from '@/components/shelf-reservation';
import { navigate } from '@/lib/router';

import { ActionMenu } from '@/components/action-menu';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';

import { SearchInput } from '@/components/text-fields';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { PromptDialog } from '@/components/prompt-dialog';
import { SwipeTrack, useSwipeRow } from '@/components/swipe-row';

import { CreateControl, FabSpacer } from '@/components/fab';
import { useUndoable } from '@/hooks/use-undoable';

import { useImportJob } from '../importJob';
import { clearCheckpoint, listCheckpoints, type CheckpointSummary } from '../importCheckpoint';

import { ProgressBar } from '@/components/progress-bar';

import { t } from '@/lib/i18n';
import {
  type BookSummary,
  diagramUrl,
  forgetBook,
  shelfMemory,
} from './data';
import { decodeImages } from '@/lib/media';

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

/**
 * Throw away saved scans whose book is gone.
 *
 * A checkpoint holds the book's whole PDF and every crop it has read, in
 * this browser's IndexedDB — which is why the delete route cannot touch
 * it, and why clearing it in `removeBook` alone is not enough: the book
 * may have been deleted on another device, or in another browser, or
 * before the version that cleared it. The shelf is where the two facts
 * meet, so this is where the orphans are collected. Unreachable
 * otherwise: book ids are random, so no future book takes the slug back,
 * and an interrupted scan is only ever OFFERED beside a book that is
 * still on the shelf.
 *
 * Only ever from a list the server actually answered with. Sweeping on a
 * failed load — offline, server down — would delete a live scan because
 * the shelf could not be fetched, which is the one way this could cost
 * someone the very work it exists to protect.
 */
async function sweepCheckpoints(fresh: BookSummary[]): Promise<void> {
  const known = new Set(fresh.map((b) => b.slug));
  const saved = await listCheckpoints();
  for (const scan of saved) {
    if (known.has(scan.slug)) continue;
    // Deleted from under a scan that is still running here.
    useImportJob.getState().abandon(scan.slug);
    await clearCheckpoint(scan.slug);
  }
}

/** See `reservedCards` below: how many book cards, last visit. */
const PUZZLE_SHELF_KEY = 'vault:puzzle-shelf';

export function Shelf() {
  // Seeded from the last visit, so coming back from a book shows the shelf
  // as you left it. Without this the component remounts empty, flashes its
  // skeleton and redraws every cover — which reads as a blink, not as
  // loading, because the content was already on screen a moment ago.
  const [books, setBooks] = useState<BookSummary[] | null>(shelfMemory.books);
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Nothing at all for the first moment: a shelf that arrives in 30 ms
  // should not flash a skeleton on its way in.
  const shelfPending = useSlowLoad(books === null);
  // How many cards this shelf had last visit, per device — the shelf is
  // flat, so only `root` of the stored shape is meaningful. The floor is
  // EMPTY_SHELF: nothing seeds a puzzle book, so a device that has
  // never seen the vault reserves nothing (its settle is the
  // EmptyState), and the fixed four-card guess this replaces stood
  // 500px of cards at every such vault.
  const [reservedCards] = useState(
    () => parseShelfShape(localStorage.getItem(PUZZLE_SHELF_KEY), EMPTY_SHELF).root,
  );
  // Remembered for the NEXT visit's reservation — settled answers only.
  useEffect(() => {
    if (books === null || error !== null) return;
    localStorage.setItem(PUZZLE_SHELF_KEY, storedShelfShape({ root: books.length, folders: [] }));
  }, [books, error]);

  // Shown from cache immediately, refreshed underneath: a book's counts
  // change as you solve, so the list is never trusted to stay right — only
  // to be right ENOUGH to draw while the real answer is on its way.
  const load = useCallback(async () => {
    try {
      const fresh = (await api<{ books: BookSummary[] }>('/api/puzzlebooks')).books;
      // The covers are decoded BEFORE the list swaps in, so the shelf's
      // thumbnails arrive together on every path. The cards used to
      // appear and then fill with pictures one at a time — a page
      // assembling itself in front of you; the effect that fixed it
      // gated only the COLD load behind the skeleton, and a hot reload
      // (a book just imported, counts refreshed) still swapped at once
      // and let a new cover pop in late. Cold, the skeleton covers this
      // wait; hot, the cards on screen stay until the fresh set is
      // whole. Bounded, because a cover is a nicety: if the images are
      // slow or missing the shelf draws anyway.
      await decodeImages(
        fresh.map((b) => `/api/puzzlebooks/${encodeURIComponent(b.slug)}/diagrams/cover.jpg`),
      );
      shelfMemory.coversDecoded = true;
      shelfMemory.books = fresh;
      setBooks(fresh);
      setError(null);
      void sweepCheckpoints(fresh);
    } catch (e) {
      // The skeleton must not spin forever on a blip: show the cached
      // shelf (or an empty one) under a line that says what happened.
      setBooks((prev) => prev ?? shelfMemory.books ?? []);
      setError(apiErrorMessage(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const removeBook = async (slug: string): Promise<void> => {
    // A scan of a book that is going away has nowhere to put what it
    // reads, and its saved pages hold the whole PDF. Stop it BEFORE the
    // delete, so it is not still uploading into a directory the next line
    // removes — and drop what it had written, which no server-side delete
    // can reach: the checkpoint is IndexedDB, in this browser.
    useImportJob.getState().abandon(slug);
    // A failed delete is not reported here: the reload below redraws the
    // shelf from the server, so a book that survived simply reappears.
    await api(`/api/puzzlebooks/${encodeURIComponent(slug)}`, { method: 'DELETE' }).catch(() => {});
    forgetBook(slug);
    await clearCheckpoint(slug);
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
    void api<{ slugs: string[] } | undefined>('/api/puzzlebooks/bookmarks')
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
    // Optimistic: the set above is already flipped, so a failure here is
    // swallowed rather than allowed to escape as an unhandled rejection.
    await api('/api/puzzlebooks/bookmarks/toggle', {
      method: 'POST',
      json: { slug },
    }).catch(() => {});
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
    // `block`: this page spaces its sections with their own margins, not
    // the shell's column gap.
    <PageShell width="medium" className="block">
        {/* The other shelves' two-row shape: the heading row carries what
            is ABOUT the shelf — filter, order, create — and the search
            gets a full-width line of its own underneath. The bookmark
            switch rides beside the search below sm, exactly as in
            ShelfToolbar. */}
        {/* gap-4, the shelf toolbar's and PageShell's: see shelf-toolbar. */}
        <div className="mb-4 flex flex-col gap-4">
          <PageHeader
            title={t('Puzzle books')}
            back={() => navigate('puzzles', 'hub')}
            actions={
              <>
              {bookmarkToggle('hidden sm:inline-flex')}
              <Select
                value={view.sort}
                onValueChange={(value) => view.setSort(value as BookSort)}
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
                    ? t('Ascending. Press for descending.')
                    : t('Descending. Press for ascending.')
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
              </>
            }
          />
          <div className="flex items-center gap-2">
            <SearchInput
              inputSize="sm"
              value={query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              placeholder={t('Search books…')}
              aria-label={t('Search books…')}
              className="min-w-0 flex-1"
            />
            {bookmarkToggle('sm:hidden')}
          </div>
        </div>

        {error && (
          <p className="text-destructive mb-3 text-sm" role="alert">
            {error}
          </p>
        )}

        {books === null ? (
          shelfPending && reservedCards > 0 ? <SkeletonBookCards cards={reservedCards} /> : null
        ) : visibleBooks.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title="No puzzle books yet"
            body="One per paper book. Enter its puzzles from the board or import the book's own PDF. Solutions and progress live here, not in the back of the book."
            action={
              /* The empty state ends on the press that fills it, like every
                 other shelf's. */
              <Button variant="default" size="sm" onClick={() => void create()}>
                <BookMarked className="size-3.5" data-icon="inline-start" />
                {t('New book')}
              </Button>
            }
          />
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
    </PageShell>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  // The same PATCH the book's own header uses: the title changes, the
  // slug (the folder, the URL, the progress key) stays put.
  const rename = async (value: string): Promise<void> => {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === book.title) return;
    try {
      await api(`/api/puzzlebooks/${encodeURIComponent(book.slug)}`, {
        method: 'PATCH',
        json: { title: next },
      });
      forgetBook(book.slug);
      onChanged();
    } catch {
      // The card keeps its old title, which is also what the server kept.
    }
  };

  return (
    <li className="h-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate('puzzles', 'books', book.slug)}
        onKeyDown={(e) => {
          // Only when the CARD is what's focused: the rename dialog and the
          // ⋯ are children in the React tree, so their Enter bubbles here
          // even out of the portal — and confirming a rename must not also
          // open the book.
          if (e.key === 'Enter' && e.target === e.currentTarget)
            navigate('puzzles', 'books', book.slug);
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
              src={diagramUrl(book.slug, 'cover.jpg')}
              alt=""
              loading="lazy"
              decoding="async"
              className="border-border h-24 w-[4.5rem] shrink-0 rounded-md border object-cover object-top"
            />
          ) : (
            <span className="bg-muted/50 border-border grid h-24 w-[4.5rem] shrink-0 place-items-center rounded-md border">
              <BookMarked className="text-muted-foreground group-hover:text-primary size-5 transition-colors" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
            {/* pr keeps a long title clear of the corner control */}
            <span className="min-w-0 pr-7">
              <span className="text-foreground block truncate text-base font-medium">{book.title}</span>
              <span className="text-muted-foreground block text-sm">
                {t('{n} puzzles', { n: book.puzzles })}
                {/* The schedule's ask, beside the size — the one number
                    on this card that wants something done today. */}
                {(book.due ?? 0) > 0 && (
                  <span className="text-info"> · {t('{n} due', { n: book.due! })}</span>
                )}
                {/* Where the rotation stands, for a book mid-pass — the
                    ordinal and the pass's own count, not the all-time
                    figures the bar below already draws. */}
                {book.cycle && (
                  <span>
                    {' · '}
                    {t('Cycle {n}', { n: book.cycle.n })} · {book.cycle.attempted}/{book.puzzles}
                  </span>
                )}
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
                  <Spinner className="text-primary size-3 shrink-0" />
                ) : (
                  <FileUp className="text-warn size-3 shrink-0" />
                )}
                <span className={cn('truncate text-sm', scan.live ? 'text-primary' : 'text-warn')}>
                  {scan.live
                    ? t('reading, page {page} of {pages}', { page: scan.page, pages: scan.pages })
                    : t('unfinished, {page} of {pages} pages, tap to carry on', {
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

        <ActionMenu
          title={book.title}
          open={menuOpen}
          onOpenChange={setMenuOpen}
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
            // A press on the ⋯ is the menu's, not the card's.
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
      </div>
    </li>
  );
}
