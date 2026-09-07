import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The heading row every scrolling page starts with: one title size, the
 * page's actions pushed to the right, and — where a phone reaches the
 * page through More rather than the sidebar — a back chevron that a
 * desktop never shows.
 *
 * A `description` turns the row into a titled block: the explanatory
 * line sits tight under the heading instead of a full shell-gap away.
 *
 * A `search` is the page's find-or-filter field, on a full-width row of
 * its own one shell gap (16px) under the heading row, where every other
 * page's first row sits. It was the same two rows written out by hand on
 * five pages (the shelf toolbar, Books, the puzzle shelf, Themes, the
 * canvas shell), which is how the shelves once came to sit 10px under
 * their titles while everything else sat 16.
 */
export function PageHeader({
  title,
  back,
  backVisible = 'phone',
  truncate = false,
  description,
  meta,
  actions,
  search,
  searchRow,
  className,
}: {
  title: string;
  /** Where the phone's back chevron goes; omit on top-level pages. */
  back?: () => void;
  /**
   * `always` on a leaf the sidebar cannot name — one book, one document —
   * where a desktop needs the chevron too; `phone` (the default) for the
   * pages the sidebar reaches, where a desktop never shows it.
   */
  backVisible?: 'phone' | 'always';
  /** A title that is a user's own name for something and may run long:
      one line, cut with an ellipsis, rather than wrapping the row. */
  truncate?: boolean;
  description?: string;
  /**
   * Quiet status that belongs BESIDE the name rather than under it —
   * which scope is open, whether it has saved. A description explains
   * the page and gets its own line; this qualifies the title and sits on
   * the title's own baseline.
   */
  meta?: ReactNode;
  actions?: ReactNode;
  /** The page's search or filter field, and anything that rides beside it. */
  search?: ReactNode;
  /** Extra classes on the search row (`searchRowClass` for the phone focus rule). */
  searchRow?: string;
  className?: string;
}) {
  // className lands on the outermost box there is: the header alone, the
  // titled block, or the block with its search row.
  const outer = search ? undefined : className;
  const header = (
    <header
      className={cn(
        'flex items-center gap-x-3 gap-y-2',
        truncate ? 'flex-nowrap' : 'flex-wrap',
        !description && outer,
      )}
    >
      {back && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={backVisible === 'phone' ? 'md:hidden' : undefined}
          title={t('Back')}
          onClick={back}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
      )}
      <h1 className={cn('text-xl font-semibold tracking-tight', truncate && 'min-w-0 flex-1 truncate')}>
        {title}
      </h1>
      {meta}
      {actions && (
        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">{actions}</div>
      )}
    </header>
  );
  const block = description ? (
    <div className={cn('flex flex-col gap-2', outer)}>
      {header}
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
    </div>
  ) : (
    header
  );
  if (!search) return block;
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {block}
      <div className={cn('flex items-center gap-2', searchRow)}>{search}</div>
    </div>
  );
}
