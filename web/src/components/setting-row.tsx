import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The settings-row shell: a titled, blurbed strip with one control on
 * the right — a Switch, usually, but the desktop card puts a Button
 * here. One component because the identical row was pasted six times
 * across Settings and the home customiser and stayed aligned only by
 * copy-discipline.
 */
export function SettingRow({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <div className="border-card-ring bg-muted flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-base font-medium">{title}</div>
        <div className="text-muted-foreground text-sm">{blurb}</div>
      </div>
      {/* The control keeps its own width and the words give way, not the
          other way round. A row is a label and a control competing for one
          phone-width line: with both able to shrink, the flex algorithm
          took it out of the CONTROL — artificial latency's 86px menu was
          handed 74px — and a control too narrow to say what it is set to
          is worse than a blurb that wraps one line further. Every control
          used in a row is compact (a switch, a small button, a menu), so
          none of them can take the row past the card by refusing. */}
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * The row while its setting is not known: the same strip, a bar where
 * the title goes (text-base, a 24px line) over one where the blurb goes
 * (text-sm, 20px), and a Switch's box on the right at the size the
 * registry draws one, 18.4 x 32 (components/ui/switch).
 *
 * The strip is a muted well, and the bars are the accent rung above it:
 * a bar filled muted, which the primitive was for a while, could not be
 * seen in here at all.
 *
 * `blurbLines` is how many lines the blurb takes on a phone: a sentence
 * of Documents' length wraps at 390px (the row is 86px there against 66
 * on a desktop) and fits one line from sm, where the card is wider.
 */
export function SkeletonSettingRow({ blurbLines = 1 }: { blurbLines?: 1 | 2 }) {
  return (
    <div className="border-card-ring bg-muted flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex h-6 items-center">
          <Skeleton className="h-3.5 w-32" />
        </div>
        <div className="flex h-5 items-center">
          <Skeleton className="h-2 w-44" />
        </div>
        {blurbLines === 2 && (
          <div className="flex h-5 items-center sm:hidden">
            <Skeleton className="h-2 w-24" />
          </div>
        )}
      </div>
      <Skeleton className="h-[18.4px] w-8 shrink-0 rounded-full" />
    </div>
  );
}
