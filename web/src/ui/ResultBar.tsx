import { cn } from '@/lib/cn';

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
    { value: pct(d), className: 'bg-surface-3 text-muted' },
    { value: pct(b), className: 'bg-eval-black text-on-eval-black' },
  ];
  return (
    <div
      className="border-line flex h-4 w-full overflow-hidden rounded-[4px] border font-mono text-[0.5625rem]"
      title={`White ${pct(w).toFixed(1)}% · Draw ${pct(d).toFixed(1)}% · Black ${pct(b).toFixed(1)}%`}
    >
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
  );
}
