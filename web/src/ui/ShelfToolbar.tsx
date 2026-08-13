import { Bookmark, LayoutGrid, List } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { SearchInput } from './Input';
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

const SORTS: { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: 'Last modified' },
  { value: 'title', label: 'Title' },
  { value: 'size', label: 'Size' },
];

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
  layout: ShelfLayout;
  setLayout: (layout: ShelfLayout) => void;
} {
  const key = `chess-vault:shelf-${shelf}`;
  const [state, setState] = useState<{ sort: ShelfSort; layout: ShelfLayout }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<{
        sort: ShelfSort;
        layout: ShelfLayout;
      }>;
      return {
        sort: SORTS.some((s) => s.value === saved.sort) ? saved.sort! : 'recent',
        layout: saved.layout === 'list' ? 'list' : 'grid',
      };
    } catch {
      return { sort: 'recent', layout: 'grid' };
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
    setSort: (sort) => setState((prev) => ({ ...prev, sort })),
    layout: state.layout,
    setLayout: (layout) => setState((prev) => ({ ...prev, layout })),
  };
}

/** Order a shelf. Ids sort by their last segment — the visible name. */
export function sortDocs<T extends { id: string; bytes: number; updatedAt: string }>(
  docs: T[],
  sort: ShelfSort,
): T[] {
  const name = (doc: T): string => doc.id.split('/').at(-1)!;
  return [...docs].sort((a, b) => {
    if (sort === 'title') return name(a).localeCompare(name(b), undefined, { sensitivity: 'base' });
    if (sort === 'size') return b.bytes - a.bytes;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/**
 * The bar over a shelf: what it is called, how to find one, how to order
 * them, how to look at them, and how to make another.
 *
 * Two rows, always. The heading row carries the things that are ABOUT the
 * shelf — its name, its order, its layout, and the way to add to it — and
 * the row under it carries the two that NARROW it: the bookmark filter,
 * then the search.
 *
 * They used to share one line that wrapped, which meant the search field
 * was whatever width the other four controls had finished with, and on a
 * phone it was a stub that grew over the buttons when it was focused. A
 * row of its own costs one line of height and gives it the full width on
 * every screen. Bookmark leads because it is a fixed-size switch and the
 * search takes the rest; the other way round leaves the switch floating
 * at a different place on every screen.
 */
export function ShelfToolbar({
  title,
  query,
  onQuery,
  placeholder,
  sort,
  onSort,
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
  layout: ShelfLayout;
  onLayout: (layout: ShelfLayout) => void;
  markedOnly: boolean;
  onMarkedOnly: (only: boolean) => void;
  /** The shelf's own Create control. */
  create: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
          <Select
            value={sort}
            onChange={(value) => onSort(value as ShelfSort)}
            ariaLabel={t('Sort by')}
            size="sm"
            align="end"
            className="hidden shrink-0 sm:flex"
            groups={[{ options: SORTS.map(({ value, label }) => ({ value, label: t(label) })) }]}
          />
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
        </div>
      </header>

      <div className="flex items-center gap-2">
        {/* Icon only: the pressed state says what a label would, and it
            says it in the width of a button. */}
        <Button
          variant="secondary"
          size="icon-sm"
          active={markedOnly}
          aria-pressed={markedOnly}
          title={markedOnly ? t('Show all') : t('Show bookmarked only')}
          className="shrink-0"
          onClick={() => onMarkedOnly(!markedOnly)}
        >
          <Bookmark className={cn('size-3.5', markedOnly && 'fill-warn text-warn')} />
        </Button>
        <SearchInput
          type="text"
          inputSize="sm"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1"
        />
      </div>
    </div>
  );
}
