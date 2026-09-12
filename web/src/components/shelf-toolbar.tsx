import { ArrowDownWideNarrow, ArrowUpNarrowWide, Bookmark, LayoutGrid, List } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/text-fields';
import { PageHeader } from '@/components/page-header';
import { Segmented } from '@/components/segmented';
import { Select } from '@/components/ui/select';
import type { ShelfLayout } from '@/components/shelf-card';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * How a shelf is ordered.
 *
 * No "date created": the vault is plain files, and a file's birth time is
 * not something every filesystem keeps — ext4 only records it on kernels
 * new enough for statx, and a copied vault has the date of the copy. An
 * order that is silently wrong on some machines is worse than one option
 * fewer, so the shelf sorts by what a file can always answer for.
 */
export type ShelfSort = 'recent' | 'title' | 'size';
export type ShelfDir = 'asc' | 'desc';

const SORTS: { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: 'Last modified' },
  { value: 'title', label: 'Title' },
  { value: 'size', label: 'Size' },
];

/** The direction each sort starts in — the one its name means. Picking a
    sort resets to this; the arrow beside the select flips it. */
const NATURAL: Record<ShelfSort, ShelfDir> = { recent: 'desc', title: 'asc', size: 'desc' };

/** A shelf's own sort list: what it can be ordered by, in menu order. */
export type ShelfSorts<S extends string> = readonly { value: S; label: string }[];

/**
 * Remember a shelf's sort and layout on the device.
 *
 * Not in the vault: this is how one person likes to look at their shelf on
 * one screen, not something about the notes. A phone wants the list and a
 * desktop wants the grid, and syncing that between them would be wrong.
 *
 * Generic over the sort list, because a book shelf orders by what a book
 * has (a count, a score, a page reached) and not by a file's size or
 * mtime; the two book shelves each kept a copy of this hook with their
 * own list pasted in. `natural` is the direction each sort starts in,
 * the one its name means; picking a sort resets to it.
 */
export function useShelfOrder<S extends string>(
  key: string,
  sorts: ShelfSorts<S>,
  natural: Record<S, ShelfDir>,
  fallback: S,
): {
  sort: S;
  setSort: (sort: S) => void;
  dir: ShelfDir;
  setDir: (dir: ShelfDir) => void;
  layout: ShelfLayout;
  setLayout: (layout: ShelfLayout) => void;
} {
  const [state, setState] = useState<{ sort: S; dir: ShelfDir; layout: ShelfLayout }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<{
        sort: S;
        dir: ShelfDir;
        layout: ShelfLayout;
      }>;
      const sort = sorts.some((s) => s.value === saved.sort) ? saved.sort! : fallback;
      return {
        sort,
        dir: saved.dir === 'asc' || saved.dir === 'desc' ? saved.dir : natural[sort],
        layout: saved.layout === 'list' ? 'list' : 'grid',
      };
    } catch {
      return { sort: fallback, dir: natural[fallback], layout: 'grid' };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* private mode — the shelf just forgets between visits */
    }
  }, [key, state]);
  return {
    sort: state.sort,
    // A new sort starts in its own natural direction rather than keeping
    // the previous one's: Title after newest-first means A→Z, not Z→A.
    setSort: (sort) => setState((prev) => ({ ...prev, sort, dir: natural[sort] })),
    dir: state.dir,
    setDir: (dir) => setState((prev) => ({ ...prev, dir })),
    layout: state.layout,
    setLayout: (layout) => setState((prev) => ({ ...prev, layout })),
  };
}

/** The document shelves' view: sortDocs' three orders, and a layout. */
export function useShelfView(shelf: string): ReturnType<typeof useShelfOrder<ShelfSort>> {
  return useShelfOrder(`chess-vault:shelf-${shelf}`, SORTS, NATURAL, 'recent');
}

/** Order a shelf. Ids sort by their last segment — the visible name. */
export function sortDocs<T extends { id: string; bytes: number; updatedAt: string }>(
  docs: T[],
  sort: ShelfSort,
  dir: ShelfDir = NATURAL[sort],
): T[] {
  const name = (doc: T): string => doc.id.split('/').at(-1)!;
  const flip = dir === 'desc' ? -1 : 1;
  return [...docs].sort((a, b) => {
    // Ascending comparisons; `flip` turns the whole order over.
    if (sort === 'title')
      return flip * name(a).localeCompare(name(b), undefined, { sensitivity: 'base' });
    if (sort === 'size') return flip * (a.bytes - b.bytes);
    return flip * a.updatedAt.localeCompare(b.updatedAt);
  });
}

/**
 * The count line under a shelf's title: what the shelf holds (`count`,
 * already worded: "11 notes"), and while a filter is on, how many of
 * those it is showing ("3 of 11 notes"). The search and the bookmark
 * switch used to change the cards without a word while this line went on
 * saying the whole shelf's number over one card.
 *
 * A status, so the filter's result is spoken as the count changes, and
 * mounted from the moment the count is known: a live region announces
 * what changes inside it, not its own arrival, so wrapping only the
 * filtered form would have announced nothing.
 */
export function ShelfCount({ count, shown }: { count: string; shown: number | null }) {
  return (
    <span role="status">
      {shown === null ? count : t('{shown} of {count}', { shown, count })}
    </span>
  );
}

