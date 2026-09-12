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
 * gives it); the rest is the title, which every segment is part of, and
 * the bar's accessible name, which is the same sentence: the tip opens
 * for a pointer only, and the split is the explorer's whole answer.
 *
 * Three colours, measured (light / dark, against what they touch):
 * - The draw segment is `--result-draw`, a mid grey that stands 3.3:1 /
 *   3.5:1 off the White fill and 3.4:1 / 3.5:1 off the Black fill. It
 *   was `--accent`, 1.04:1 off White in light: a 14% draw share printed
 *   nothing and drew nothing, so the bar read as a two-way split.
 * - The track's edge is that same grey, 3.9:1 / 4.5:1 against the card.
 *   It was `--border`, 1.4:1 / 1.2:1: in dark a 100% Black row was a
 *   near-card fill inside a near-card ring, an empty track, and in light
 *   a 100% White row would be the same. The edge is what says there is
 *   a bar here at all.
 * - The draw figure is black on that grey (5.3:1 / 4.9:1).
 */
export function ResultBar({
  w,
  d,
  b,
  pov = 'colours',
}: {
  w: number;
  d: number;
  b: number;
  /**
   * Whose numbers these are. `colours` (the default) is a book's row:
   * White's wins, draws, Black's wins, in the board's own two inks.
   * `mine` is a row of the owner's games seen from their side: won,
   * drew, lost, in the good and destructive hues the result badge
   * already uses for a game that went your way or did not. The insights
   * page asked for the second and the eval inks would have lied on it: a
   * game won as Black is not a black segment. The mixes here are deeper
   * than the badge's 10% tints, which measured 1.01:1 apart, and the
   * figures take the page's ink rather than the hue's, which no wash
   * this pale could carry at 4.5:1.
   */
  pov?: 'colours' | 'mine';
}) {
  const total = w + d + b;
  if (total === 0) return null;
  const pct = (n: number): number => (100 * n) / total;
  const mine = pov === 'mine';
  const segments = [
    {
      value: pct(w),
      className: mine
        ? 'bg-[color-mix(in_oklch,var(--good)_30%,var(--card))] text-foreground'
        : 'bg-eval-white text-on-eval-white',
    },
    { value: pct(d), className: 'bg-result-draw text-black' },
    {
      value: pct(b),
      className: mine
        ? 'bg-[color-mix(in_oklch,var(--destructive)_30%,var(--card))] text-foreground'
        : 'bg-eval-black text-on-eval-black',
    },
  ];
  const label = t(mine ? 'Won {w}% · Drew {d}% · Lost {b}%' : 'White {w}% · Draw {d}% · Black {b}%', {
    w: pct(w).toFixed(1),
    d: pct(d).toFixed(1),
    b: pct(b).toFixed(1),
  });
  return (
    // The split the bar cannot print. Through t(), which it was not: the
    // three words were English in the source, on a bar that stands in two
    // panels of a translated app.
    //
    // The text size below is fitted to the bar's own 16px track, not on
    // the type ladder: the figures are read off the bar, never as a line
    // of text. The 4px corner is the chip corner, off the radius knob on
    // purpose.
    <TitleTip title={label}>
      {/* One image with one name: the printed figures are hidden from a
          reader because they are the same numbers, rounded, with no owner
          ("64% 14% 21%" was what it said). */}
      <div
        data-slot="result-bar"
        role="img"
        aria-label={label}
        /* Fitted to the 16px track; the corner is the chip corner. */
        className="border-result-draw flex h-4 w-full overflow-hidden rounded-[4px] border font-mono text-[0.5625rem]"
      >
        {segments.map(({ value, className }, i) => (
          <span
            key={i}
            aria-hidden="true"
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
