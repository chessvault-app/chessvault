import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { searchRowClass } from '@/components/text-fields';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The heading every scrolling page starts with: the page's name, its
 * actions pushed to the right, and, where a phone reaches the page through
 * More rather than the sidebar, a back chevron that a desktop never shows.
 *
 * One name, two rungs. On a desktop the title is `text-xl` on one line
 * with the actions. On a phone it is a large title, `text-2xl` in a 44px
 * row, and the row scrolls away with the page like any other row. It
 * was a sticky bar for two releases (the iOS large title that shrinks
 * into the top bar as you scroll, Material 3's medium app bar): it took
 * the page's background, scaled the name to two thirds and drew a
 * hairline once the page had scrolled under it. Taken out at
 * lanph3re's call: on a phone the bar cost 44px of every scrolled list
 * to keep a name on screen that the tab bar under the thumb already
 * gives, and the shrink was one more thing moving while a list was
 * being read. A page's actions live on the title's row still, so they
 * scroll away with it; anything a page needs from anywhere in its list
 * is the Fab's, which is fixed.
 *
 * This component returns SIBLINGS rather than one box: the header, then
 * a `subtitle` (the count line, tight under the title), a `description`
 * (the explanatory paragraph), and the `search` row, each spaced by the
 * column's own gap. That shape was forced by the bar (`sticky` holds an
 * element inside its parent's box) and is kept because every page is
 * written against it.
 *
 * `subtitle` is what a page has (12 studies); `description` is what a
 * page is for. A `search` is the page's find-or-filter field, full width
 * on a phone and capped at `max-w-sm` on a desktop, on a row of its own
 * one shell gap under the heading, where every other page's first row
 * sits. It was the same two rows written out by hand on five pages before
 * it was a prop.
 */
export function PageHeader({
  title,
  back,
  backVisible = 'phone',
  truncate = false,
  subtitle,
  description,
  meta,
  actions,
  search,
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
  /** The count line under the title: how much the page holds. */
  subtitle?: ReactNode;
  /** The paragraph under the title: what the page is for. */
  description?: ReactNode;
  /**
   * Quiet status that belongs BESIDE the name rather than under it —
   * which scope is open, whether it has saved. A description explains
   * the page and gets its own line; this qualifies the title and sits on
   * the title's own baseline.
   */
  meta?: ReactNode;
  actions?: ReactNode;
  /** The page's search or filter field. The row's first child; see searchRowClass. */
  search?: ReactNode;
  className?: string;
}) {
  return (
    <>
      <header
        className={cn(
          'flex items-center gap-x-3 gap-y-2',
          truncate ? 'flex-nowrap' : 'flex-wrap',
          // The phone's row: 44px, the coarse-pointer floor for a row of
          // controls.
          'max-md:min-h-11',
          className,
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
        <h1
          className={cn(
            'text-2xl font-semibold tracking-tight md:text-xl',
            truncate && 'min-w-0 flex-1 truncate',
          )}
        >
          {title}
        </h1>
        {meta}
        {actions && (
          <div className="ml-auto flex min-w-0 items-center justify-end gap-2">{actions}</div>
        )}
      </header>
      {/* Tight under the title: the column's gap less 12px is 4px. */}
      {subtitle && <p className="text-muted-foreground -mt-3 text-sm">{subtitle}</p>}
      {/* And 8px for the paragraph, the titled block's old gap-2. */}
      {description && (
        <p className="text-muted-foreground -mt-2 text-sm leading-relaxed">{description}</p>
      )}
      {search && (
        <div className={cn('flex items-center gap-2 md:[&>:first-child]:max-w-sm', searchRowClass)}>
          {search}
        </div>
      )}
    </>
  );
}
