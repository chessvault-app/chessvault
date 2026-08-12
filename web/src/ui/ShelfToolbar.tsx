import { LayoutGrid, List } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { SearchInput } from './Input';
import { Select } from './Select';
import type { ShelfLayout } from './ShelfCard';
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
 * One row on a desktop; on a phone the title keeps its own line and the
 * controls take the next, because five controls and a heading do not fit
 * across 390px without every one of them becoming too small to hit.
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
  /** The shelf's own Create control. */
  create: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
        <SearchInput
          type="text"
          inputSize="sm"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 sm:w-44 sm:flex-none"
        />
        <Select
          value={sort}
          onChange={(value) => onSort(value as ShelfSort)}
          ariaLabel={t('Sort by')}
          size="sm"
          align="end"
          className="hidden shrink-0 sm:flex"
          groups={[
            { options: SORTS.map(({ value, label }) => ({ value, label: t(label) })) },
          ]}
        />
        {/* Two states, so a switch rather than a menu: the icon shown is
            the layout you are IN, the way a toggle is normally read. */}
        <div className="border-line hidden shrink-0 items-center rounded-md border p-0.5 sm:flex">
          {(
            [
              ['grid', LayoutGrid, 'Grid view'],
              ['list', List, 'List view'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              title={t(label)}
              aria-pressed={layout === id}
              onClick={() => onLayout(id)}
              className={
                layout === id
                  ? 'bg-surface-2 text-fg rounded p-1 transition-colors duration-100'
                  : 'text-subtle hover:text-fg rounded p-1 transition-colors duration-100'
              }
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
        {create}
      </div>
    </header>
  );
}
