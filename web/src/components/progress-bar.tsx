import { Progress, ProgressIndicator } from '@/components/ui/progress';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';

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
    <TitleTip title={label}>
      <Progress
        value={total > 0 ? Math.round((100 * (solved + failed)) / total) : 0}
        // The counts existed only in the hover title — nothing for touch,
        // nothing for a screen reader. The title stays for the mouse; the
        // name is for everyone else.
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
                than hue (the app's own colour-grammar rule).

                The black is a literal on purpose, and it was measured
                before it was left alone. It looks like the "knobs are the
                palette" rule being broken at a call site, and it is not:
                --nag-blunder is #fa412d, a FIXED hex like every other NAG
                colour, and it does not move with a scheme or a theme. Ink
                over it should not either. Composited on that red at 35%,
                black reaches 2.02:1; --destructive-foreground, the token
                that means ink-on-a-red-fill, reaches 1.84 and lands 10/4/4
                of RGB away from black; --foreground reaches 1.93 in light
                and 1.45 in dark, because it inverts while the fill it sits
                on does not. Black is the best of the three and the only one
                that is the same in both themes.

                The alpha is 0.5 rather than the 0.35 it was, and that is
                the part that was actually wrong. What the stripe is for is
                the reader who cannot separate green from red, and 2.02:1 of
                texture at 2px pitch inside the registry's 4px track is a
                thin thing to hang that on; 0.5 measures 2.79:1 on the same
                red. The track's height is not ours to change — it is
                components/ui/progress, and the registry owns it — so the
                alpha is the only lever this side of the primitive. */}
            <ProgressIndicator
              className="bg-nag-blunder"
              style={{
                width: `${(100 * failed) / total}%`,
                backgroundImage:
                  'repeating-linear-gradient(135deg, transparent 0 2px, var(--nag-ink) 2px 4px)',
              }}
            />
          </>
        )}
      </Progress>
    </TitleTip>
  );
}
