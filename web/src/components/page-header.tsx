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
 */
export function PageHeader({
  title,
  back,
  truncate = false,
  description,
  meta,
  actions,
  className,
}: {
  title: string;
  /** Where the phone's back chevron goes; omit on top-level pages. */
  back?: () => void;
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
  className?: string;
}) {
  const header = (
    <header
      className={cn(
        'flex items-center gap-x-3 gap-y-2',
        truncate ? 'flex-nowrap' : 'flex-wrap',
        !description && className,
      )}
    >
      {back && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
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
  if (!description) return header;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {header}
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
    </div>
  );
}
