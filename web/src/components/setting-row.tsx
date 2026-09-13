import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Switch } from '@/components/ui/switch';

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
 * The row while its setting is not known: the real row, with its own
 * title and blurb, and a Switch on the right that is the real one, off
 * and inert, since its box is the registry's whatever the setting turns
 * out to be (components/ui/switch). The words are constants, so drawing
 * them is what makes the height right by construction: a pair of bars
 * with a `blurbLines` guess stood here before, and "File and rank labels
 * on the board edge." wraps to two lines at 375px where the guess said
 * one, so the Appearance card landed 20px taller than its placeholder
 * (measured on the demo). What the answer brings is only whether the
 * switch is on.
 */
export function SkeletonSettingRow({ title, blurb }: { title: string; blurb: string }) {
  return (
    <SettingRow title={t(title)} blurb={t(blurb)}>
      <Switch disabled checked={false} tabIndex={-1} aria-hidden />
    </SettingRow>
  );
}
