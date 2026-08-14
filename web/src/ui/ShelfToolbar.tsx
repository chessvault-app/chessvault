import { ArrowDownWideNarrow, ArrowUpNarrowWide, Bookmark, LayoutGrid, List } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { SearchInput } from './Input';
import { PageHeader } from './PageHeader';
import { Segmented } from './Segmented';
import { Select } from './Select';
import type { ShelfLayout } from './ShelfCard';
import { cn } from '@/lib/cn';
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

/**
 * Remember a shelf's sort and layout on the device.
 *
 * Not in the vault: this is how one person likes to look at their shelf on
 * one screen, not something about the notes. A phone wants the list and a
 * desktop wants the grid, and syncing that between them would be wrong.
 */
export function useShelfView(shelf: string): {
  sort: ShelfSort;
  setSort: (sort: ShelfSort) => void;
  dir: ShelfDir;
  setDir: (dir: ShelfDir) => void;
  layout: ShelfLayout;
  setLayout: (layout: ShelfLayout) => void;
} {
  const key = `chess-vault:shelf-${shelf}`;
  const [state, setState] = useState<{ sort: ShelfSort; dir: ShelfDir; layout: ShelfLayout }>(
    () => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<{
          sort: ShelfSort;
          dir: ShelfDir;
          layout: ShelfLayout;
        }>;
        const sort = SORTS.some((s) => s.value === saved.sort) ? saved.sort! : 'recent';
        return {
          sort,
          dir: saved.dir === 'asc' || saved.dir === 'desc' ? saved.dir : NATURAL[sort],
          layout: saved.layout === 'list' ? 'list' : 'grid',
        };
      } catch {
        return { sort: 'recent', dir: NATURAL.recent, layout: 'grid' };
      }
    },
  );
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
    setSort: (sort) => setState((prev) => ({ ...prev, sort, dir: NATURAL[sort] })),
    dir: state.dir,
    setDir: (dir) => setState((prev) => ({ ...prev, dir })),
    layout: state.layout,
    setLayout: (layout) => setState((prev) => ({ ...prev, layout })),
  };
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
 * The bookmark filter sits in one of two places. On a wide screen there
 * is room for it in the heading row's toolbar, next to the other things
 * that act on the whole shelf. On a phone that toolbar is down to the
 * Create button, so it rides beside the search instead — after it, not
 * before, so the field still starts at the left edge like every other
 * row on the page.
 */
export function ShelfToolbar({
  title,
  query,
  onQuery,
  placeholder,
  sort,
  onSort,
  dir,
  onDir,
  layout,
  onLayout,
  markedOnly,
  onMarkedOnly,
  create,
}: {
  title: string;
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  sort: ShelfSort;
  onSort: (sort: ShelfSort) => void;
  dir: ShelfDir;
  onDir: (dir: ShelfDir) => void;
  layout: ShelfLayout;
  onLayout: (layout: ShelfLayout) => void;
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
   */
  const bookmark = (className: string): ReactNode => (
    <Button
      variant="secondary"
      size="icon-sm"
      active={markedOnly}
      aria-pressed={markedOnly}
      title={markedOnly ? t('Show all') : t('Show bookmarked only')}
      className={cn('shrink-0', className)}
      onClick={() => onMarkedOnly(!markedOnly)}
    >
      <Bookmark className={cn('size-3.5', markedOnly && 'fill-warn text-warn')} />
    </Button>
  );

  return (
    <div className="flex flex-col gap-2.5">
      <PageHeader
        title={title}
        actions={
          <>
            {/* Wide screens only — below sm this toolbar is just Create, and
                the switch travels down to the search row. */}
            {bookmark('hidden sm:inline-flex')}
            <Select
              value={sort}
              onChange={(value) => onSort(value as ShelfSort)}
              ariaLabel={t('Sort by')}
              size="sm"
              align="end"
              // Otherwise picking Title after Last modified pulls the layout
              // switch and Create left by 40-odd pixels.
              steady
              className="hidden shrink-0 sm:flex"
              groups={[{ options: SORTS.map(({ value, label }) => ({ value, label: t(label) })) }]}
            />
            {/* The select says WHAT the shelf is ordered by; this arrow says
                WHICH WAY, and flips it. Without it 'Title' never admitted
                whether it meant A→Z or Z→A. */}
            <Button
              variant="secondary"
              size="icon-sm"
              title={dir === 'asc' ? t('Ascending — press for descending') : t('Descending — press for ascending')}
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
            <Segmented
              value={layout}
              onChange={onLayout}
              ariaLabel="Layout"
              size="sm"
              className="hidden sm:flex"
              segments={[
                { value: 'grid', label: <LayoutGrid className="size-3.5" />, title: 'Grid view' },
                { value: 'list', label: <List className="size-3.5" />, title: 'List view' },
              ]}
            />
            {create}
          </>
        }
      />

      <div className="flex items-center gap-2">
        <SearchInput
          type="text"
          inputSize="sm"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1"
        />
        {bookmark('sm:hidden')}
      </div>
    </div>
  );
}
