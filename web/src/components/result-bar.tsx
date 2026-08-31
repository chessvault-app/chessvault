import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';

/**
 * Lichess-style stacked white/draw/black percentage bar.
 *
 * Shared because two places answer the same question — the explorer's
 * move table and the opening map's field statistics — and each had its
 * own bar: the explorer's, with the percentages written inside the
 * segments, and a thin unlabelled one on the map. Same numbers, two
 * pictures, which is a thing to read twice rather than once.
 *
 * A percentage is only written where its own segment can hold it (12%
 * of the bar's width, measured against the smallest bar either caller
 * gives it); the rest is the title, which every segment is part of.
 */
export function ResultBar({ w, d, b }: { w: number; d: number; b: number }) {
  const total = w + d + b;
  if (total === 0) return null;
  const pct = (n: number): number => (100 * n) / total;
  const segments = [
    { value: pct(w), className: 'bg-eval-white text-on-eval-white' },
    { value: pct(d), className: 'bg-accent text-muted-foreground' },
    { value: pct(b), className: 'bg-eval-black text-on-eval-black' },
  ];
  return (
    // The split the bar cannot print. Through t(), which it was not: the
    // three words were English in the source, on a bar that stands in two
    // panels of a translated app.
    <TitleTip
      title={t('White {w}% · Draw {d}% · Black {b}%', {
        w: pct(w).toFixed(1),
        d: pct(d).toFixed(1),
        b: pct(b).toFixed(1),
      })}
    >
    <div className="border-border flex h-4 w-full overflow-hidden rounded-[4px] border font-mono text-[0.5625rem]">
      {segments.map(({ value, className }, i) => (
        <span
          key={i}
          style={{ width: `${value}%` }}
          className={cn('flex items-center justify-center overflow-hidden', className)}
        >
          {value >= 12 ? `${Math.round(value)}%` : ''}
        </span>
      ))}
    </div>
    </TitleTip>
  );
}
