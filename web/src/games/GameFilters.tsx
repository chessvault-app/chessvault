import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Select } from '@/ui/Select';
import { t } from '@/lib/i18n';

/**
 * The one filter vocabulary for every list of games.
 *
 * Four lists show games — the collection, the archive browser, the elite
 * browser, the explorer's My games — and each had begun to grow its own
 * filters with its own words. The selects live here once: a row of
 * compact selects under the list's header, each stating its value, the
 * shape the archive panel set. A list that cannot answer a filter (a
 * side that is nobody's, a corpus with no notes) simply does not render
 * that select — the words never change, only which of them appear.
 */

export type SideFilter = 'any' | 'white' | 'black';
export type ResultFilter = 'any' | '1-0' | '0-1' | '1/2-1/2';

/** The standard one-line rail the filter selects sit in. */
export function FilterRow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('border-line flex flex-wrap items-center gap-1.5 px-3 py-2', className)}>
      {children}
    </div>
  );
}

/** Whose side of the board — YOUR side in the collection, the searched
    player's in the archive. The caller owns the semantics; the words and
    the options are the same everywhere. */
export function SideSelect({
  value,
  onChange,
}: {
  value: SideFilter;
  onChange: (value: SideFilter) => void;
}) {
  return (
    <Select
      value={value}
      onChange={(v) => onChange(v as SideFilter)}
      ariaLabel={t('Side')}
      size="sm"
      className="min-w-0 flex-1"
      groups={[
        {
          options: [
            { value: 'any', label: t('Either side') },
            { value: 'white', label: t('As White') },
            { value: 'black', label: t('As Black') },
          ],
        },
      ]}
    />
  );
}

export function ResultSelect({
  value,
  onChange,
}: {
  value: ResultFilter;
  onChange: (value: ResultFilter) => void;
}) {
  return (
    <Select
      value={value}
      onChange={(v) => onChange(v as ResultFilter)}
      ariaLabel={t('Outcome')}
      size="sm"
      className="min-w-0 flex-1"
      groups={[
        {
          options: [
            { value: 'any', label: t('Any result') },
            { value: '1-0', label: t('White won') },
            { value: '0-1', label: t('Black won') },
            { value: '1/2-1/2', label: t('Drawn') },
          ],
        },
      ]}
    />
  );
}
