import { ChevronLeft } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { searchRowClass } from '@/components/text-fields';
import { useScrollCollapse } from '@/hooks/use-scroll-collapse';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The heading every scrolling page starts with: the page's name, its
 * actions pushed to the right, and, where a phone reaches the page through
 * More rather than the sidebar, a back chevron that a desktop never shows.
 *
 * One name, two rungs. On a desktop the title is `text-xl` on one line
 * with the actions. On a phone it is a large title, `text-2xl` in a 44px
 * row, and the row is a bar: sticky at the top of the page's scroller,
 * where it takes the page's background, scales to two thirds (24px to 16px) and draws a
 * hairline once the page has scrolled under it (the iOS large title, the
 * Material 3 medium app bar). The actions stay on the title's line in both
 * states, so a phone's bookmark toggle or a desktop's sort menu never
 * moves between rest and scrolled.
 *
 * The bar has to be a direct child of the column that scrolls: `sticky`
 * holds an element inside its parent's box, so a header wrapped in a div
 * with its search row scrolls away with that div. That is why this
 * component returns SIBLINGS rather than one box: the header, then a
 * `subtitle` (the count line, tight under the title), a `description`
 * (the explanatory paragraph), and the `search` row, each spaced by the
 * column's own gap. Pages that hand PageShell their own margins instead
 * of using its gap cannot hold a header with any of those three.
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
  collapse = true,
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
  /**
   * Whether the phone's row is the sticky bar described above. Off for a
   * header that is not at the top of a scrolling column: a launcher whose
   * blocks are pinned to the bottom edge, or a leaf's side column, where a
   * bar that bleeds to the gutters has no gutters to bleed into.
   */
  collapse?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const compact = useScrollCollapse(ref, collapse);
  return (
    <>
      <header
        ref={ref}
        data-compact={compact ? '' : undefined}
        className={cn(
          'group/header flex items-center gap-x-3 gap-y-2',
          truncate ? 'flex-nowrap' : 'flex-wrap',
          // The phone's row: 44px, the coarse-pointer floor for a bar.
          'max-md:min-h-11',
          collapse && [
            // Sticky over the page, bleeding into the gutters so the
            // hairline runs edge to edge and nothing scrolls past its
            // sides. z-20: under the Fab (z-30) and every dialog.
            // At rest the row is the page; scrolled under, it becomes a
            // bar, which on the tonal page means the bars' white (the tab
            // bar's fill) rather than a hairline on the page's own tone.
            // The hairline returns under High contrast with the bars'.
            'max-md:sticky max-md:top-0 max-md:z-20 max-md:-mx-4 max-md:px-4 max-md:bg-background',
            'max-md:transition-colors max-md:duration-(--pane-turn) max-md:ease-(--pane-turn-ease) data-compact:max-md:bg-card',
            'max-md:border-b max-md:border-transparent data-compact:max-md:border-card-ring',
          ],
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
            // The large title shrinks in place once the page is under the
            // bar: scaled from its left edge to two thirds (24px to 16px),
            // not re-set at a smaller size. Animating font-size relaid
            // the line out on every frame and read as a reflow; a
            // transform is composited and reads as the title moving.
            // Only the size moves; the row keeps its 44px.
            // On the app's one motion clock (the pane turn's spring), so the
            // title, the pill and the panes settle at the same tempo.
            'max-md:origin-left max-md:transition-transform max-md:duration-(--pane-turn) max-md:ease-(--pane-turn-ease)',
            'group-data-compact/header:max-md:scale-[0.667]',
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
