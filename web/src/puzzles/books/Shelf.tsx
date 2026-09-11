import { Bookmark, BookMarked, FileUp, Pencil, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { useCallback, useEffect, useState } from 'react';

import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

import { SkeletonBookCards, SkeletonSubtitle, useSlowLoad } from '@/components/skeletons';
import {
  EMPTY_SHELF,
  parseShelfShape,
  storedShelfShape,
} from '@/components/shelf-reservation';
import { navigate } from '@/lib/router';

import { BookCoverCard } from '@/components/book-cover-card';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/page-shell';
import { ShelfToolbar, useShelfOrder, type ShelfDir, type ShelfSorts } from '@/components/shelf-toolbar';

import { Spinner } from '@/components/ui/spinner';
import { PromptDialog } from '@/components/prompt-dialog';

import { CreateControl, FabSpacer } from '@/components/fab';
import { useBookmarks } from '@/hooks/use-bookmarks';
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

const BOOK_SORTS: ShelfSorts<BookSort> = [
  { value: 'title', label: 'Title' },
  { value: 'puzzles', label: 'Puzzles' },
  { value: 'progress', label: 'Progress' },
];

/** The direction each sort starts in — the one its name means. */
const NATURAL: Record<BookSort, ShelfDir> = { title: 'asc', puzzles: 'desc', progress: 'desc' };

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
  const { marked: markedSlugs, toggle: toggleMark } = useBookmarks('/api/puzzlebooks', 'slug');
  const [markedOnly, setMarkedOnly] = useState(false);
  const [query, setQuery] = useState('');

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

  const view = useShelfOrder('chess-vault:shelf-books', BOOK_SORTS, NATURAL, 'title');
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

  return (
    // `block`: this page spaces its sections with their own margins, not
    // the shell's column gap.
    <PageShell width="medium">
        <ShelfToolbar
          title={t('Puzzle books')}
          back={() => navigate('puzzles', 'hub')}
          subtitle={
            books === null ? <SkeletonSubtitle /> : books.length === 1 ? t('1 book') : t('{n} books', { n: books.length })
          }
          query={query}
          onQuery={setQuery}
          placeholder={t('Search books…')}
          markedOnly={markedOnly}
          onMarkedOnly={setMarkedOnly}
          sorts={BOOK_SORTS}
          sort={view.sort}
          onSort={view.setSort}
          dir={view.dir}
          onDir={view.setDir}
          create={
            <CreateControl
              actions={[{ label: 'New book', icon: BookMarked, onSelect: () => void create() }]}
            />
          }
        />

        {error && (
          <p className="text-destructive text-sm" role="alert">
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
  const [renaming, setRenaming] = useState(false);
  const open = (): void => navigate('puzzles', 'books', book.slug);

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
    <BookCoverCard
      title={book.title}
      cover={book.cover ? diagramUrl(book.slug, 'cover.jpg') : null}
      icon={BookMarked}
      marked={marked}
      onOpen={open}
      onSwipeAway={onRemove}
      onToggleMark={onToggleMark}
      meta={
        <>
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
        </>
      }
      footer={
        scan ? (
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
        )
      }
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
      {renaming && (
        <PromptDialog
          label={t('Rename this book')}
          initial={book.title}
          onSubmit={(value) => void rename(value)}
          onClose={() => setRenaming(false)}
        />
      )}
    </BookCoverCard>
  );
}
