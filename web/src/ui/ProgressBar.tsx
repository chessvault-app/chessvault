import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/**
 * THE progress bar — every solved/failed fraction in the app uses this one
 * treatment: a bordered track that stays visible when empty, green solved
 * and red failed segments, and the counts in the tooltip rather than as
 * UI text.
 */
export function ProgressBar({
  total,
  solved,
  failed,
  className,
  showEmpty = false,
}: {
  total: number;
  solved: number;
  failed: number;
  className?: string;
  /** Render the empty track even when there is nothing to count. */
  showEmpty?: boolean;
}) {
  if (total === 0 && !showEmpty) return null;
  return (
    <span
      title={
        total === 0
          ? t('Nothing attempted yet')
          : t('{solved} solved · {failed} failed · {left} remaining', {
              solved,
              failed,
              left: total - solved - failed,
            })
      }
      className={cn(
        'bg-surface-inset border-line-strong flex h-2 w-full overflow-hidden rounded-full border',
        className,
      )}
    >
      {total > 0 && (
        <>
          <span className="bg-nag-good h-full" style={{ width: `${(100 * solved) / total}%` }} />
          <span className="bg-nag-blunder h-full" style={{ width: `${(100 * failed) / total}%` }} />
        </>
      )}
    </span>
  );
}