/**
 * The bar over a shelf: what it is called, how to find one, how to order
 * them, how to look at them, and how to make another.
 *
 * Two rows. The heading row carries what is ABOUT the shelf — its name,
 * its order, its layout, the way to add to it — and the row under it is
 * the search, which gets the full content width instead of whatever the
 * other four controls had finished with. On a phone that field used to be
 * a stub that grew over the buttons when it was focused, which is why
 * SearchInput still carries a rule for being focused at all.
 *
 * The bookmark filter sits in the heading row at every width. On a phone
 * that row is otherwise empty (Create is the Fab there), so the switch is
 * the one control beside the large title, and the search underneath has
 * the whole line. It used to ride beside the search on a phone; that put
 * the page's only button on its second row and left the title alone.
 */
export function ShelfToolbar<S extends string = ShelfSort>({
  title,
  back,
  query,
  onQuery,
  placeholder,
  sorts = SORTS as unknown as ShelfSorts<S>,
  sort,
  onSort,
  dir,
  onDir,
  layout,
  onLayout,
  markedOnly,
  onMarkedOnly,
  create,
  subtitle,
}: {
  title: string;
  /** A shelf reached from a hub, rather than from the nav, has a way back. */
  back?: () => void;
  /** The count line under the title: how many the shelf holds. */
  subtitle?: ReactNode;
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  /** The orders on offer; the document shelves' three unless the shelf
      says otherwise (a book shelf orders by what a book has). */
  sorts?: ShelfSorts<S>;
  sort: S;
  onSort: (sort: S) => void;
  dir: ShelfDir;
  onDir: (dir: ShelfDir) => void;
  /** Omitted together where the shelf has one layout (the book shelves,
      whose cards are covers). */
  layout?: ShelfLayout;
  onLayout?: (layout: ShelfLayout) => void;
  markedOnly: boolean;
  onMarkedOnly: (only: boolean) => void;
  /** The shelf's own Create control. */
  create: ReactNode;
}) {
  /**
   * The same switch in both places — declared once so the two cannot drift
   * apart, and only ever one of them is on screen.
   *
   * Icon only: the pressed state says what a label would, in the width of
   * a button.
   *
   * The tooltip names the press ("Show all" once it is on) and the
   * accessible name stays put: a toggle whose name changes with its state
   * is heard as "Show all, pressed", the opposite of the screen, which is
   * why the APG's toggle button keeps one label and lets aria-pressed
   * carry the state.
   */
  const bookmark = (className?: string): ReactNode => (
    <Button
      variant="secondary"
      size="icon-sm"
      active={markedOnly}
      aria-pressed={markedOnly}
      aria-label={t('Show bookmarked only')}
      title={markedOnly ? t('Show all') : t('Show bookmarked only')}
      className={cn('shrink-0', className)}
      onClick={() => onMarkedOnly(!markedOnly)}
    >
      {/* In the accent, not amber, for the reason the game row's kept edge
          gives (games/shared.tsx): amber is caution everywhere else in the
          app, and a bookmark is not a warning. The row edge and the shelf
          card were moved first and these toolbar icons were left behind,
          so one hue meant two things on the same screen. */}
      <Bookmark className={cn('size-3.5', markedOnly && 'fill-current text-primary')} />
    </Button>
  );

  return (
    // The search row is PageHeader's: one shell gap under the title, the
    // same distance every page puts its first row at.
    <PageHeader
      title={title}
      back={back}
      subtitle={subtitle}
      search={
        <SearchInput
          type="text"
          inputSize="sm"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1"
        />
      }
      actions={
      <>
        {bookmark()}
          <Select
            value={sort}
            onValueChange={(value) => onSort(value as S)}
            ariaLabel={t('Sort by')}
            size="sm"
            align="end"
            // Otherwise picking Title after Last modified pulls the layout
            // switch and Create left by 40-odd pixels.
            steady
            className="hidden shrink-0 sm:flex"
            groups={[{ options: sorts.map(({ value, label }) => ({ value, label: t(label) })) }]}
          />
          {/* The select says WHAT the shelf is ordered by; this arrow says
              WHICH WAY, and flips it. Without it 'Title' never admitted
              whether it meant A→Z or Z→A. */}
          <Button
            variant="secondary"
            size="icon-sm"
            title={dir === 'asc' ? t('Ascending. Press for descending.') : t('Descending. Press for ascending.')}
            className="hidden shrink-0 sm:inline-flex"
            onClick={() => onDir(dir === 'asc' ? 'desc' : 'asc')}
          >
            {dir === 'asc' ? (
              <ArrowUpNarrowWide className="size-3.5" />
            ) : (
              <ArrowDownWideNarrow className="size-3.5" />
            )}
          </Button>
          {/* Two states, so a switch rather than a menu — the same segmented
              control the archive panel picks its site with. */}
          {layout !== undefined && onLayout && (
            <Segmented
              value={layout}
              onChange={onLayout}
              ariaLabel="Layout"
              size="sm"
              // A setting, so a radiogroup — but drawn as a track: its
              // two options are ICONS, and a choice row needs words. See
              // the `look` note in Segmented.
              look="track"
              className="hidden sm:flex"
              segments={[
                { value: 'grid', label: <LayoutGrid className="size-3.5" />, title: 'Grid view' },
                { value: 'list', label: <List className="size-3.5" />, title: 'List view' },
              ]}
            />
          )}
          {create}
        </>
      }
      />
  );
}
