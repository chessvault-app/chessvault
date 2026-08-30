import { Progress, ProgressIndicator } from '@/components/ui/progress';
import { t } from '@/lib/i18n';

/**
 * THE progress bar — every solved/failed fraction in the app uses this one
 * treatment: shadcn's Progress (Base UI's progressbar role, the bordered
 * track that stays visible when empty) with two fills, green solved and
 * striped red failed, and the counts in the name rather than as UI text.
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
  const label =
    total === 0
      ? t('Nothing attempted yet')
      : t('{solved} solved · {failed} failed · {left} remaining', {
          solved,
          failed,
          left: total - solved - failed,
        });
  return (
    <Progress
      value={total > 0 ? Math.round((100 * (solved + failed)) / total) : 0}
      // The counts existed only in the hover title — nothing for touch,
      // nothing for a screen reader. The title stays for the mouse; the
      // name is for everyone else.
      title={label}
      aria-label={label}
      // `value` is how much has been ATTEMPTED, which is what fills the
      // track; the two fills inside then split that by outcome. Left to
      // itself the primitive announced "100%" beside a name reading "13
      // solved · 6 failed", where the percentage sounds like the solve
      // rate and is not one. Saying the counts twice is better than
      // saying a number that means a different thing each time.
      aria-valuetext={label}
      className={className}
    >
      {total > 0 && (
        <>
          <ProgressIndicator className="bg-nag-good" style={{ width: `${(100 * solved) / total}%` }} />
          {/* Striped, not just red: the two segments must differ by more
              than hue (the app's own colour-grammar rule). */}
          <ProgressIndicator
            className="bg-nag-blunder"
            style={{
              width: `${(100 * failed) / total}%`,
              backgroundImage:
                'repeating-linear-gradient(135deg, transparent 0 2px, rgba(0,0,0,0.35) 2px 4px)',
            }}
          />
        </>
      )}
    </Progress>
  );
}
