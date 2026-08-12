import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/**
 * A named control in a form.
 *
 * Placeholders were doing the naming, which works for one field and stops
 * working the moment there are three: a placeholder disappears as soon as
 * the field is filled, so a half-completed import window was a column of
 * boxes with no way to tell which was which. The label stays.
 *
 * Small windows that ask for exactly one thing still use their own title —
 * a label under a title that says the same words is noise.
 */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  /** A quiet second line, for what the label cannot say in two words. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-subtle text-[0.6875rem] font-medium">{t(label)}</span>
        {hint}
      </div>
      {children}
    </div>
  );
}
