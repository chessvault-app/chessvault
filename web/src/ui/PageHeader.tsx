import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from '@/lib/cn';
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
  description,
  actions,
  className,
}: {
  title: string;
  /** Where the phone's back chevron goes; omit on top-level pages. */
  back?: () => void;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const header = (
    <header className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', !description && className)}>
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
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {actions && (
        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">{actions}</div>
      )}
    </header>
  );
  if (!description) return header;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {header}
      <p className="text-muted text-xs leading-relaxed">{description}</p>
    </div>
  );
}
